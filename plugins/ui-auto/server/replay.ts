// 패널 수행 — LLM 없이 TC 스크립트를 그대로 재생한다(활용 단계 1). AI 가 하던 순서 그대로:
// 진입점 이동 → edges 의 이동 스크립트 → TC 스크립트의 steps(단계마다 캡처) → verify 판정(판정 화면 캡처) → browser_close → 증적 기록.
// 판정: verify 가 안 맞으면 실패, 단계 · 이동이 오류면 차단(스크립트 불일치 — 원인 판단과 고치기는 AI 몫, 스크립트는 그대로 둔다).
// 기록은 AI 가 쓰는 형식 그대로: captures/ · reports/<run_id>.md · logs/<run_id>.md · 페이지 문서(TC 줄 · 수행 이력) · 스크립트 최근 통과일 · system_map.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { login, onLoginPage } from './auth.ts'
import { markedShot, textOf, type Browser, type Caller, type Mark, type ToolResult } from './browser.ts'
import { EVIDENCE_DIR, loginReady, scrub, stamp, type Config } from './config.ts'
import { describeStep as describe, type Evidence, type Route, type Script, type ScriptStep, type TcRow, type VerifyItem } from './evidence.ts'
import { section } from './markdown.ts'
import { appendHistory, applyRun, statusesOf, touchMap, touchScript } from './record.ts'
import { writeAtomic } from './render.ts'
import { writeGuide } from './guide.ts'

export type Verdict = '성공' | '실패' | '차단'

export interface CaseProgress {
  tc: string
  run?: string
  state: '대기' | '수행 중' | Verdict | '건너뜀'
  reason?: string
  step?: number
  total?: number
  /** 이 TC 의 작업 기록 줄 — 패널이 TC 별로 접어 보인다 */
  lines?: string[]
}

export interface Progress {
  running: boolean
  cases: CaseProgress[]
  log: string[]
}

/** 진행에 실어 보내는 TC 마다의 기록 줄 수 */
const CASE_LINES = 60

// ── 순수 부분 (시험이 본다) ──

const NAME = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** `{이름}` 을 값으로 — 문자열 · 배열 · 객체 안까지. 모르는 이름은 그대로 둔다(locator 의 `{ name: … }` 는 공백이 있어 걸리지 않는다) */
export function fill<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(NAME, (all, name: string) => (name in vars ? vars[name]! : all)) as T
  if (Array.isArray(value)) return value.map((item) => fill(item, vars)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, vars)])) as T
  return value
}

/** data 값 → 치환 값. `$이름` 은 testdata.md 에서. 없으면 던진다(지어내지 않는다) */
export function resolveData(data: Record<string, unknown>, testdata: Record<string, string>): { vars: Record<string, string>; shown: string[] } {
  const vars: Record<string, string> = {}
  const shown: string[] = []
  for (const [name, raw] of Object.entries(data)) {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const ref = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(text.trim())
    if (ref) {
      const value = testdata[ref[1]!]
      if (value === undefined) throw new Error(`testdata.md 에 ${ref[1]} 이(가) 없습니다`)
      vars[name] = value
      shown.push(`${name}=${value} (testdata: ${ref[1]})`)
    } else {
      vars[name] = text
      shown.push(`${name}=${text}`)
    }
  }
  return { vars: Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, fill(value, vars)])), shown: shown.map((line) => fill(line, vars)) }
}

const foundCount = (text: string): number | undefined => {
  if (/No matches found/i.test(text)) return 0
  const match = /Found (\d+) match/i.exec(text)
  return match ? Number(match[1]) : undefined
}

function countOk(count: number, rule: string | number): boolean {
  const match = /^\s*(>=|<=|>|<|=)?\s*(\d+)\s*$/.exec(String(rule))
  if (!match) return false
  const want = Number(match[2])
  switch (match[1]) {
    case '>=': return count >= want
    case '<=': return count <= want
    case '>': return count > want
    case '<': return count < want
    default: return count === want
  }
}

/** `### Result` 다음 값 — browser_evaluate 결과는 JSON */
function resultValue(text: string): string {
  const after = /### Result\s*\n([\s\S]*?)(?:\n###|$)/.exec(text)?.[1]?.trim() ?? text.trim()
  try {
    const value: unknown = JSON.parse(after)
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return after
  }
}

