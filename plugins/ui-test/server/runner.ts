// 실행기 (#1248, 0.7.0) — 시나리오를 고르고(직접 · 화면 · 요청 · 실패한 것), 드라이버로 실행하고, 결과서를 쓰고, 기록을 남긴다.
//   <프로젝트>/.litecode/plugins/ui-test/scenarios/<시나리오>.md · <시나리오>.spec.mjs(생성 코드, 시나리오 옆에 같은 이름) — 하위 폴더 없음
//   결과서: <프로젝트>/.litecode/plugins/ui-test/reports/<수행 id>/index.html (하나로 같이 — 시나리오마다 절 `#s-<시나리오 id>`)
//          <프로젝트>/.litecode/plugins/ui-test/reports/<수행 id>/<시나리오 id>/index.html (시나리오마다 따로)
//   스크린샷: 앱 데이터 폴더 shots/<수행 id>/
//   기록 · 색인: host.db (store.ts) — 서버가 DB 를 못 쓰면(앱 밖 실행) 실행 · 결과서는 되고 기록 · 비교만 건너뛴다
// 한 번에 수행 하나. 진행은 패널이 progress 로 본다. 수행은 start 로 시작만 하고 바로 돌아온다 — 엔진의 MCP 도구 호출 기한(5분)보다 긴 수행도 돌게, 도구는 wait 로 끝을 기다린다.
// 시나리오마다 "코드 낡음"(생성 코드 머리말의 지문 ≠ 지금 시나리오 지문) · "코드 바뀜"(머리 sources 의 파일 지문이 달라짐)을 본다.

import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Config } from './config.ts'
import { guardPluginPath, scrub, sourceFile } from './config.ts'
import { driverFor, type Driver, type Launch } from './driver.ts'
import { DataFiles, isRunId } from './files.ts'
import { renderGuide } from './guide.ts'
import { compareFor, compareWithLast } from './history.ts'
import { reindex, scanScenarios, type Found, type ReindexResult } from './reindex.ts'
import { removeScenarioFiles, specOf } from './remove.ts'
import { anchorOf, renderReport, type ReportInput } from './report.ts'
import { parseScenario, sourceFingerprint, specHeader } from './scenario.ts'
import { isValidId, openStore, StoreError, timeId, toResultDoc, type Db, type Dropped, type ResultDoc, type RunDoc, type RunTarget, type ScenarioDoc, type Store } from './store.ts'
import { normalizeRoute, routesOf } from './tag.ts'
import type { CaseResult, RunRecord, Scenario, StepResult } from './types.ts'

/** 결과서 · 가이드 HTML 옆에 두는 PDF 경로 */
const pdfOf = (html: string): string => html.replace(/\.html$/, '.pdf')

export interface SourceChange {
  path: string
  state: 'changed' | 'missing'
}

export interface ScenarioInfo {
  /** 시나리오 id (store.ts scenarioIdForFile) */
  id: string
  scenario: Scenario
  /** 절대 경로 */
  file: string
  specFile: string
  hasCode: boolean
  /** 생성 코드 머리말의 지문 */
  codeFingerprint?: string
  /** 코드가 있고, 머리말 지문이 지금 시나리오 지문과 다르다 — 시나리오가 코드를 만든 뒤 바뀌었다 */
  stale: boolean
  /** sources 중 지문이 달라졌거나 없어진 파일 */
  changed: SourceChange[]
  /** 저장소의 줄 — 앱 밖 실행(DB 없음)이면 없다 */
  doc?: ScenarioDoc
}

/** 실행 · 삭제할 시나리오를 고르는 말 — 여럿을 주면 모두 맞는 것(교집합), 아무것도 안 주면 전부 */
export interface Selector {
  /** 시나리오 id · 제목 · 파일 이름 */
  scenarios?: string[]
  /** 화면 — 라우트 패턴(`/admin/menu`) 또는 화면 이름 */
  screen?: string
  /** 요청 id */
  request?: string
  /** 마지막 실행이 실패인 것만 */
  failed?: boolean
}

export type ReportMode = 'one' | 'each'

export interface ReportFile {
  /** 시나리오마다 따로일 때 그 시나리오 id */
  scenario?: string
  /** 절대 경로 */
  file: string
}

export interface Progress {
  running: boolean
  /** 결과서 · 가이드 제목 — 화면 · 요청 · 시나리오 이름 */
  title?: string
  target?: RunTarget
  runId?: string
  startedAt?: number
  headed?: boolean
  browser?: string
  mode?: ReportMode
  cases: { id: string; title: string; status: CaseResult['status'] | 'waiting' | 'running'; durationMs?: number; steps: StepResult[]; rows?: CaseResult['rows'] }[]
  /** 코드 낡음으로 시작한 시나리오 */
  stale?: string[]
  /** 끝난 수행의 결과서 (하나로 같이면 하나, 시나리오마다 따로면 시나리오마다) */
  reports?: ReportFile[]
  /** 끝난 수행의 결과서 첫 파일 */
  report?: string
  /** 기록을 남겼나 — false 면 앱 밖 실행(DB 없음) 또는 기록 저장 실패 */
  recorded?: boolean
  error?: string
}

