// MCP 도구 (#1248, 0.7.0) — AI 와 패널이 같이 쓰는 것: list · run · report · guide · fingerprint · newRequest. 패널만(plugin 서비스의 panelTools, AI 에 안 보임): progress · stop · shot · delete · detail · reindex · pdf. [연결 확인]: check (settingsCheck).
// 시나리오를 고르는 말(Selector)은 list · run · delete 가 같이 쓴다: { scenarios?, screen?, request?, failed? } — 여럿이면 모두 맞는 것, 없으면 전부.
// 결과 글에 비밀 값은 넣지 않는다 — 계정은 아이디만. 패널 도구의 결과는 JSON 글이다(계약은 README "패널 ↔ 서비스").
// run 은 RUN_WAIT_MS 까지만 기다리고 돌아온다(엔진의 MCP 도구 호출 기한 5분 — 긴 수행은 report { run } 으로 끝을 기다린다).
// 기록 · 목록 · 삭제는 저장소(host.db)가 있어야 한다 — 앱 밖 실행(DB 없음)이면 db-unavailable. 실행 자체는 DB 없이도 된다(기록 · 비교만 건너뜀).

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { channelLabel, scrub } from './config.ts'
import type { Driver } from './driver.ts'
import { FAIL_HINT, FAIL_LABEL } from './failure.ts'
import { compareLine, unitLabel } from './history.ts'
import { seconds, when } from './report.ts'
import { historyOf } from './remove.ts'
import { caseOf, selectorEmpty, type Progress, type RunOutcome, type ScenarioInfo, type Selector, type Workspace } from './runner.ts'
import { StoreError, timeId, type ResultDoc } from './store.ts'
import type { CaseResult, RunRecord, StepResult } from './types.ts'