/** verify · arrive 한 줄 판정. expect 가 없으면 browser_wait_for 는 오류 없음, browser_find 는 1건 이상 */
export function judge(item: VerifyItem, result: ToolResult, vars: Record<string, string>): { pass: boolean; note: string } {
  const text = textOf(result)
  if (result.isError) return { pass: false, note: firstLine(text) || '오류' }
  const expect = item.expect ?? (item.tool === 'browser_find' ? { found: '>=1' } : { ok: true })
  if (expect.found !== undefined) {
    const count = foundCount(text)
    if (count === undefined) return { pass: false, note: '일치 건수를 읽지 못함' }
    return { pass: countOk(count, expect.found), note: `${count}건 일치 (기대 ${expect.found})` }
  }
  if (expect.equals !== undefined) {
    const want = fill(String(expect.equals), vars)
    const got = resultValue(text)
    return { pass: got === want, note: `결과 "${got}" (기대 "${want}")` }
  }
  return { pass: true, note: '오류 없이 끝남' }
}

const firstLine = (text: string): string => text.replace(/^### Error\s*/m, '').split('\n').map((line) => line.trim()).find(Boolean)?.replace(/^Error:\s*/, '') ?? ''

/** 로그 줄의 핵심 인자 */
function keyArgs(step: ScriptStep): string {
  const args = step.args ?? {}
  const pick = args['target'] ?? args['url'] ?? args['text'] ?? args['key'] ?? args['textGone'] ?? args['regex'] ?? args['filename'] ?? ''
  const extra = step.tool === 'browser_type' ? `, "${String(args['text'] ?? '')}"` : ''
  return `${typeof pick === 'string' ? pick : JSON.stringify(pick)}${extra}`
}

const pageUrlOf = (text: string): string | undefined => /Page URL:\s*(\S+)/.exec(text)?.[1]

/** 단계 뒤 화면 — 도구 결과의 Page URL · Page Title */
export function screenOf(text: string): string {
  const url = pageUrlOf(text)
  const title = /Page Title:\s*(.+)/.exec(text)?.[1]?.trim()
  let where = ''
  try {
    where = url ? new URL(url).pathname : ''
  } catch {
    where = url ?? ''
  }
  return `오류 없이 끝남${title || where ? ` · 화면 ${[title && `"${title}"`, where].filter(Boolean).join(' ')}` : ''}`
}

/** 단계가 손대는 요소 — 캡처에 표시한다. target 하나, 끌기는 시작 · 끝, 폼은 칸마다 */
export function marksOf(step: ScriptStep): Mark[] {
  const args = step.args ?? {}
  const one = (target: unknown, element: unknown): Mark[] => (typeof target === 'string' && target ? [{ target, ...(typeof element === 'string' && element && { element }) }] : [])
  if (Array.isArray(args['fields'])) return args['fields'].flatMap((field: { target?: unknown; name?: unknown; element?: unknown }) => one(field?.target, field?.element ?? field?.name))
  return [...one(args['target'], args['element']), ...one(args['startTarget'], args['startElement']), ...one(args['endTarget'], args['endElement'])]
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
/** 받침이 있으면 을, 없으면 를 — 한글이 아니면 을(를) */
const object = (word: string): string => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return code < 0 || code > 11171 ? '을(를)' : code % 28 ? '을' : '를'
}

/** 보고서 · 가이드의 「설명」 한 문장 — 표시한 요소에 무엇을 하고 무엇이 보여야 하나 */
export function explain(step: ScriptStep, vars: Record<string, string>, number: number, marked: boolean): string {
  const args = fill(step.args ?? {}, vars) as Record<string, unknown>
  const name = String(args['element'] ?? args['startElement'] ?? '').trim() || '대상 요소'
  const sign = marked ? `${CIRCLED[number - 1] ?? `(${number})`} ` : ''
  const thing = `${sign}「${name}」`
  const text = String(args['text'] ?? '')
  const action = (() => {
    switch (step.tool) {
      case 'browser_click': return `${thing}${object(name)} 누릅니다`
      case 'browser_type': return `${thing}에 "${text}"${object(text || name)} 입력합니다`
      case 'browser_select_option': return `${thing}에서 ${(Array.isArray(args['values']) ? args['values'] : []).join(', ')}${object(String((Array.isArray(args['values']) ? args['values'] : []).at(-1) ?? name))} 고릅니다`
      case 'browser_hover': return `${thing} 위에 마우스를 올립니다`
      case 'browser_press_key': return `${String(args['key'] ?? '')} 키를 누릅니다`
      case 'browser_fill_form': return `${sign}표시한 칸 ${Array.isArray(args['fields']) ? args['fields'].length : 0}개를 채웁니다`
      case 'browser_drag': return `${thing}${object(name)} 「${String(args['endElement'] ?? '').trim() || '대상 위치'}」로 끌어다 놓습니다`
      case 'browser_handle_dialog': return `대화상자를 ${args['accept'] ? '수락' : '취소'}합니다`
      default: return `${describe(step)}${marked ? ` (${sign.trim()})` : ''}`
    }
  })()
  return `${action}.${step.expected ? ` 확인: ${fill(step.expected, vars)}` : ''}`
}

/** 진입점 URL — `진입 방법` 칸의 첫 주소, 없으면 대상 주소 */
export function entryUrl(how: string, baseUrl: string): string {
  const absolute = /https?:\/\/[^\s)]+/.exec(how)?.[0]
  if (absolute) return absolute
  const relative = /(^|\s)(\/[^\s)]*)/.exec(how)?.[2]
  return relative ? baseUrl + relative : baseUrl
}