export interface RunArgs extends Selector {
  /** 여러 개를 실행할 때 결과서 방식 — 시나리오 하나면 묻지 않고 하나로 */
  report?: ReportMode
  headed?: boolean
}

/** 결과서 · 가이드가 시나리오 원문 · 파일 위치를 보이는 데 쓰는 것 */
export type Located = Pick<ScenarioInfo, 'scenario' | 'file' | 'specFile'>

export interface RunOutcome {
  run: RunRecord
  mode: ReportMode
  title: string
  reports: ReportFile[]
  /** 기록을 남겼나 */
  recorded: boolean
  recordError?: string
  /** 결과서 폴더가 프로젝트 안인데 .gitignore 에 없고, 처음 만든 결과서 */
  suggestGitignore?: string
  /** 코드가 낡은 채로 실행한 시나리오 */
  stale?: string[]
  /** 결과서 · 가이드를 다시 쓸 때 쓰는 시나리오 위치 */
  located: Map<string, Located>
}

/** 시작한 수행 — done 은 끝나면 풀린다 */
export interface Started {
  runId: string
  title: string
  total: number
  stale: string[]
  done: Promise<RunOutcome>
}

/** 기다린 결과 — 끝났으면 outcome, 오류면 error, 아직이면 둘 다 없다 */
export interface Waited {
  outcome?: RunOutcome
  error?: string
}

const DB_UNAVAILABLE = 'db-unavailable'

export const selectorEmpty = (sel: Selector): boolean => !sel.scenarios?.length && !sel.screen && !sel.request && !sel.failed

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, index) => item === b[index])

/** 결과 문서 → 결과서가 그리는 케이스 */
export function caseOf(doc: ResultDoc): CaseResult {
  return { id: doc.scenario, title: doc.title, status: doc.status, durationMs: doc.durationMs, steps: doc.steps, ...(doc.error !== undefined && { error: doc.error }), ...(doc.failKind && { failKind: doc.failKind }), ...(doc.rows && { rows: doc.rows }) }
}

export class Workspace {
  readonly files: DataFiles
  readonly store: Store | undefined
  private progress: Progress = { running: false, cases: [] }
  private stopRequested = false
  private driver: Driver | undefined
  private started: Started | undefined
  /** 끝난 수행 — 수행 id → 결과(오류). 최근 몇 개만 */
  private finished = new Map<string, Waited>()
  private interruptReason: string | undefined

  constructor(
    readonly config: Config,
    private readonly launch?: Launch,
    db?: Db,
  ) {
    this.files = new DataFiles(config.dataDir, config.project)
    this.store = db ? openStore(db) : undefined
  }

  rel(file: string): string {
    const relative = path.relative(this.config.project, file)
    return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative.split(path.sep).join('/')
  }

  /** 기록 저장소 — 앱 밖 실행(DB 없음)이면 db-unavailable */
  needStore(): Store {
    if (!this.store) throw new StoreError(DB_UNAVAILABLE)
    return this.store
  }

  // ── 시나리오 읽기 ──

  /** 시나리오 한 개의 파일 상태 — md · 생성 코드 · 코드 낡음 · 코드 바뀜 */
  private async locate(id: string, file: string, doc?: ScenarioDoc, parsed?: Scenario): Promise<ScenarioInfo> {
    const abs = path.resolve(this.config.project, file)
    const specFile = specOf(abs)
    const scenario = parsed ?? parseScenario(id, await fs.readFile(abs, 'utf8'))
    const code = await fs.readFile(specFile, 'utf8').catch(() => undefined)
    const codeFingerprint = code === undefined ? undefined : specHeader(code).fingerprint
    return {
      id,
      scenario,
      file: abs,
      specFile,
      hasCode: code !== undefined,
      ...(codeFingerprint && { codeFingerprint }),
      stale: code !== undefined && codeFingerprint !== scenario.fingerprint,
      changed: await this.sourceChanges(scenario),
      ...(doc && { doc }),
    }
  }

  /** 저장소의 줄들을 파일 상태와 함께 — 파일이 사라졌으면(reindex 전) 건너뛴다 */
  async infosOf(items: { id: string; doc: ScenarioDoc }[]): Promise<ScenarioInfo[]> {
    const out = await Promise.all(items.map((item) => this.locate(item.id, item.doc.file, item.doc).catch(() => undefined)))
    return out.filter((item): item is ScenarioInfo => item !== undefined)
  }

  private async scanInfos(): Promise<ScenarioInfo[]> {
    const found: Found[] = await scanScenarios(this.config.project, this.config.scenarioDir).catch(() => [])
    return Promise.all(found.map((item) => this.locate(item.id, item.file, undefined, item.scenario)))
  }