export interface ToolResult {
  text: string
  isError?: boolean
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** signal — 대화가 도구 호출을 멈추면(턴 멈춤) 풀린다 */
  run(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>
}

/** run · report 가 수행 끝을 기다리는 시간 — 엔진의 MCP 도구 호출 기한(experimental.mcp_timeout 300초) 안에서 넉넉히 */
export const RUN_WAIT_MS = 120_000

/** 패널만 부르는 도구 — 서비스가 host.mcp.register 의 panelTools 로 올린다(AI 에 안 보인다) */
export const PANEL_TOOLS = ['progress', 'stop', 'shot', 'delete', 'detail', 'reindex', 'pdf']

const STATUS: Record<CaseResult['status'], string> = { passed: '성공', failed: '실패', 'no-code': '코드 없음', stopped: '멈춤' }
const JSON_ARG = { type: 'boolean', description: 'Return JSON (used by the panel).' }
const SELECTOR_PROPS = {
  scenarios: { type: 'array', items: { type: 'string' }, description: 'Scenario ids, titles or file names (see list).' },
  screen: { type: 'string', description: 'A screen: route pattern (e.g. "/admin/menu") or screen name — the scenarios whose "확인:" steps ran on that screen.' },
  request: { type: 'string', description: 'A request id — the scenarios made by that chat request.' },
  failed: { type: 'boolean', description: 'Only the scenarios whose last real run failed.' },
}

const NO_DB = 'db-unavailable — 기록 저장소(host.db)를 쓸 수 없습니다(앱 밖 실행이거나 옛 앱). 시나리오 목록 · 삭제 · 기록 · 비교는 앱 안에서만 됩니다. 실행은 되지만 기록은 남지 않습니다.'

/** 오류 글 — 저장소를 못 쓰면 db-unavailable 로 시작하는 정해진 글, 비밀 값은 지운다 */
function errorText(error: unknown, secrets: string[]): string {
  if (error instanceof StoreError && error.code === 'db-unavailable') return NO_DB
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string' ? ` [${(error as { code: string }).code}]` : ''
  return scrub((error instanceof Error ? error.message : String(error)) + code, secrets)
}

const counts = (run: RunRecord): string => {
  const passed = run.cases.filter((item) => item.status === 'passed').length
  const failed = run.cases.filter((item) => item.status === 'failed').length
  return `성공 ${passed} · 실패 ${failed} / ${run.cases.length}`
}

/** AI 없이 시나리오를 실행하는 명령 — CI */
export function cliCommand(serverFile: string): string {
  return `node "${serverFile}" run [<시나리오 id>…] [--failed] [--screen <라우트>] [--request <요청 id>] --headless`
}

export interface ToolDeps {
  workspace: Workspace
  /** [연결 확인] 용 드라이버 */
  checkDriver: () => Driver
  /** 이 서버 파일 (CI 명령) */
  serverFile: string
  /** run · report 가 기다리는 시간 (시험용) */
  waitMs?: number
}

const STEP_MARK: Record<StepResult['status'], string> = { passed: '✓', failed: '✕', db: '◇ 대화에서만 확인', 'not-run': '– 실행 안 함' }

function stepLines(steps: StepResult[], indent = ''): string[] {
  return steps.map(
    (step) =>
      `${indent}- ${STEP_MARK[step.status]} ${step.title}${step.durationMs ? ` (${seconds(step.durationMs)})` : ''}${step.used.length ? ` — 쓴 것: ${step.used.join(' · ')}` : ''}${step.url ? ` — 본 화면: ${step.url}` : ''}${step.error ? ` — ${step.error}` : ''}${step.failKind ? ` [갈래: ${FAIL_LABEL[step.failKind]}]` : ''}`,
  )
}

const staleLine = (ids: string[]): string => `코드 낡음(시나리오가 코드를 만든 뒤 바뀌었거나 머리말 지문이 맞지 않음): ${ids.join(', ')} — 이 결과는 옛 코드로 실행한 것입니다. 시나리오와 ## 테스트 방법을 읽고 코드를 다시 만든 뒤 다시 실행하세요.`

type Summary = Pick<RunOutcome, 'run' | 'mode' | 'title' | 'reports' | 'recorded'> & Partial<Pick<RunOutcome, 'recordError' | 'stale' | 'suggestGitignore'>>

export function runSummary(outcome: Summary, workspace: Workspace): string {
  const { run } = outcome
  const lines = [
    run.interrupted ? `실행 중단됨(${run.interrupted}) — 실행한 데까지 결과서 · 기록에 남겼습니다. 남은 시나리오는 멈춤` : '',
    `실행 끝 — ${outcome.title} (${seconds(run.durationMs)}) · ${counts(run)} · ${run.browser} · ${run.headed ? '보이게' : '화면 없이'} · 수행 id ${run.id}`,
  ]
  if (outcome.stale?.length) lines.push(staleLine(outcome.stale))
  if (run.compare) lines.push(`지난 실행(${run.compare.previousId})과 비교 — ${compareLine(run.compare)}`)
  else if (outcome.recorded) lines.push('처음 실행 — 비교할 지난 실행 없음')
  if (outcome.recordError) lines.push(`기록을 남기지 못했습니다 — ${outcome.recordError} (결과서는 만들었습니다)`)
  else if (!outcome.recorded) lines.push('기록은 남기지 않았습니다(앱 밖 실행) — 비교 · 목록에 반영되지 않습니다')
  if (run.compare?.newFail.length) lines.push(`  새로 실패: ${run.compare.newFail.map(unitLabel).join(', ')}`)
  if (run.compare?.fixed.length) lines.push(`  고쳐짐: ${run.compare.fixed.map(unitLabel).join(', ')}`)
  if (run.compare?.stillFail.length) lines.push(`  그대로 실패: ${run.compare.stillFail.map(unitLabel).join(', ')}`)
  lines.push(outcome.mode === 'each' ? `결과서(시나리오마다 따로): ${outcome.reports.map((item) => workspace.rel(item.file)).join(' · ')}` : `결과서: ${workspace.rel(run.report)}`, '')
  const db: string[] = []
  const kinds = new Set<NonNullable<CaseResult['failKind']>>()
  for (const item of run.cases) {
    lines.push(`## ${item.id} — ${item.title}: ${STATUS[item.status]} (${seconds(item.durationMs)})${item.rows ? ` · 데이터 ${item.rows.filter((row) => row.status === 'passed').length}/${item.rows.length} 행 성공` : ''}`)
    if (item.error) lines.push(`오류: ${item.error}${item.failKind ? ` [갈래: ${FAIL_LABEL[item.failKind]}]` : ''}`)
    if (item.failKind) kinds.add(item.failKind)
    const all = item.rows ? item.rows.flatMap((row) => row.steps) : item.steps
    if (item.rows) {
      for (const row of item.rows) {
        lines.push(`### ${row.row}행 (${row.label}): ${STATUS[row.status]} (${seconds(row.durationMs)})${row.failKind ? ` [갈래: ${FAIL_LABEL[row.failKind]}]` : ''}`)
        if (row.error && !row.steps.some((step) => step.error)) lines.push(`오류: ${row.error}`)
        if (row.failKind) kinds.add(row.failKind)
        lines.push(...stepLines(row.steps))
      }
    } else lines.push(...stepLines(item.steps))
    for (const step of all) if (step.status === 'db') db.push(`${item.id}: ${step.title}`)
    lines.push('')
  }
  if (kinds.size) lines.push('실패 갈래 (어림 — 스크린샷 · 오류 글로 확인하고 가르세요):', ...[...kinds].map((kind) => `- ${FAIL_LABEL[kind]}: ${FAIL_HINT[kind]}`), '')
  if (db.length) lines.push('확인(DB) 단계는 실행기가 실행하지 않았습니다 — DB 조회 MCP 가 켜져 있으면 대화에서 확인하고, 없으면 사용자에게 확인을 부탁하세요:', ...[...new Set(db)].map((line) => `- ${line}`), '')
  if (run.cases.some((item) => item.status === 'passed')) lines.push('성공한 시나리오에 `## 테스트 방법` 이 없거나 이번에 방법이 바뀌었으면 위 "쓴 것" · 시간으로 시나리오 md 에 쓰세요(비밀번호는 쓰지 않는다). "본 화면" 은 이 시나리오의 화면 태그가 됩니다.')
  if (run.cases.some((item) => item.status === 'no-code')) lines.push('코드 없음: 시나리오 옆에 같은 이름의 .spec.mjs 를 먼저 만드세요.')
  if (outcome.suggestGitignore) lines.push(`결과서 폴더 \`${outcome.suggestGitignore}\` (결과서 · 가이드가 쌓입니다) 가 .gitignore 에 없습니다 — 저장소에 올리지 않으려면 .gitignore 에 넣을지 사용자에게 물어 보세요(플러그인은 .gitignore 를 고치지 않습니다).`)
  return lines.filter((line, index) => index > 0 || line).join('\n').trim()
}

/** 아직 도는 수행 — 몇 건 끝났나 */
function runningText(progress: Progress, waitedMs: number): string {
  const done = progress.cases.filter((item) => !['waiting', 'running'].includes(item.status)).length
  const current = progress.cases.find((item) => item.status === 'running')
  return [
    `아직 실행 중 — ${progress.title} · 수행 id ${progress.runId} · ${done}/${progress.cases.length} 건 끝${current ? ` · 지금 ${current.id}` : ''} (${seconds(waitedMs)} 기다림)`,
    ...(progress.stale?.length ? [staleLine(progress.stale)] : []),
    `끝을 보려면 report { run: "${progress.runId}" } 를 다시 부르세요(한 번에 최대 ${RUN_WAIT_MS / 1000}초 기다립니다). 사용자는 패널 UI 테스트 탭에서 진행을 봅니다.`,
  ].join('\n')
}

const changedText = (item: ScenarioInfo): string => item.changed.map((change) => `${change.path}${change.state === 'missing' ? '(없음)' : ''}`).join(', ')

/** 패널용 — 그 결과의 첫 실패 (단계 · 오류 · 갈래) */
function lastFailure(item: CaseResult | undefined): { step?: string; error?: string; kind?: string; row?: string } | undefined {
  if (!item || item.status !== 'failed') return undefined
  const row = item.rows?.find((candidate) => candidate.status === 'failed')
  const steps = row ? row.steps : item.steps
  const step = steps.find((candidate) => candidate.status === 'failed')
  const kind = step?.failKind ?? row?.failKind ?? item.failKind
  const error = step?.error ?? row?.error ?? item.error
  return { ...(step && { step: step.title }), ...(error && { error: error.slice(0, 400) }), ...(kind && { kind: FAIL_LABEL[kind] }), ...(row && { row: `${row.row}행 (${row.label})` }) }
}

function selectorOf(args: Record<string, unknown>): Selector {
  return {
    ...(Array.isArray(args['scenarios']) && args['scenarios'].length > 0 && { scenarios: args['scenarios'].map(String) }),
    ...(typeof args['screen'] === 'string' && args['screen'] && { screen: args['screen'] }),
    ...(typeof args['request'] === 'string' && args['request'] && { request: args['request'] }),
    ...(args['failed'] === true && { failed: true }),
  }
}

export function createTools(deps: ToolDeps): Tool[] {
  const { workspace } = deps
  const config = workspace.config
  const secrets = [config.password]
  const waitMs = deps.waitMs ?? RUN_WAIT_MS
  const fail = (error: unknown): ToolResult => ({ text: errorText(error, secrets), isError: true })

  /** 기다리는 동안 대화가 호출을 멈추면 수행도 중단한다(사용자가 턴을 멈춘 것 — 브라우저를 계속 돌리지 않는다) */
  async function waitOrInterrupt(runId: string, ms: number, signal: AbortSignal | undefined) {
    const onAbort = (): void => void workspace.interrupt('대화에서 멈춤')
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await workspace.wait(runId, ms)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 수행 하나를 기다려 결과 글로 — 끝났으면 요약, 아직이면 진행 */
  async function awaited(runId: string, started: number, signal?: AbortSignal): Promise<ToolResult | undefined> {
    const result = await waitOrInterrupt(runId, waitMs, signal)
    if (!result) return undefined
    if (result.error) return { text: `실행 실패 — ${result.error}`, isError: true }
    if (result.outcome) return { text: scrub(runSummary(result.outcome, workspace), secrets) }
    return { text: scrub(runningText(workspace.current(), Date.now() - started), secrets) }
  }

  /** 수행 한 번의 그룹 머리용 요약 — 결과서 위치(하나로 같이일 때만) */
  async function groupRun(runId: string | undefined): Promise<{ run: string; at: number; mode: string; report?: string } | undefined> {
    if (!runId || !workspace.store) return undefined
    const run = await workspace.store.getRun(runId)
    if (!run) return undefined
    const first = run.scenarios[0]
    const docs = first ? workspace.documentsOf(runId, run.report, first) : {}
    return { run: runId, at: run.at, mode: run.report, ...(run.report === 'one' && docs.report && { report: docs.report.file }) }
  }

  const list: Tool = {
    name: 'list',
    description:
      'List the UI test scenarios of this project (scenario folder .litecode/plugins/ui-test/scenarios/) — the scenario is the only unit; screens (routes) and requests are tags. For each scenario: id, title, screens it ran on, the chat request that made it, fingerprint (copy it into the spec header), whether generated code exists and is stale (scenario changed after the code was generated), whether the source files recorded in the scenario (sources:) changed, data tables, "## 테스트 방법" and the last real run (pass/fail). Then the groups by screen and by request. Reads the scenario files first, so new files are picked up. Optional filters: scenarios, screen, request, failed.',
    inputSchema: { type: 'object', properties: { ...SELECTOR_PROPS, json: JSON_ARG, cursor: { type: 'string', description: 'JSON only: the cursor of the previous page (200 scenarios per page).' } } },
    async run(args) {
      try {
        const store = workspace.needStore()
        const sel = selectorOf(args)
        const where = `시나리오 폴더: ${config.scenarioDirRel} · 결과서 폴더: ${config.reportDirRel} · 대상 주소: ${config.baseUrl || '(설정 안 됨)'} · 브라우저: ${channelLabel(config.channel)} · 테스트 계정: ${config.user || '(없음)'} · 백엔드 코드: ${config.backendDirs.length ? config.backendDirs.join(', ') : '(프로젝트 안만)'}`
        if (args['json'] === true) {
          const cursor = typeof args['cursor'] === 'string' && args['cursor'] ? args['cursor'] : undefined
          const page = selectorEmpty(sel) ? await store.scenarioPage(cursor) : { items: (await workspace.selectDocs(sel)).items, cursor: undefined }
          const infos = await workspace.infosOf(page.items)
          const scenarios = infos.map((item) => ({
            id: item.id,
            title: item.scenario.name,
            kind: item.scenario.kind,
            file: workspace.rel(item.file),
            screens: item.doc?.screens ?? [],
            request: item.doc?.request ?? null,
            status: item.doc?.last?.status ?? null,
            lastAt: item.doc?.last?.at ?? null,
            lastRun: item.doc?.last?.run ?? null,
            hasCode: item.hasCode,
            hasHistory: existsSync(historyOf(item.file)),
            stale: item.stale,
            changed: item.changed,
            steps: item.scenario.steps.length,
            checks: item.scenario.steps.filter((step) => step.kind !== 'action').length,
            rows: item.scenario.data?.rows.length ?? 0,
          }))
          const first = !cursor
          const screens = first ? await Promise.all((await store.listScreens()).map(async ({ doc }) => ({ route: doc.route, name: doc.name, lastRun: await groupRun(doc.lastRun) ?? null }))) : undefined
          const requests = first ? await Promise.all((await store.listRequests()).map(async ({ id, doc }) => ({ id, text: doc.text, at: doc.at, count: doc.scenarios.length, lastRun: await groupRun(doc.lastRun) ?? null }))) : undefined
          return {
            text: JSON.stringify({
              project: path.basename(config.project),
              scenarioDir: config.scenarioDirRel,
              reportDir: config.reportDirRel,
              baseUrl: config.baseUrl,
              browser: channelLabel(config.channel),
              running: workspace.runningId() ?? null,
              scenarios,
              ...(page.cursor && { cursor: page.cursor }),
              ...(screens && { screens }),
              ...(requests && { requests }),
            }),
          }
        }
        const read = await workspace.reindex()
        const { items } = await workspace.selectDocs(sel)
        const infos = await workspace.infosOf(items)
        const running = workspace.runningId()
        const now = running ? `\n지금 실행 중: ${workspace.current().title} · 수행 id ${running} — report { run } 으로 끝을 기다린다` : ''
        const synced = (read.added + read.updated + read.removed ? `\n파일에서 다시 읽음: 새로 ${read.added} · 바뀜 ${read.updated} · 지워짐 ${read.removed}` : '')
        if (infos.length === 0) return { text: `${where}${now}${synced}\n${selectorEmpty(sel) ? '시나리오가 없습니다 — 화면을 정해 시나리오를 만드세요(스킬 ui-test).' : '조건에 맞는 시나리오가 없습니다.'}` }
        const rows = infos.map((item) => {
          const { scenario, hasCode, specFile } = item
          const last = item.doc?.last
          const marks = [item.stale ? `**코드 낡음** (코드 머리말 지문 ${item.codeFingerprint ?? '없음'} ≠ ${scenario.fingerprint})` : '', item.changed.length ? `**코드 바뀜**: ${changedText(item)}` : ''].filter(Boolean).join(' · ')
          return `- ${item.id}: ${scenario.name}${scenario.kind ? ` [${scenario.kind}]` : ''} · 화면 ${item.doc?.screens.length ? item.doc.screens.join(', ') : '(아직 모름)'}${item.doc?.request ? ` · 요청 ${item.doc.request}` : ''} · 단계 ${scenario.steps.length}${scenario.data ? ` · 데이터 ${scenario.data.rows.length}행 (${scenario.data.columns.join(', ')})` : ''} · 지문 ${scenario.fingerprint} · 코드 ${hasCode ? workspace.rel(specFile) : '없음'} · 테스트 방법 ${scenario.method.length ? '있음' : '없음'}${last ? ` · 마지막 ${STATUS[last.status]} (${when(last.at)})` : ' · 아직 실행 안 함'}${marks ? ` · ${marks}` : ''}`
        })
        const byScreen = new Map<string, string[]>()
        const byRequest = new Map<string, string[]>()
        for (const item of infos) {
          for (const route of item.doc?.screens ?? []) byScreen.set(route, [...(byScreen.get(route) ?? []), item.id])
          if (item.doc?.request) byRequest.set(item.doc.request, [...(byRequest.get(item.doc.request) ?? []), item.id])
        }
        const names = new Map((await store.listScreens()).map(({ doc }) => [doc.route, doc.name]))
        const requests = new Map((await store.listRequests()).map(({ id, doc }) => [id, doc.text]))
        const screens = [...byScreen].map(([route, ids]) => `- ${route}${names.get(route) && names.get(route) !== route ? ` (${names.get(route)})` : ''}: ${ids.length}개 — ${ids.join(', ')}`)
        const asked = [...byRequest].map(([id, ids]) => `- ${id} "${(requests.get(id) ?? '').slice(0, 60)}": ${ids.length}개`)
        return { text: [where + now + synced, '', `시나리오 ${infos.length}개`, ...rows, '', '화면별(화면 태그 — "확인:" 단계를 실행한 주소):', ...(screens.length ? screens : ['- (아직 실행하지 않아 화면 태그가 없는 시나리오뿐)']), '', '요청별:', ...(asked.length ? asked : ['- (요청 태그 없음)']), '', `AI 없이: ${cliCommand(deps.serverFile)}`].join('\n') }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const run: Tool = {
    name: 'run',
    description: `Run UI test scenarios in the PC's installed Chrome/Edge: each generated spec (.spec.mjs next to its scenario) step by step with a screenshot per step (scenarios with a ## 데이터 table run once per row), then write the HTML report(s) and compare with the last real run of each scenario (new failures / fixed / still failing). Choose the scenarios with scenarios / screen / request / failed (all that match; none = every scenario). Always one report per scenario (in its own folder). Hidden browser by default. Waits up to ${RUN_WAIT_MS / 1000} s: if the run is done, returns per-step results with the selectors/waits each step used, the screens the "확인:" steps ran on and a failure kind per failure; otherwise returns the run id — then call report { run } until it is done. Warns when a scenario's code is stale. Without the app's record store the run still happens but nothing is recorded.`,
    inputSchema: {
      type: 'object',
      properties: {
        ...SELECTOR_PROPS,
        headed: { type: 'boolean', description: 'Show the browser window (default false = 화면 없이, the browser runs hidden). true = 보면서.' },
      },
    },
    async run(args, signal) {
      const at = Date.now()
      try {
        const started = await workspace.start({ ...selectorOf(args), ...(typeof args['headed'] === 'boolean' && { headed: args['headed'] }) })
        return (await awaited(started.runId, at, signal)) ?? { text: '수행 기록을 찾지 못했습니다', isError: true }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const report: Tool = {
    name: 'report',
    description: `Results of one run (by run id) or of the last run of a scenario: per-scenario results and the report file path(s). Without arguments, waits for the run that is going now. If that run is still going, waits up to ${RUN_WAIT_MS / 1000} s for it and says how far it got.`,
    inputSchema: { type: 'object', properties: { run: { type: 'string', description: 'Run id from run.' }, scenario: { type: 'string', description: 'A scenario id — its last run (and its recent results).' } } },
    async run(args, signal) {
      try {
        let wanted = typeof args['run'] === 'string' && args['run'] ? args['run'] : undefined
        let history: string[] = []
        if (!wanted && typeof args['scenario'] === 'string' && args['scenario']) {
          const { items } = await workspace.selectDocs({ scenarios: [args['scenario']] })
          const doc = items[0]?.doc
          if (!doc) return { text: `없는 시나리오: ${args['scenario']}`, isError: true }
          const results = await workspace.needStore().resultsOfScenario(items[0]!.id, doc.recent)
          wanted = results[0]?.run
          if (!wanted) return { text: `${args['scenario']}: 아직 실행 기록이 없습니다` }
          history = results.map((item: ResultDoc) => `- ${item.run} · ${STATUS[item.status]} · ${when(item.at)}`)
        }
        const running = workspace.runningId()
        const at = Date.now()
        const target = wanted ?? running
        if (!target) return { text: 'run 또는 scenario 를 주세요 (지금 실행 중인 수행이 없습니다)', isError: true }
        // 이 서버가 시작한 수행이면 끝을 기다린다(오류 포함) — 끝났으면 아래에서 같이
        const waited = await waitOrInterrupt(target, target === running ? waitMs : 0, signal)
        if (waited?.error) return { text: `실행 실패 — ${waited.error}`, isError: true }
        if (waited && !waited.outcome) return { text: scrub(runningText(workspace.current(), Date.now() - at), secrets) }
        const picked = await workspace.runOf(target)
        if (!picked) return { text: `수행 기록이 없습니다: ${target}`, isError: true }
        return { text: scrub([runSummary(picked, workspace), ...(history.length ? ['', `${args['scenario']} 의 최근 결과 (${history.length}):`, ...history] : [])].join('\n'), secrets) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const guide: Tool = {
    name: 'guide',
    description:
      'Write the user-guide form of a run as HTML (guide.html next to the report; with report "each", one per scenario folder): the screen walked through step by step in the order of use, each step with its screenshot, failed steps in red with the cause (nothing is left out). Use it when the user wants the final result as a guide document instead of / besides the report table, or the panel setting "결과서 + 가이드" asks for it. Does not run anything; uses the given run (id from run/report) and the screenshots still kept for it. Returns the file path(s).',
    inputSchema: { type: 'object', properties: { run: { type: 'string', description: 'Run id from run/report.' }, json: JSON_ARG }, required: ['run'] },
    async run(args) {
      if (typeof args['run'] !== 'string' || !args['run']) return { text: 'run 이 필요합니다', isError: true }
      if (workspace.runningId() === args['run']) return { text: '실행 중입니다 — 끝난 뒤(report 로 끝을 확인) 다시 불러 주세요', isError: true }
      try {
        const files = await workspace.writeGuide(args['run'])
        if (args['json'] === true) return { text: JSON.stringify({ files: files.map((item) => workspace.rel(item.file)) }) }
        const picked = await workspace.runOf(args['run'])
        return { text: scrub(`가이드: ${files.map((item) => workspace.rel(item.file)).join(' · ')}${picked ? `\n수행 ${picked.run.id} · ${counts(picked.run)}` : ''}`, secrets) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const remove: Tool = {
    name: 'delete',
    description: 'Panel only (after the user confirmed): delete scenarios — chosen with scenarios / screen / request (a whole group, including scenarios that span other screens). Removes their md and generated code, their records, screenshots and the reports (a run whose only scenarios were these is removed whole; other one-report runs are rewritten without them). Returns JSON { scenarios, files, runs }.',
    inputSchema: { type: 'object', properties: SELECTOR_PROPS },
    async run(args) {
      try {
        return { text: JSON.stringify(await workspace.remove(selectorOf(args))) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const detail: Tool = {
    name: 'detail',
    description: 'Panel only: one scenario as JSON — its md text, steps, tags (screens, request), state (code stale/changed), the steps and screenshots of its latest result, and its recent results (run id, time, status, report / guide files).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Scenario id.' } }, required: ['id'] },
    async run(args) {
      try {
        const store = workspace.needStore()
        if (typeof args['id'] !== 'string' || !args['id']) return { text: 'id 가 필요합니다', isError: true }
        const doc = await store.getScenario(args['id'])
        const [info] = doc ? await workspace.infosOf([{ id: args['id'], doc }]) : []
        if (!doc || !info) return { text: `없는 시나리오: ${args['id']}`, isError: true }
        const results = await store.resultsOfScenario(info.id, doc.recent)
        const modes = new Map<string, 'one' | 'each'>()
        for (const item of results) modes.set(item.run, (await store.getRun(item.run))?.report ?? 'one')
        const request = doc.request ? await store.getRequest(doc.request) : null
        const latest = results[0]
        return {
          text: JSON.stringify({
            id: info.id,
            title: info.scenario.name,
            kind: info.scenario.kind ?? null,
            file: workspace.rel(info.file),
            source: info.scenario.source,
            screens: doc.screens,
            request: request ? { id: doc.request, text: request.text, at: request.at } : null,
            status: doc.last?.status ?? null,
            hasCode: info.hasCode,
            stale: info.stale,
            changed: info.changed,
            steps: info.scenario.steps.map(({ no, text, kind }) => ({ no, text, kind })),
            ...(info.scenario.data && { data: info.scenario.data }),
            method: info.scenario.method,
            latest: latest ? { run: latest.run, at: latest.at, status: latest.status, steps: latest.steps.map(({ used: _used, ...rest }) => rest), ...(latest.rows && { rows: latest.rows.map(({ steps, ...rest }) => ({ ...rest, steps: steps.map(({ used: _used, ...step }) => step) })) }), ...(latest.error && { error: latest.error.slice(0, 400) }), urls: latest.urls } : null,
            results: results.map((item) => ({ run: item.run, at: item.at, status: item.status, durationMs: item.durationMs, failure: lastFailure(caseOf(item)) ?? null, ...workspace.documentsOf(item.run, modes.get(item.run) ?? 'one', item.scenario) })),
          }),
        }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const reindexTool: Tool = {
    name: 'reindex',
    description: 'Panel only: re-read the scenario files and fix the record store (new files added, changed ones updated, deleted ones removed with their records, screenshots and report sections). Returns JSON { added, updated, removed }.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      try {
        const { added, updated, removed } = await workspace.reindex()
        return { text: JSON.stringify({ added, updated, removed }) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const pdf: Tool = {
    name: 'pdf',
    description: 'Panel only: print a run\'s report (index.html) or guide (guide.html) to a PDF file next to it (index.pdf / guide.pdf, headless browser). With report "each", scenario picks the scenario folder. Returns JSON { path (project-relative), name (suggested file name) } — the service then lets the user save it with project.exportFile.',
    inputSchema: { type: 'object', properties: { run: { type: 'string' }, kind: { type: 'string', enum: ['report', 'guide'] }, scenario: { type: 'string' } }, required: ['run', 'kind'] },
    async run(args) {
      const kind = args['kind']
      if (typeof args['run'] !== 'string' || (kind !== 'report' && kind !== 'guide')) return { text: 'run 과 kind(report | guide) 가 필요합니다', isError: true }
      try {
        return { text: JSON.stringify(await workspace.pdf(args['run'], kind, typeof args['scenario'] === 'string' && args['scenario'] ? args['scenario'] : undefined)) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const fingerprint: Tool = {
    name: 'fingerprint',
    description:
      'Fingerprints of the source files a scenario was drafted from (front-end and back-end code: project-relative paths, or absolute paths inside the back-end code folders that `list` shows). Returns the exact `sources: [...]` front-matter line to put in the scenario md, so `list` can later mark the scenario "코드 바뀜" when any of those files change.',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths of the screen/server files you read — project-relative, or absolute inside a back-end code folder.' } }, required: ['files'] },
    async run(args) {
      const files = Array.isArray(args['files']) ? args['files'].map(String).filter(Boolean) : []
      if (files.length === 0) return { text: 'files 가 필요합니다', isError: true }
      try {
        return { text: await workspace.sourcesLine(files) }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const newRequest: Tool = {
    name: 'newRequest',
    description:
      'Start a new batch of scenarios for one chat request: returns the request id, the file names to use (`<request id>-01.md`, `-02.md`, … plus the same-named `.spec.mjs`, directly in the scenario folder .litecode/plugins/ui-test/scenarios/) and the two front-matter lines (`request:` with the request text, `requested:` with the time) to put in every scenario md of this request. Call it once per user request, before writing the files. Does not write anything.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: "The user's chat request, as asked (one line)." } }, required: ['text'] },
    async run(args) {
      const text = typeof args['text'] === 'string' ? args['text'].replace(/\s+/g, ' ').replace(/"/g, "'").trim() : ''
      if (!text) return { text: 'text 가 필요합니다', isError: true }
      const taken = await fs.readdir(config.scenarioDir).catch(() => [] as string[])
      const at = new Date()
      let id = timeId(at)
      for (let seq = 2; taken.some((name) => name.startsWith(`${id}-`)); seq++) id = timeId(at, seq)
      return {
        text: [
          `요청 id: ${id}`,
          `파일 이름: ${config.scenarioDirRel}/${id}-01.md · ${id}-02.md … (생성 코드는 같은 이름의 .spec.mjs). 번호는 01 부터.`,
          '모든 시나리오 md 의 머리에 넣을 줄:',
          `request: "${text}"`,
          `requested: ${at.toISOString()}`,
        ].join('\n'),
      }
    },
  }

  const progress: Tool = {
    name: 'progress',
    description: 'Panel only: the current or last run progress as JSON.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const now = workspace.current()
      return { text: JSON.stringify({ ...now, ...(now.report && { report: workspace.rel(now.report) }), ...(now.reports && { reports: now.reports.map((item) => ({ ...item, file: workspace.rel(item.file) })) }) }) }
    },
  }

  const stop: Tool = {
    name: 'stop',
    description: 'Panel only: stop the current run.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return { text: (await workspace.stop()) ? '멈추는 중' : '실행 중이 아닙니다' }
    },
  }

  const shot: Tool = {
    name: 'shot',
    description: 'Panel only: one screenshot as a data URL.',
    inputSchema: { type: 'object', properties: { run: { type: 'string' }, name: { type: 'string' } }, required: ['run', 'name'] },
    async run(args) {
      try {
        const bytes = await workspace.shot(String(args['run']), String(args['name']))
        return { text: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` }
      } catch (error) {
        return fail(error)
      }
    },
  }

  const check: Tool = {
    name: 'check',
    description: 'Settings form check: open the target address headless. Not useful to the assistant.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      if (!config.baseUrl) return { text: '대상 주소가 비어 있습니다', isError: true }
      if (config.backendIgnored.length) return { text: `백엔드 코드 폴더는 절대 경로로 적어 주세요: ${config.backendIgnored.join(', ')}`, isError: true }
      const missing = config.backendDirs.filter((dir) => !existsSync(dir))
      if (missing.length) return { text: `백엔드 코드 폴더가 없습니다: ${missing.join(', ')}`, isError: true }
      try {
        const result = await deps.checkDriver().check(config.baseUrl)
        const backend = config.backendDirs.length ? `\n백엔드 코드 폴더 ${config.backendDirs.length}개 확인` : ''
        return { text: scrub(result.text + backend, secrets), ...(!result.ok && { isError: true }) }
      } catch (error) {
        return { text: scrub(error instanceof Error ? error.message : String(error), secrets).split('\n')[0]!, isError: true }
      }
    },
  }

  return [list, run, report, guide, newRequest, fingerprint, progress, stop, shot, remove, detail, reindexTool, pdf, check]
}

export const TOOL_NAMES = ['list', 'run', 'report', 'guide', 'newRequest', 'fingerprint', 'progress', 'stop', 'shot', 'delete', 'detail', 'reindex', 'pdf', 'check']

export const serverFileOf = (argv1: string | undefined): string => path.resolve(argv1 ?? 'ui-test.mjs')