// ── 수행 ──

interface Outcome {
  verdict: Verdict
  reason: string
  arrived: boolean
  /** 캡처마다 — 설명 · 한 일 · 기대 · 실제 · 판정(수행됨 · 멈춤 · 일치 · 다름). 단계 캡처는 그 단계 바로 전 화면 */
  steps: { label: string; capture?: string; description: string; action: string; expected: string; actual: string; verdict: string }[]
  verifyNotes: string[]
  mismatch: string[]
  pageCaptured: boolean
}

export class Replayer {
  private state: Progress = { running: false, cases: [], log: [] }
  private stopped = false

  constructor(
    private readonly config: Config,
    private readonly evidence: Evidence,
    private readonly browser: Browser,
    private readonly nextRunId: () => Promise<string>,
    private readonly doLogin: (config: Config) => Promise<string> = login,
  ) {}

  progress(): Progress {
    return { running: this.state.running, cases: this.state.cases.map((item) => ({ ...item, ...(item.lines && { lines: item.lines.slice(-CASE_LINES) }) })), log: this.state.log.slice(-40) }
  }

  stop(): boolean {
    if (!this.state.running) return false
    this.stopped = true
    return true
  }

  /** 시작만 하고 돌아온다 — 끝까지 기다리려면 돌려준 promise */
  start(tcs: string[]): { started: true; done: Promise<void> } | { started: false; reason: string } {
    if (this.state.running) return { started: false, reason: 'busy' }
    if (!this.browser.take()) return { started: false, reason: 'browser-busy' }
    this.stopped = false
    this.state = { running: true, cases: tcs.map((tc) => ({ tc, state: '대기' })), log: [] }
    const done = (async () => {
      try {
        for (const item of this.state.cases) {
          if (this.stopped) {
            item.state = '건너뜀'
            item.reason = '중지됨'
            continue
          }
          await this.runCase(item)
        }
      } finally {
        await this.browser.closeWindow()
        this.browser.release()
        this.state.running = false
      }
    })()
    return { started: true, done }
  }