  /** 고른 시나리오의 저장소 줄 — 파일 이름 순 */
  async selectDocs(sel: Selector): Promise<{ items: { id: string; doc: ScenarioDoc }[]; target: RunTarget }> {
    const store = this.needStore()
    let items = await store.listScenarios()
    const names = new Map((await store.listScreens()).map((item) => [item.doc.name, item.doc.route]))
    let target: RunTarget = { kind: 'scenarios' }
    if (sel.scenarios?.length) {
      const matches = (id: string, doc: ScenarioDoc, want: string): boolean => {
        const bare = want.replace(/\.(md|spec\.mjs)$/, '')
        return id === want || id === bare || doc.title === want || doc.file.slice(doc.file.lastIndexOf('/') + 1).replace(/\.md$/, '') === bare
      }
      const missing = sel.scenarios.filter((want) => !items.some((item) => matches(item.id, item.doc, want)))
      if (missing.length) throw new Error(`없는 시나리오: ${missing.join(', ')}`)
      items = items.filter((item) => sel.scenarios!.some((want) => matches(item.id, item.doc, want)))
    }
    if (sel.screen) {
      const route = names.get(sel.screen) ?? normalizeRoute(sel.screen)
      items = items.filter((item) => item.doc.screens.includes(route))
      target = { kind: 'screen', value: route }
    }
    if (sel.request) {
      items = items.filter((item) => item.doc.request === sel.request)
      target = { kind: 'request', value: sel.request }
    }
    if (sel.failed) items = items.filter((item) => item.doc.last?.status === 'failed')
    return { items: items.sort((a, b) => (a.doc.file < b.doc.file ? -1 : a.doc.file > b.doc.file ? 1 : 0)), target }
  }

  /** 고른 시나리오 — 앱 밖 실행(DB 없음)이면 파일에서 직접(시나리오 이름만 고를 수 있다) */
  async select(sel: Selector): Promise<{ infos: ScenarioInfo[]; target: RunTarget }> {
    if (!this.store) {
      if (sel.screen || sel.request || sel.failed) throw new StoreError(DB_UNAVAILABLE)
      const all = await this.scanInfos()
      const want = sel.scenarios ?? []
      const hit = (item: ScenarioInfo, name: string): boolean => item.id === name.replace(/\.(md|spec\.mjs)$/, '') || item.scenario.name === name || path.basename(item.file, '.md') === name.replace(/\.(md|spec\.mjs)$/, '')
      const missing = want.filter((name) => !all.some((item) => hit(item, name)))
      if (missing.length) throw new Error(`없는 시나리오: ${missing.join(', ')}`)
      return { infos: want.length ? all.filter((item) => want.some((name) => hit(item, name))) : all, target: { kind: 'scenarios' } }
    }
    const { items, target } = await this.selectDocs(sel)
    return { infos: await this.infosOf(items), target }
  }

  /** sources 의 파일 지문을 지금 내용과 견준다 — 프로젝트 · 백엔드 코드 폴더 밖 · 없는 파일은 missing, 지문 없이 적힌 것은 보지 않는다 */
  async sourceChanges(scenario: Scenario): Promise<SourceChange[]> {
    const out: SourceChange[] = []
    for (const source of scenario.sources) {
      if (!source.fingerprint) continue
      let content: string | undefined
      try {
        content = await fs.readFile(sourceFile(this.config, source.path), 'utf8')
      } catch {
        content = undefined
      }
      if (content === undefined) out.push({ path: source.path, state: 'missing' })
      else if (sourceFingerprint(content) !== source.fingerprint) out.push({ path: source.path, state: 'changed' })
    }
    return out
  }