  private async runCase(item: CaseProgress): Promise<void> {
    item.state = '수행 중'
    const page = (await this.evidence.pages()).find((candidate) => candidate.tcs.some((tc) => tc.id === item.tc))
    const tc = page?.tcs.find((candidate) => candidate.id === item.tc)
    if (!page || !tc) return this.skip(item, '페이지 문서에 없는 TC')
    const runnable = await this.evidence.runnable(tc)
    if (!runnable.ok) return this.skip(item, runnable.why)
    const script = await this.evidence.script(tc.script!)
    let resolved: { vars: Record<string, string>; shown: string[] }
    try {
      resolved = resolveData(script.data, await this.evidence.testdata())
    } catch (error) {
      return this.skip(item, error instanceof Error ? error.message : String(error))
    }
    const runId = await this.nextRunId()
    item.run = runId
    const started = stamp()
    const log: string[] = []
    const say = (line: string) => {
      const clean = scrub(line, [this.config.login.password])
      log.push(clean)
      this.state.log.push(clean)
      ;(item.lines ??= []).push(clean)
    }
    const vars = { ...resolved.vars, run_id: runId }
    const map = await this.evidence.map()
    const firstFrom = script.edges.length ? map?.edges.find((edge) => edge['edge_id'] === script.edges[0])?.['출발'] : undefined
    const entryPage = firstFrom ?? map?.entries[0]?.['page_id'] ?? page.id
    const entryHow = map?.entries.find((entry) => entry['page_id'] === entryPage)?.['진입 방법'] ?? ''
    const routeText = [entryPage, ...script.edges.map((edge) => map?.edges.find((row) => row['edge_id'] === edge)?.['도착'] ?? edge.split('__')[1] ?? edge)].filter((value, index, all) => all.indexOf(value) === index).join(' → ')

    say('[skill] 패널 수행 로드 — UI-AUTO 패널 [▶ 수행] 으로 지정됨')
    say(`[증적 조회] ${EVIDENCE_DIR}/system_map.md — ${page.id} 있음, 진입점 ${entryPage}`)
    say(`[증적 조회] ${EVIDENCE_DIR}/${page.doc} — ${tc.id} 상태 ${tc.status}, 스크립트 상태 ${tc.scriptState}`)
    say(`[경로] ${routeText} — 근거 edge: ${script.edges.join(', ') || '없음'} | 탐색 필요 구간: 없음`)
    say(`[활용 단계] 1단계 — 스크립트 있음 (${tc.scriptState})`)
    say(`[증적 활용] ${tc.script}${script.edges.length ? `, ${script.edges.map((edge) => `scripts/routes/${edge}.yaml`).join(', ')}` : ''} → 경로 탐색 · 스냅샷 · 요소 찾기 생략`)
    if (resolved.shown.length) say(`[증적 조회] ${EVIDENCE_DIR}/testdata.md · 스크립트 data — ${resolved.shown.join(', ')}`)

    const outcome = await this.play({ item, page: page.id, tc, script, vars, entryHow, say, runId })
    say(`[스크립트] ${EVIDENCE_DIR}/${tc.script} — 실행 — ${outcome.verdict}${outcome.verdict === '성공' ? '' : ` (${outcome.reason})`}`)
    await this.browser.closeWindow()
    say('[tool] browser_close() — 브라우저 종료')
    item.state = outcome.verdict
    item.reason = outcome.reason

    await this.record({ runId, started, page, tc, script, outcome, resolved, vars, routeText, say, log })
  }

  private skip(item: CaseProgress, reason: string): void {
    item.state = '건너뜀'
    item.reason = reason
    this.state.log.push(`[건너뜀] ${item.tc} — ${reason}`)
    ;(item.lines ??= []).push(`[건너뜀] ${reason}`)
  }

  private async call(step: ScriptStep, vars: Record<string, string>, say: (line: string) => void): Promise<ToolResult> {
    const args = fill(step.args ?? {}, vars) as Record<string, unknown>
    if (step.tool === 'browser_navigate' && typeof args['url'] === 'string' && args['url'].startsWith('/')) args['url'] = this.config.baseUrl + args['url']
    let result: ToolResult
    try {
      result = await (this.browser as Caller).call(step.tool, args)
    } catch (error) {
      result = { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
    const text = textOf(result)
    const summary = result.isError ? `오류: ${firstLine(text)}` : pageUrlOf(text) ? `Page URL ${pageUrlOf(text)}` : firstLine(text.replace(/^###.*$/gm, '')).slice(0, 120) || '완료'
    say(`[tool] ${step.tool}(${keyArgs({ tool: step.tool, args })}) — ${summary}`)
    return result
  }

  /** 캡처 — marks 가 있으면 그 요소에 번호 상자를 그려 찍는다(그리기 · 지우기는 기록하지 않는다) */
  private async capture(file: string, say: (line: string) => void, marks: Mark[] = [], number?: number): Promise<{ ok: boolean; marked: number }> {
    const { result, marked } = await markedShot(this.browser as Caller, file, marks, number)
    say(`[tool] browser_take_screenshot(${file}) — ${result.isError ? `오류: ${firstLine(textOf(result))}` : '완료'}${marked ? ` · 동작 위치 ${marked}곳 표시` : ''}`)
    return { ok: !result.isError, marked }
  }

  private async play(input: { item: CaseProgress; page: string; tc: TcRow; script: Script; vars: Record<string, string>; entryHow: string; say: (line: string) => void; runId: string }): Promise<Outcome> {
    const { item, page, tc, script, vars, say, runId } = input
    const out: Outcome = { verdict: '성공', reason: '', arrived: false, steps: [], verifyNotes: [], mismatch: [], pageCaptured: false }
    const block = (reason: string): Outcome => ({ ...out, verdict: '차단', reason })
    const captureDir = `${EVIDENCE_DIR}/captures/${page}`
    let shot = 0
    /** 다음 캡처 — 단계 캡처는 그 단계를 하기 바로 전 화면(손댈 요소 표시), 마지막은 판정 화면 */
    const take = async (marks: Mark[] = [], number?: number) => {
      shot++
      const file = `${captureDir}/${runId}-${tc.id}-step${String(shot).padStart(2, '0')}.png`
      const { ok, marked } = await this.capture(file, say, marks, number)
      return { ...(ok && { capture: file }), marked: marked > 0 }
    }
    item.total = script.steps.length
    item.step = 0

    // 로그인 — 세션이 비었으면 먼저
    if (loginReady(this.config.login) && !(await hasCookies(this.config.stateFile))) {
      say(`[로그인] 저장된 세션 없음 — ${await this.doLogin(this.config)}`)
    }
    const entry = entryUrl(input.entryHow, this.config.baseUrl)
    let opened = await this.call({ tool: 'browser_navigate', args: { url: entry } }, vars, say)
    if (!opened.isError && loginReady(this.config.login) && onLoginPage(this.config, pageUrlOf(textOf(opened)) ?? '')) {
      say(`[로그인] 세션 만료 — ${await this.doLogin(this.config).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))}`)
      await this.browser.closeWindow()
      opened = await this.call({ tool: 'browser_navigate', args: { url: entry } }, vars, say)
      if (onLoginPage(this.config, pageUrlOf(textOf(opened)) ?? '')) return block('로그인 화면에서 넘어가지 못함 — 설정의 계정 · 로그인 칸 이름을 확인')
    }
    if (opened.isError) return block(`진입점을 열지 못함: ${firstLine(textOf(opened))}`)

    for (const edge of script.edges) {
      if (this.stopped) return block('패널에서 중지')
      let route: Route
      try {
        route = await this.evidence.route(edge)
      } catch (error) {
        return block(error instanceof Error ? error.message : String(error))
      }
      for (const step of route.steps) {
        const result = await this.call(step, vars, say)
        if (result.isError) {
          const line = `이동 스크립트 ${edge} 의 "${describe(step)}" ≠ 실제: ${firstLine(textOf(result))} — 이동 스크립트 그대로 둠, AI 확인 필요`
          say(`[불일치] ${line}`)
          out.mismatch.push(line)
          return block(`이동 실패 (${edge})`)
        }
      }
      for (const check of route.arrive) {
        const verdict = judge(check, await this.call(check, vars, say), vars)
        if (!verdict.pass) {
          const line = `이동 스크립트 ${edge} 도착 확인 "${check.pass ?? check.tool}" ≠ 실제: ${verdict.note} — AI 확인 필요`
          say(`[불일치] ${line}`)
          out.mismatch.push(line)
          return block(`도착 확인 실패 (${edge})`)
        }
      }
    }
    out.arrived = true

    if (!this.evidence.exists(`captures/${page}/page.png`)) out.pageCaptured = (await this.capture(`${captureDir}/page.png`, say)).ok

    for (const [index, step] of script.steps.entries()) {
      if (this.stopped) {
        const { capture } = await take()
        out.steps.push({ label: '중지한 화면', ...(capture && { capture }), description: '패널에서 중지한 시점의 화면입니다.', action: '패널에서 중지', expected: '-', actual: '중지한 시점의 화면', verdict: '멈춤' })
        return block('패널에서 중지')
      }
      item.step = index + 1
      const label = fill(describe(step), vars)
      const expected = step.expected ? fill(step.expected, vars) : '오류 없이 수행'
      const { capture, marked } = await take(fill(marksOf(step), vars), index + 1)
      const description = explain(step, vars, index + 1, marked)
      const result = await this.call(step, vars, say)
      if (result.isError) {
        out.steps.push({ label: `${index + 1}. ${label}`, ...(capture && { capture }), description, action: label, expected, actual: `오류: ${firstLine(textOf(result))}`, verdict: '멈춤' })
        const after = await take()
        out.steps.push({ label: '멈춘 뒤 화면', ...(after.capture && { capture: after.capture }), description: `${index + 1}단계에서 오류가 난 뒤의 화면입니다.`, action: '-', expected: '-', actual: `오류: ${firstLine(textOf(result))}`, verdict: '-' })
        const line = `스크립트 ${index + 1}단계 "${label}" ≠ 실제: ${firstLine(textOf(result))} — 스크립트 그대로 둠, 원인(화면 변경 · 실제 결함) 판단은 AI 에게 맡기기`
        say(`[불일치] ${line}`)
        out.mismatch.push(line)
        return block(`${index + 1}단계 수행 오류 (스크립트 불일치)`)
      }
      out.steps.push({ label: `${index + 1}. ${label}`, ...(capture && { capture }), description, action: label, expected, actual: screenOf(textOf(result)), verdict: '수행됨' })
    }

    const failed: string[] = []
    const checks: { action: string; expected: string; actual: string; pass: boolean }[] = []
    for (const check of script.verify) {
      const verdict = judge(check, await this.call(check, vars, say), vars)
      const want = fill(check.pass ?? check.tool, vars)
      out.verifyNotes.push(`${want} → ${verdict.pass ? '통과' : '불통과'} (${verdict.note})`)
      checks.push({ action: `${check.tool}(${keyArgs({ tool: check.tool, args: fill(check.args ?? {}, vars) })})`, expected: want, actual: verdict.note, pass: verdict.pass })
      if (!verdict.pass) failed.push(`${want}: ${verdict.note}`)
    }
    const { capture } = await take()
    out.steps.push({
      label: failed.length ? '판정 화면 (기대와 다름)' : '판정 화면',
      ...(capture && { capture }),
      description: `모든 단계를 마친 뒤의 화면입니다.${checks.length ? ` 확인: ${checks.map((check) => check.expected).join(' / ')}` : ''}`,
      action: `판정 — ${checks.map((check) => check.action).join(', ') || '판정 항목 없음'}`,
      expected: checks.map((check) => check.expected).join(' / ') || '-',
      actual: checks.map((check) => check.actual).join(' / ') || '-',
      verdict: failed.length ? '다름' : '일치',
    })
    if (failed.length) return { ...out, verdict: '실패', reason: failed.join('; ') }
    return { ...out, reason: out.verifyNotes.join('; ') }
  }

  private async record(input: { runId: string; started: ReturnType<typeof stamp>; page: { id: string; title: string; doc: string }; tc: TcRow; script: Script; outcome: Outcome; resolved: { shown: string[] }; vars: Record<string, string>; routeText: string; say: (line: string) => void; log: string[] }): Promise<void> {
    const { runId, started, page, tc, script, outcome, resolved, routeText, say } = input
    const write = (relative: string, text: string) => writeAtomic(this.config, this.evidence.file(relative), text)
    const notes: string[] = []
    const made: string[] = []
    const changed: string[] = []
    const pageDoc = (await this.evidence.read(page.doc)) ?? ''
    const detail = section(pageDoc, 'TC 상세') ?? ''
    const expected = new RegExp(`### ${tc.id}[\\s\\S]*?- 기대 결과:\\s*(.*)`).exec(detail)?.[1]?.trim() || script.verify.map((item) => item.pass ?? item.tool).join('; ')
    const scriptState = outcome.verdict === '성공' ? '검증됨' : tc.scriptState
    const captures = outcome.steps.filter((step) => step.capture)
    const capturePattern = `${EVIDENCE_DIR}/captures/${page.id}/${runId}-${tc.id}-step*.png (${captures.length}장)`
    const actual = outcome.verdict === '차단' ? `차단 — ${outcome.reason}` : outcome.verifyNotes.join('; ')

    const verdictLine = `[판정] ${tc.id} — ${outcome.verdict} — ${outcome.reason || '판정 확인'}`
    const entry = [
      `### ${runId} ${tc.id} (${outcome.verdict})`,
      '- 수행 방식: 스크립트',
      `- 입력 데이터: ${resolved.shown.join(', ') || '없음'}`,
      `- 기대 결과: ${expected}`,
      `- 실제 결과: ${actual}`,
      `- 캡처: ${outcome.arrived ? capturePattern : '없음'}`,
      `- 연관 페이지: ${routeText.split(' → ').filter((id) => id !== page.id).join(', ') || '없음'}`,
      `- 로그: ${EVIDENCE_DIR}/logs/${runId}.md`,
      `- 보고서: ${EVIDENCE_DIR}/reports/${runId}.md`,
      '- 수행: UI-AUTO 패널 (LLM 없이 스크립트 재생)',
      ...(outcome.mismatch.length ? [`- 불일치: ${outcome.mismatch.join(' / ')}`] : []),
    ].join('\n')

    // 페이지 문서 — TC 줄 · 수행 이력
    const applied = applyRun(pageDoc, { tc: tc.id, status: outcome.verdict, date: started.date, scriptState, entry, arrived: outcome.arrived })
    let statuses = statusesOf(pageDoc)
    if (applied) {
      await write(page.doc, applied.text)
      changed.push(`${page.doc}(${tc.id} ${outcome.verdict}, 수행 이력 1건)`)
      say(`[증적 갱신] ${EVIDENCE_DIR}/${page.doc} — ${tc.id} 상태 ${outcome.verdict} · 최근 수행일 ${started.date}${scriptState !== tc.scriptState ? ` · 스크립트 상태 ${scriptState}` : ''}, 수행 이력 1건 추가`)
      statuses = statusesOf(applied.text)
      if (applied.moved) {
        const history = `pages/history/${page.id}.md`
        await write(history, appendHistory(await this.evidence.read(history), page.id, applied.moved))
        say(`[증적 갱신] ${EVIDENCE_DIR}/${history} — 옛 수행 이력 옮김`)
      }
    } else {
      notes.push(`페이지 문서의 테스트 케이스 표에서 ${tc.id} 줄을 찾지 못해 페이지 문서는 갱신하지 않았습니다.`)
    }

    if (outcome.verdict === '성공') {
      const text = await this.evidence.read(tc.script!)
      if (text !== undefined) {
        const next = touchScript(text, started.date)
        if (next !== text) {
          await write(tc.script!, next)
          say(`[증적 갱신] ${EVIDENCE_DIR}/${tc.script} — 최근 통과일 ${started.date}`)
          changed.push(`${tc.script}(최근 통과일)`)
        }
      }
    }

    const mapText = await this.evidence.read('system_map.md')
    if (mapText !== undefined) {
      const next = touchMap(mapText, { page: page.id, edges: script.edges, date: started.date, statuses, arrived: outcome.arrived })
      if (next !== mapText) {
        await write('system_map.md', next)
        say(`[증적 갱신] ${EVIDENCE_DIR}/system_map.md — ${outcome.arrived ? '최근 확인일 · ' : ''}페이지 설명 TC 건수`)
        changed.push('system_map.md')
      }
    }
    if (outcome.pageCaptured) made.push(`captures/${page.id}/page.png`)
    if (captures.length) made.push(`captures/${page.id}/${runId}-${tc.id}-step01~${String(captures.length).padStart(2, '0')}.png`)

    // 보고서
    const reportFile = `reports/${runId}.md`
    const toReport = (file: string) => `../${path.posix.relative(EVIDENCE_DIR, file)}`
    const report = [
      `# 테스트 수행 보고서 ${runId}`,
      '',
      '| 항목 | 내용 |',
      '|---|---|',
      `| 일시 | ${started.minute} |`,
      `| 요청 | UI-AUTO 패널에서 ${tc.id} 수행 |`,
      `| 대상 페이지 | ${page.title} (${page.id}) |`,
      `| 테스트 케이스 | ${tc.id} ${cellSafe(tc.content)} |`,
      `| 판정 | ${outcome.verdict} |`,
      '| 수행 방식 | 스크립트 |',
      '',
      '## 경로',
      `${routeText} (edge: ${script.edges.join(', ') || '없음'})`,
      '',
      '## 수행 절차',
      ...script.steps.map((step, index) => `${index + 1}. ${fill(describe(step), input.vars)}`),
      '',
      '## 입력 데이터',
      ...(resolved.shown.length ? resolved.shown.map((line) => `- ${line}`) : ['없음']),
      '',
      '## 기대 결과',
      expected,
      '',
      '## 실제 결과',
      actual || '미확인',
      '',
      '## 판정 근거',
      outcome.verdict === '성공' ? `verify 전부 통과: ${outcome.verifyNotes.join('; ')}` : outcome.verdict === '실패' ? `기대와 다름: ${outcome.reason}` : `차단: ${outcome.reason}. 마지막 캡처가 멈춘 화면입니다.`,
      '',
      '## 캡처',
      '### 대상 페이지 (수행 전)',
      this.evidence.exists(`captures/${page.id}/page.png`) ? `![${page.title}](../captures/${page.id}/page.png)` : '캡처 없음 (아직 테스트 대상이 된 적 없음)',
      '',
      ...outcome.steps.flatMap((step) => [`### ${step.label}`, `- 설명: ${step.description}`, step.capture ? `![${path.posix.basename(step.capture, '.png').split('-').at(-1)}](${toReport(step.capture)})` : '캡처 없음', `- 한 일: ${step.action}`, `- 기대: ${step.expected}`, `- 실제: ${step.actual}`, `- 판정: ${step.verdict}`, '']),
      '## 불일치·확인 사항',
      ...(outcome.mismatch.length || notes.length ? [...outcome.mismatch.map((line) => `- 불일치: ${line}`), ...notes.map((line) => `- ${line}`)] : ['없음']),
      '',
      '## 관련 증적',
      `- 페이지 문서: ${EVIDENCE_DIR}/${page.doc}`,
      `- 스크립트: ${EVIDENCE_DIR}/${tc.script} (${scriptState})`,
      ...script.edges.map((edge) => `- 이동 스크립트: ${EVIDENCE_DIR}/scripts/routes/${edge}.yaml`),
      `- 로그: ${EVIDENCE_DIR}/logs/${runId}.md`,
      '',
    ].join('\n')
    await write(reportFile, report)
    made.push(reportFile)
    say(`[증적 갱신] ${EVIDENCE_DIR}/${reportFile} — 보고서 작성`)
    if (outcome.verdict === '성공') {
      try {
        const guide = await writeGuide(this.config, this.evidence, tc.id)
        made.push(`guides/${guide.id}.md`)
        say(`[증적 갱신] ${guide.path} — 테스트 가이드 작성`)
      } catch (error) {
        say(`[증적 갱신] 테스트 가이드 — 만들지 못함: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    say(verdictLine)

    // 수행 로그 — 같은 줄을 그대로
    made.push(`logs/${runId}.md`)
    const skipped = `경로 탐색 · 화면 스냅샷 · 요소 찾기 (스크립트 ${tc.script}${script.edges.length ? ` + 이동 스크립트 ${script.edges.length}개` : ''} 재생)`
    const logText = [
      `# ${runId}`,
      '',
      `- 일시: ${started.minute}`,
      `- 요청: UI-AUTO 패널에서 ${tc.id} 수행`,
      '- skill: 패널 수행 (UI-AUTO)',
      `- 대상: ${page.id} / ${tc.id}`,
      `- 결과: ${outcome.verdict}`,
      '',
      '## 로그',
      ...input.log,
      '',
      '## 요약',
      '| 참고한 증적 | 새로 만든 증적 | 갱신한 증적 | 증적 덕분에 생략한 작업 |',
      '|---|---|---|---|',
      `| ${cellSafe(['system_map.md', page.doc, tc.script!, ...script.edges.map((edge) => `scripts/routes/${edge}.yaml`)].join(', '))} | ${cellSafe(made.join(', ') || '없음')} | ${cellSafe(changed.join(', ') || '없음')} | ${cellSafe(skipped)} |`,
      '',
    ].join('\n')
    await write(`logs/${runId}.md`, scrub(logText, [this.config.login.password]))
  }
}

const cellSafe = (value: string) => value.replace(/\r?\n/g, ' ').replaceAll('|', '\\|')

async function hasCookies(file: string): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(file, 'utf8')) as { cookies?: unknown[] }
    return Array.isArray(state.cookies) && state.cookies.length > 0
  } catch {
    return false
  }
}