  /** 파일들의 `sources:` 머리 줄 — AI 가 시나리오를 저장할 때 붙인다 */
  async sourcesLine(files: string[]): Promise<string> {
    const refs: string[] = []
    for (const file of files) {
      const relative = path.isAbsolute(file) ? path.normalize(file) : file.replace(/\\/g, '/').replace(/^\.\//, '')
      let content: string
      try {
        content = await fs.readFile(sourceFile(this.config, relative), 'utf8')
      } catch {
        throw new Error(`읽지 못한 파일: ${relative} (프로젝트 안 상대 경로, 또는 백엔드 코드 폴더 안 절대 경로)`)
      }
      refs.push(`${relative}@${sourceFingerprint(content)}`)
    }
    return `sources: [${refs.join(', ')}]`
  }

  // ── 진행 · 멈춤 ──

  current(): Progress {
    return this.progress
  }

  /** 중단 — 대화가 도구 호출을 멈췄거나 서버가 내려갈 때. 브라우저를 닫고, 실행한 데까지 결과서 · 기록을 "중단됨" 으로 남긴다(ms 까지 기다림) */
  async interrupt(reason: string, ms = 15_000): Promise<boolean> {
    const started = this.started
    if (!this.progress.running || !started) return false
    this.interruptReason = reason
    await this.stop()
    await this.wait(started.runId, ms)
    return true
  }

  /** 지금 수행의 id (없으면 undefined) */
  runningId(): string | undefined {
    return this.progress.running ? this.started?.runId : undefined
  }

  /** 지금 수행 중인 시나리오 id */
  private runningScenarios(): string[] {
    return this.progress.running ? this.progress.cases.map((item) => item.id) : []
  }

  /** 수행 하나를 ms 까지 기다린다 — 끝났으면 결과, 아직이면 빈 것. 모르는 id 면 undefined */
  async wait(runId: string, ms: number): Promise<Waited | undefined> {
    const done = this.finished.get(runId)
    if (done) return done
    const started = this.started
    if (!started || started.runId !== runId) return undefined
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<Waited>((resolve) => (timer = setTimeout(() => resolve({}), ms)))
    const settled = started.done.then(
      (outcome): Waited => ({ outcome }),
      (error: unknown): Waited => ({ error: scrub(error instanceof Error ? error.message : String(error), [this.config.password]) }),
    )
    try {
      return await Promise.race([settled, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  async stop(): Promise<boolean> {
    if (!this.progress.running) return false
    this.stopRequested = true
    await this.driver?.stop()
    return true
  }

  // ── 실행 ──

  /** 끝날 때까지 — CLI · 시험 */
  async run(args: RunArgs): Promise<RunOutcome> {
    return (await this.start(args)).done
  }

  /** 결과서 · 가이드 제목 — 화면 · 요청 이름, 아니면 시나리오 이름 */
  private async titleOf(target: RunTarget, infos: ScenarioInfo[]): Promise<string> {
    if (target.kind === 'screen') return (await this.store?.getScreen(target.value))?.name || target.value
    if (target.kind === 'request') {
      const text = (await this.store?.getRequest(target.value))?.text ?? target.value
      return text.length > 40 ? `${text.slice(0, 40)}…` : text
    }
    return infos.length === 1 ? infos[0]!.scenario.name : `시나리오 ${infos.length}개`
  }

  /** 수행을 시작하고 바로 돌아온다 — 시나리오 선택과 "이미 수행 중" 은 여기서 던진다 */
  async start(args: RunArgs): Promise<Started> {
    if (this.progress.running) throw new Error(`이미 수행 중입니다 — ${this.progress.title}`)
    // 방금 AI 가 쓴 시나리오 파일(과 사용자가 지운 것)을 저장소에 맞춘다
    if (this.store) await this.reindex()
    const { infos, target } = await this.select(args)
    if (infos.length === 0) throw new Error(args.failed ? '마지막 실행이 실패인 시나리오가 없습니다' : '실행할 시나리오가 없습니다')
    if (this.progress.running) throw new Error(`이미 수행 중입니다 — ${this.progress.title}`)
    const driver = driverFor('web', { channel: this.config.channel }, this.launch)
    const startedAt = Date.now()
    const runId = this.store ? await this.store.newRunId() : timeId(new Date(startedAt))
    const headed = args.headed ?? false
    const mode: ReportMode = infos.length === 1 ? 'one' : (args.report ?? 'one')
    const title = await this.titleOf(target, infos)
    const stale = infos.filter((item) => item.stale).map((item) => item.id)
    this.driver = driver
    this.stopRequested = false
    this.interruptReason = undefined
    this.progress = {
      running: true,
      title,
      target,
      runId,
      startedAt,
      headed,
      browser: driver.browserName(),
      mode,
      cases: infos.map((item) => ({ id: item.id, title: item.scenario.name, status: 'waiting', steps: [] })),
      ...(stale.length && { stale }),
    }
    const done = this.execute(infos, target, driver, runId, startedAt, headed, mode, title, stale)
    const started: Started = { runId, title, total: infos.length, stale, done }
    this.started = started
    done.then(
      (outcome) => this.remember(runId, { outcome }),
      (error: unknown) => this.remember(runId, { error: scrub(error instanceof Error ? error.message : String(error), [this.config.password]) }),
    )
    return started
  }

  private remember(runId: string, result: Waited): void {
    this.finished.set(runId, result)
    for (const key of [...this.finished.keys()].slice(0, -5)) this.finished.delete(key)
  }

  /** 수행의 결과서 파일들 — 하나로 같이는 수행 폴더 하나, 시나리오마다 따로는 시나리오 폴더마다 */
  reportFiles(runId: string, mode: ReportMode, ids: string[]): ReportFile[] {
    if (!isRunId(runId)) throw new Error(`수행 id 가 틀렸습니다: ${runId}`)
    const base = path.join(this.config.reportDir, runId)
    if (mode === 'one') return [{ file: path.join(base, 'index.html') }]
    return ids.map((id) => {
      if (!isValidId(id)) throw new Error(`시나리오 id 가 틀렸습니다: ${id}`)
      return { scenario: id, file: path.join(base, id, 'index.html') }
    })
  }

  private async execute(infos: ScenarioInfo[], target: RunTarget, driver: Driver, runId: string, startedAt: number, headed: boolean, mode: ReportMode, title: string, stale: string[]): Promise<RunOutcome> {
    const shotsDir = this.files.shotsDir(runId)
    const secrets = [this.config.password]
    try {
      await fs.mkdir(shotsDir, { recursive: true })
      const withCode = infos.filter((item) => item.hasCode)
      const ran = await driver.run(
        withCode.map(({ id, scenario, specFile }) => ({ id, title: scenario.name, steps: scenario.steps, specFile, ...(scenario.data && { data: scenario.data }) })),
        {
          headed,
          baseUrl: this.config.baseUrl,
          account: { name: 'default', user: this.config.user, password: this.config.password },
          secrets,
          stopped: () => this.stopRequested,
          save: async (name, bytes) => {
            await fs.writeFile(path.join(shotsDir, name), bytes)
            return name
          },
          onCase: (index, partial) => {
            const id = withCode[index]?.id
            const row = this.progress.cases.find((item) => item.id === id)
            if (!row) return
            row.steps = [...partial.steps]
            if (partial.rows) row.rows = partial.rows.map((item) => ({ ...item, steps: [...item.steps] }))
            row.status = partial.status ?? 'running'
            if (partial.durationMs !== undefined) row.durationMs = partial.durationMs
          },
        },
      )
      const cases: CaseResult[] = infos.map(({ id, scenario, hasCode }) => ran.find((item) => item.id === id) ?? { id, title: scenario.name, status: hasCode ? 'stopped' : 'no-code', durationMs: 0, steps: [] })
      const { before, previousId } = await this.lastResults(infos)
      const compare = compareWithLast(before, previousId, cases)
      const reports = this.reportFiles(runId, mode, cases.map((item) => item.id))
      const run: RunRecord = { id: runId, startedAt, durationMs: Date.now() - startedAt, headed, browser: driver.browserName(), baseUrl: this.config.baseUrl, cases, report: reports[0]!.file, ...(compare && { compare }), ...(this.interruptReason && { interrupted: this.interruptReason }) }
      const located = new Map(infos.map((item) => [item.id, item] as const))
      await this.writeDocs('report', run, mode, title, located)
      let recorded = false
      let recordError: string | undefined
      if (this.store) {
        try {
          await this.record(run, target, mode, title, infos)
          recorded = true
        } catch (error) {
          recordError = scrub(error instanceof Error ? error.message : String(error), secrets)
        }
      }
      this.progress = { ...this.progress, running: false, reports, report: reports[0]!.file, recorded, cases: cases.map((item) => ({ ...item })) }
      const suggestGitignore = await this.gitignoreHint()
      return { run, mode, title, reports, recorded, ...(recordError && { recordError }), ...(suggestGitignore && { suggestGitignore }), ...(stale.length && { stale }), located }
    } catch (error) {
      this.progress = { ...this.progress, running: false, error: scrub(error instanceof Error ? error.message : String(error), secrets) }
      throw error
    } finally {
      this.driver = undefined
    }
  }

  /** 시나리오마다 마지막으로 실제 실행한(성공 · 실패) 결과 — 비교의 기준. 데이터 표 시나리오는 행마다 */
  private async lastResults(infos: ScenarioInfo[]): Promise<{ before: Map<string, 'passed' | 'failed'>; previousId?: string }> {
    const before = new Map<string, 'passed' | 'failed'>()
    let previousId: string | undefined
    if (!this.store) return { before }
    for (const { id, doc } of infos) {
      const last = doc?.last
      if (!last) continue
      before.set(id, last.status as 'passed' | 'failed')
      if (!previousId || last.run > previousId) previousId = last.run
      const result = await this.store.getResult(id, last.run)
      for (const row of result?.rows ?? []) if (row.status === 'passed' || row.status === 'failed') before.set(`${id}#${row.row}`, row.status)
    }
    return { before, ...(previousId && { previousId }) }
  }

  /** 수행 한 번을 저장소에 — runs · results · 시나리오의 마지막 결과 · 화면 태그 · 그룹의 마지막 수행, 그리고 넘친 결과 정리(파일까지) */
  private async record(run: RunRecord, target: RunTarget, mode: ReportMode, title: string, infos: ScenarioInfo[]): Promise<void> {
    const store = this.needStore()
    const passed = run.cases.filter((item) => item.status === 'passed').length
    const failed = run.cases.filter((item) => item.status === 'failed').length
    const doc: RunDoc = {
      at: run.startedAt,
      durationMs: run.durationMs,
      target,
      scenarios: run.cases.map((item) => item.id),
      totals: { passed, failed, other: run.cases.length - passed - failed },
      ...(run.compare && { compare: run.compare }),
      report: mode,
      title,
      headed: run.headed,
      browser: run.browser,
      baseUrl: run.baseUrl,
      ...(run.interrupted && { interrupted: run.interrupted }),
    }
    const results = run.cases.map((item) => toResultDoc(run.id, run.startedAt, item))
    await store.recordRun(run.id, doc, results)
    const known = new Map(infos.map((item) => [item.id, item.doc]))
    for (const result of results) {
      if (result.status !== 'passed' && result.status !== 'failed') continue
      const routes = routesOf(result.urls)
      // 성공이면 이번에 본 화면이 곧 화면 태그, 실패면 거기까지 본 것을 더한다(확인 단계에 닿기 전에 실패하면 태그가 줄어들지 않게)
      const current = known.get(result.scenario)?.screens ?? []
      const screens = routes.length ? (result.status === 'passed' ? routes : [...new Set([...current, ...routes])]) : current
      await store.upsertScenario(result.scenario, { last: { status: result.status, at: run.startedAt, run: run.id }, ...(routes.length > 0 && !same(screens, current) && { screens }), ...(routes.length > 0 && { observed: true }) })
    }
    await store.markGroupRun(target, run.id)
    await this.cleanup(await store.pruneResults(run.cases.map((item) => item.id)))
  }

  // ── 파일 정리 ──

  /** 지워진 결과의 스크린샷 · 결과서를 치운다 — 결과가 모두 없어진 수행은 결과서 폴더째, 하나로 같이 낸 수행은 남은 시나리오로 다시 쓴다, 시나리오마다 따로 낸 것은 그 폴더만 */
  async cleanup(dropped: Dropped): Promise<void> {
    const store = this.store
    const gone = new Set(dropped.runs.filter(isRunId))
    const rewrite = new Set<string>()
    for (const result of dropped.results) {
      if (!isRunId(result.run)) continue
      const dir = this.files.shotsDir(result.run)
      for (const name of result.shots) await fs.rm(path.join(dir, path.basename(name)), { force: true })
      if (gone.has(result.run) || !store) continue
      const run = await store.getRun(result.run)
      if (!run) continue
      if (run.report === 'each' && isValidId(result.scenario)) await this.removeReports(result.run, result.scenario)
      else rewrite.add(result.run)
    }
    for (const runId of gone) {
      await this.removeReports(runId)
      await fs.rm(this.files.shotsDir(runId), { recursive: true, force: true })
    }
    for (const runId of rewrite) await this.rewriteRun(runId)
  }

  /** 결과서 폴더 안 수행 폴더(또는 그 안 시나리오 폴더)를 지운다 — 수행 id · 시나리오 id 모양일 때만, 실제 경로가 플러그인 폴더 안일 때만(심볼릭 링크가 밖을 가리키면 건너뛴다) */
  private async removeReports(runId: string, scenarioId?: string): Promise<void> {
    if (!isRunId(runId) || (scenarioId !== undefined && !isValidId(scenarioId))) return
    const dir = path.join(this.config.reportDir, runId, ...(scenarioId ? [scenarioId] : []))
    if (await guardPluginPath(this.config.project, dir).then(() => false, () => true)) return // 밖을 가리키면 지우지 않고 넘어간다(정리가 던지면 삭제가 반쯤 끝난 채 멈춘다)
    await fs.rm(dir, { recursive: true, force: true })
  }

  /** 저장소의 수행 하나를 결과서 · 가이드 입력으로 되돌린다 — 정리로 일부 시나리오 결과가 빠진 수행도 남은 것으로 */
  async loadRun(runId: string): Promise<{ run: RunRecord; mode: ReportMode; title: string; located: Map<string, Located> } | undefined> {
    if (!isRunId(runId)) return undefined
    const store = this.needStore()
    const doc = await store.getRun(runId)
    if (!doc) return undefined
    const results = await store.resultsOfRun(doc, runId)
    const order = new Map(doc.scenarios.map((id, index) => [id, index] as const))
    const cases = results.sort((a, b) => (order.get(a.scenario) ?? 0) - (order.get(b.scenario) ?? 0)).map(caseOf)
    const mode = doc.report
    const reports = this.reportFiles(runId, mode, cases.map((item) => item.id))
    const compare = doc.compare
    const run: RunRecord = { id: runId, startedAt: doc.at, durationMs: doc.durationMs, headed: doc.headed ?? false, browser: doc.browser ?? '', baseUrl: doc.baseUrl ?? '', cases, report: reports[0]?.file ?? path.join(this.config.reportDir, runId, 'index.html'), ...(compare && { compare }), ...(doc.interrupted && { interrupted: doc.interrupted }) }
    const located = new Map<string, Located>()
    for (const item of cases) {
      const scenario = await store.getScenario(item.id)
      const info = scenario && (await this.locate(item.id, scenario.file).catch(() => undefined))
      if (info) located.set(item.id, info)
    }
    return { run, mode, title: doc.title ?? '', located }
  }

  /** 지난 수행 하나의 결과서를 다시 쓴다(하나로 같이 낸 수행에서 시나리오가 빠졌을 때) — 가이드가 있었으면 같이 */
  private async rewriteRun(runId: string): Promise<void> {
    const loaded = await this.loadRun(runId)
    if (!loaded || loaded.mode !== 'one' || loaded.run.cases.length === 0) return
    const hadGuide = existsSync(path.join(path.dirname(loaded.run.report), 'guide.html'))
    await this.writeDocs('report', loaded.run, 'one', loaded.title, loaded.located)
    if (hadGuide) await this.writeDocs('guide', loaded.run, 'one', loaded.title, loaded.located)
  }

  // ── 결과서 · 가이드 ──

  /** 결과서 · 가이드가 같이 쓰는 입력 — 수행 기록 · 시나리오 원문 · 남아 있는 스크린샷 */
  private reportInput(run: RunRecord, title: string, located: Map<string, Located>): ReportInput {
    const shotsDir = this.files.shotsDir(run.id)
    const here = run.cases.map((item) => located.get(item.id)).filter((item): item is Located => item !== undefined)
    return {
      run,
      project: path.basename(this.config.project),
      title,
      user: os.userInfo().username,
      scenarios: new Map(here.map(({ scenario }) => [scenario.id, scenario])),
      files: here.map(({ file, specFile }) => ({ scenario: this.rel(file), spec: this.rel(specFile) })),
      image: (shot) => {
        const file = path.join(shotsDir, path.basename(shot))
        return existsSync(file) ? readFileSync(file) : undefined
      },
      secrets: [this.config.password],
    }
  }

  /** 결과서(index.html) 또는 가이드(guide.html)를 수행 방식대로 쓴다 — 하나로 같이는 수행 폴더에 하나, 시나리오마다 따로는 시나리오 폴더마다. 쓴 파일들을 돌려준다 */
  async writeDocs(kind: 'report' | 'guide', run: RunRecord, mode: ReportMode, title: string, located: Map<string, Located>): Promise<ReportFile[]> {
    const name = kind === 'report' ? 'index.html' : 'guide.html'
    const render = kind === 'report' ? renderReport : renderGuide
    const targets = this.reportFiles(run.id, mode, run.cases.map((item) => item.id)).map((item) => ({ ...item, file: path.join(path.dirname(item.file), name) }))
    for (const target of targets) {
      const subset: RunRecord = target.scenario ? { ...run, cases: run.cases.filter((item) => item.id === target.scenario), compare: compareFor(run.compare, target.scenario), report: target.file } : { ...run, report: target.file }
      const input = this.reportInput(subset, target.scenario ? (subset.cases[0]?.title ?? title) : title, located)
      await guardPluginPath(this.config.project, target.file)
      await fs.mkdir(path.dirname(target.file), { recursive: true })
      await fs.writeFile(target.file, render(input))
      await fs.rm(pdfOf(target.file), { force: true }) // 옛 내용으로 만든 PDF 는 남기지 않는다
    }
    return targets
  }

  /** 가이드형 결과물(guide.html)을 그 수행의 결과서 옆에 쓴다 — 스크린샷은 데이터 폴더에 남아 있는 것만 들어간다. 이 서버가 방금 끝낸 수행이면 그 기록으로, 아니면 저장소에서 */
  async writeGuide(runId: string): Promise<ReportFile[]> {
    const outcome = this.finished.get(runId)?.outcome
    if (outcome) return this.writeDocs('guide', outcome.run, outcome.mode, outcome.title, outcome.located)
    const loaded = await this.loadRun(runId)
    if (!loaded) throw new Error(`수행 기록이 없습니다: ${runId}`)
    if (loaded.run.cases.length === 0) throw new Error(`이 수행의 결과가 남아 있지 않습니다: ${runId}`)
    return this.writeDocs('guide', loaded.run, loaded.mode, loaded.title, loaded.located)
  }

  /** 수행 하나의 기록 — 이 서버가 방금 끝낸 수행이면 그것, 아니면 저장소 */
  async runOf(runId: string): Promise<{ run: RunRecord; mode: ReportMode; title: string; reports: ReportFile[]; recorded: boolean; located: Map<string, Located> } | undefined> {
    const outcome = this.finished.get(runId)?.outcome
    if (outcome) return { run: outcome.run, mode: outcome.mode, title: outcome.title, reports: outcome.reports, recorded: outcome.recorded, located: outcome.located }
    if (!this.store) return undefined
    const loaded = await this.loadRun(runId)
    return loaded && { ...loaded, reports: this.reportFiles(runId, loaded.mode, loaded.run.cases.map((item) => item.id)), recorded: true }
  }

  /** 결과 한 건(시나리오 × 수행)의 결과서 · 가이드 — 있는 파일만. 하나로 같이 낸 결과서는 그 시나리오 절의 앵커로 */
  documentsOf(runId: string, mode: ReportMode, scenarioId: string): { report?: { file: string; anchor?: string }; guide?: { file: string } } {
    if (!isRunId(runId) || !isValidId(scenarioId)) return {}
    const dir = mode === 'each' ? path.join(this.config.reportDir, runId, scenarioId) : path.join(this.config.reportDir, runId)
    const report = path.join(dir, 'index.html')
    const guide = path.join(dir, 'guide.html')
    return {
      ...(existsSync(report) && { report: { file: this.rel(report), ...(mode === 'one' && { anchor: anchorOf(scenarioId) }) } }),
      ...(existsSync(guide) && { guide: { file: this.rel(guide) } }),
    }
  }

  /** 결과서 · 가이드를 PDF 로 — 같은 폴더에 `index.pdf` · `guide.pdf` 로 쓰고(그 폴더와 함께 지워진다) 프로젝트 기준 경로와 저장 창에 제안할 이름을 돌려준다.
   *  시나리오마다 따로 낸 수행은 scenario 가 필요하고, 하나로 같이 낸 수행은 scenario 와 상관없이 그 결과서 전체다 */
  async pdf(runId: string, kind: 'report' | 'guide', scenario?: string): Promise<{ path: string; name: string }> {
    if (!isRunId(runId)) throw new Error(`수행 id 가 틀렸습니다: ${runId}`)
    if (this.runningId() === runId) throw new Error('실행 중입니다 — 끝난 뒤 다시 눌러 주세요')
    const picked = await this.runOf(runId)
    if (!picked) throw new Error(`수행 기록이 없습니다: ${runId}`)
    const id = picked.mode === 'each' ? (scenario ?? (picked.run.cases.length === 1 ? picked.run.cases[0]!.id : undefined)) : undefined
    if (picked.mode === 'each' && !id) throw new Error('시나리오마다 따로 낸 수행입니다 — scenario 가 필요합니다')
    if (id && !isValidId(id)) throw new Error(`시나리오 id 가 틀렸습니다: ${id}`)
    const html = path.join(this.config.reportDir, runId, ...(id ? [id] : []), kind === 'report' ? 'index.html' : 'guide.html')
    await guardPluginPath(this.config.project, html)
    if (!existsSync(html)) throw new Error(`${kind === 'report' ? '결과서' : '가이드'} 파일이 없습니다: ${this.rel(html)}`)
    const out = pdfOf(html)
    await driverFor('web', { channel: this.config.channel }, this.launch).pdf(html, out)
    const title = (id ? picked.run.cases.find((item) => item.id === id)?.title : undefined) ?? picked.title
    return { path: this.rel(out), name: `${kind === 'report' ? '결과서' : '화면 가이드'}${title ? ` - ${title}` : ''}`.slice(0, 70) + '.pdf' }
  }

  // ── 저장소 맞추기 · 삭제 ──

  /** 시나리오 폴더의 시나리오 파일로 저장소를 맞춘다(처음에는 옛 ui-tests/ 를 가져온다) — 사용자가 지운 파일의 줄 · 기록 · 스크린샷 · 결과서 절도 같이 지운다 */
  async reindex(): Promise<ReindexResult> {
    const result = await reindex(this.needStore(), { project: this.config.project, pluginDir: this.config.pluginDir, scenarioDir: this.config.scenarioDir })
    await this.cleanup(result.dropped)
    return result
  }

  /** 시나리오 삭제 — 하나 · 여럿 · 화면/요청 그룹(그 태그의 시나리오 전부, 여러 화면에 걸친 것도). 파일(md · 생성 코드) · 저장소 줄 · 결과 · 스크린샷 · 결과서(그 시나리오만 남은 수행은 통째로)까지 */
  async remove(sel: Selector): Promise<{ scenarios: string[]; files: string[]; runs: number }> {
    const store = this.needStore()
    if (selectorEmpty(sel)) throw new Error('지울 시나리오를 골라 주세요 (scenarios · screen · request · failed)')
    const { items } = await this.selectDocs(sel)
    const busy = new Set(this.runningScenarios())
    const hit = items.filter((item) => busy.has(item.id)).map((item) => item.id)
    if (hit.length) throw new Error(`수행 중인 시나리오입니다 — 끝난 뒤(또는 멈춘 뒤) 지워 주세요: ${hit.join(', ')}`)
    const files: string[] = []
    const dropped: Dropped = { results: [], runs: [] }
    for (const { id, doc } of items) {
      files.push(...(await removeScenarioFiles(this.config.project, this.config.scenarioDir, doc.file)).files)
      const part = await store.deleteScenario(id)
      dropped.results.push(...part.results)
      dropped.runs.push(...part.runs)
    }
    await this.cleanup(dropped)
    return { scenarios: items.map((item) => item.id), files, runs: new Set(dropped.runs).size }
  }

  /** 결과서 폴더가 프로젝트 안이고 .gitignore 에 없으면, 처음 한 번만 제안 글 — 플러그인은 .gitignore 를 고치지 않는다 */
  async gitignoreHint(): Promise<string | undefined> {
    const relative = path.relative(this.config.project, this.config.reportDir)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
    const entry = relative.split(path.sep).join('/') + '/'
    const ignore = await fs.readFile(path.join(this.config.project, '.gitignore'), 'utf8').catch(() => '')
    const listed = ignore.split(/\r?\n/).some((line) => line.trim().replace(/^\//, '').replace(/\/?$/, '/') === entry)
    if (listed || !(await this.files.firstTime('gitignore-asked'))) return undefined
    return entry
  }

  /** 스크린샷 하나 (패널 썸네일) — 수행 폴더 밖은 거절 */
  async shot(runId: string, name: string): Promise<Uint8Array> {
    if (!isRunId(runId) || !/^[\w.-]+\.jpg$/.test(name)) throw new Error('스크린샷 이름이 틀렸습니다')
    return fs.readFile(path.join(this.files.shotsDir(runId), name))
  }
}
