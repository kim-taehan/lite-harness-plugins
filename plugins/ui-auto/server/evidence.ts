// 증적 읽기 — `.litecode/ui-auto/` 의 md · yaml 을 패널이 쓰는 모양으로. 원본은 파일이고 DB 는 없다(매번 읽는다).
// shortcut: 화면 수백 개까지는 매번 읽어도 빠르다 — 느려지면 host.db 색인을 더한다.
// 형식이 깨진 파일은 빼지 않고 problem 으로 알린다.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { FRESH_DAYS, parseTestdata } from './config.ts'
import { blocks, fields, frontmatter, section, table } from './markdown.ts'

export const TC_STATUSES = ['미수행', '성공', '실패', '차단', '폐기'] as const
export type TcStatus = (typeof TC_STATUSES)[number]
export const SCRIPT_STATES = ['없음', '검증됨', '미검증', '깨짐'] as const
export type ScriptState = (typeof SCRIPT_STATES)[number]

export interface TcRow {
  id: string
  page: string
  content: string
  status: TcStatus | string
  lastRunAt?: string
  /** 증적 폴더 기준 경로 */
  script?: string
  scriptState: ScriptState | string
  /** 수행 이력(페이지 문서 + pages/history) 에 남은 이 TC 의 수행 횟수 */
  runCount: number
  /** 문어체 핵심 제목 — TC 상세의 `- 제목:`, 없으면 내용에서 줄인 것 */
  title: string
  /** 지난 수행과 비교한 흐름 — 새로 실패 · 계속 실패 · 고쳐짐 */
  trend?: Trend
}

/** 최근 판정이 지난 판정과 어떻게 다른가. still 의 count 는 연달아 실패 · 차단한 횟수 */
export interface Trend {
  kind: 'new' | 'still' | 'fixed'
  count?: number
}

export interface PageSummary {
  id: string
  title: string
  urlPattern: string
  lastVerified: string
  stale: boolean
  /** 증적 폴더 기준 */
  doc: string
  hasCapture: boolean
  /** 진입점인가 (system_map 「진입점」) */
  entry: boolean
  runCount: number
  problem?: string
  counts: Record<string, number>
  tcs: TcRow[]
}

export interface RunEntry {
  run: string
  tc: string
  verdict: string
  fields: Record<string, string>
  /** 보고서 id (= run id) — 보고서 파일이 있을 때 */
  report?: string
}

export interface StepView {
  kind: 'route' | 'step' | 'verify'
  tool: string
  label: string
  target?: string
  expected?: string
}

export interface TcDetail extends TcRow {
  pageTitle: string
  /** 스크립트 단계 — 없으면 TC 상세의 절차만 */
  steps: StepView[]
  detail: Record<string, string>
  notes: { date: string; question: string; answer: string; target: string }[]
  runs: RunEntry[]
}

export interface FlowNode {
  id: string
  title: string
  urlPattern: string
  entry: boolean
  capture?: string
  worst: string
  counts: Record<string, number>
  tcCount: number
  runCount: number
  lastVerified: string
}
export interface FlowEdge {
  id: string
  from: string
  to: string
  action: string
  target: string
  state: string
  lastVerified: string
  script?: string
}
export interface ReportView {
  id: string
  title: string
  head: Record<string, string>
  route: string
  procedure: string
  input: string
  expected: string
  actual: string
  basis: string
  notes: string
  related: string
  steps: ReportStep[]
}
export interface ReportStep {
  title: string
  capture?: string
  action: string
  expected: string
  actual: string
  verdict: string
}

/** 실패 · 차단한 수행의 원인 단계 — 멈춘 단계(멈춤) 또는 판정이 다른 단계(다름) */
export interface FailStep {
  /** report.steps 안의 자리 */
  index: number
  /** 스크립트 단계 번호(1부터) — 판정 화면 · 중지 화면이면 없음 */
  step?: number
  title: string
  expected: string
  actual: string
  capture?: string
}

export interface ReportSummary {
  id: string
  at: string
  page: string
  tc: string
  verdict: string
  mode: string
  /** 실패 · 차단의 한 줄 원인 */
  reason?: string
  /** 같은 TC 의 바로 전 보고서와 비교 */
  trend?: Trend
}

/** 테스트 가이드 md → 패널이 그리는 모양. 절마다 글 · 그림 · 단계(따라 하기) */
export interface GuideView {
  id: string
  title: string
  tcs: string[]
  head: Record<string, string>
  sections: { title: string; items: GuideItem[] }[]
}
export type GuideItem = { kind: 'text'; text: string } | { kind: 'image'; capture: string; alt: string } | { kind: 'step'; title: string; lines: string[]; capture?: string }

export interface GuideSummary {
  id: string
  title: string
  created: string
  pages: string[]
  tcs: string[]
}

export interface ScriptStep {
  tool: string
  args: Record<string, unknown>
  /** 이 단계 뒤에 보여야 할 화면 — 보고서의 「기대」 */
  expected?: string
}
export interface VerifyItem extends ScriptStep {
  pass?: string
  expect?: { ok?: boolean; found?: string | number; equals?: string }
}
export interface Script {
  tc_id: string
  page_id: string
  edges: string[]
  data: Record<string, unknown>
  steps: ScriptStep[]
  verify: VerifyItem[]
  changes_data?: boolean
}
export interface Route {
  edge_id: string
  steps: ScriptStep[]
  arrive: VerifyItem[]
}

/** 기록에 적힌 경로 → 증적 폴더 기준 (`evidence/…` · `.litecode/ui-auto/…` 앞을 뗀다) */
export function evidencePath(value: string): string {
  return value.trim().replace(/^`|`$/g, '').replace(/^(?:\.\/)?(?:\.litecode\/ui-auto\/|evidence\/)/, '')
}

const daysSince = (date: string, now: Date): number => {
  const time = Date.parse(`${date}T00:00:00`)
  return Number.isNaN(time) ? Infinity : (now.getTime() - time) / 86_400_000
}

/** 판정 줄을 읽을 수 있나 — 패널 수행(LLM 없이)은 이것만 판정한다 */
export function judgeable(item: VerifyItem): boolean {
  if (item.expect) return item.expect.ok === true || item.expect.found !== undefined || item.expect.equals !== undefined
  return item.tool === 'browser_wait_for' || item.tool === 'browser_find'
}

export class Evidence {
  constructor(
    readonly root: string,
    private readonly now: () => Date = () => new Date(),
    /** 설정 칸의 기본 테스트 입력값 — testdata.md 가 이긴다 */
    private readonly fallbackData: Record<string, string> = {},
  ) {}

  file(relative: string): string {
    const full = path.resolve(this.root, relative)
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`증적 폴더 밖입니다: ${relative}`)
    return full
  }

  async read(relative: string): Promise<string | undefined> {
    return readFile(this.file(relative), 'utf8').catch(() => undefined)
  }

  exists(relative: string): boolean {
    return existsSync(this.file(relative))
  }

  async map(): Promise<{ text: string; entries: Record<string, string>[]; pages: Record<string, string>[]; edges: Record<string, string>[] } | undefined> {
    const text = await this.read('system_map.md')
    if (text === undefined) return undefined
    return { text, entries: table(text, '진입점'), pages: table(text, '페이지 목록'), edges: table(text, '이동 관계') }
  }

  private entryIds = new Set<string>()

  async pages(): Promise<PageSummary[]> {
    const map = await this.map()
    this.entryIds = new Set((map?.entries ?? []).map((row) => row['page_id'] ?? ''))
    const docs = new Set((await readdir(this.file('pages')).catch(() => [] as string[])).filter((name) => name.endsWith('.md') && name !== '_template.md').map((name) => name.slice(0, -3)))
    const rows = map?.pages ?? []
    const out: PageSummary[] = []
    for (const row of rows) {
      const id = row['page_id'] ?? ''
      docs.delete(id)
      out.push(await this.pageSummary(id, row))
    }
    for (const id of docs) out.push({ ...(await this.pageSummary(id, {})), problem: 'system_map 의 페이지 목록에 없음' })
    return out
  }

  private async pageSummary(id: string, row: Record<string, string>): Promise<PageSummary> {
    const doc = `pages/${id}.md`
    const text = await this.read(doc)
    const meta = text ? frontmatter(text).meta : {}
    const older = (await this.read(`pages/history/${id}.md`)) ?? ''
    const runs = text ? [...history(text), ...history(older)] : []
    const tcs = text
      ? tcRows(text, id).map((tc) => {
          const mine = runs.filter((run) => run.tc === tc.id).sort((a, b) => b.run.localeCompare(a.run))
          const trend = trendOf(mine.map((run) => run.verdict))
          return { ...tc, runCount: mine.length, ...(trend && { trend }) }
        })
      : []
    const counts: Record<string, number> = {}
    for (const tc of tcs) counts[tc.status] = (counts[tc.status] ?? 0) + 1
    const lastVerified = row['최근 확인일'] || String(meta['last_verified'] ?? '')
    const problem = text === undefined ? '페이지 문서 없음' : section(text, '테스트 케이스') === undefined ? '페이지 문서에 「테스트 케이스」 절이 없음' : undefined
    return {
      id,
      title: row['화면명'] || String(meta['title'] ?? '') || id,
      urlPattern: row['URL 패턴'] || String(meta['url_pattern'] ?? ''),
      lastVerified,
      stale: daysSince(lastVerified, this.now()) > FRESH_DAYS,
      doc,
      hasCapture: this.exists(`captures/${id}/page.png`),
      entry: this.entryIds.has(id),
      runCount: runs.length,
      ...(problem && { problem }),
      counts,
      tcs,
    }
  }

  async tc(tcId: string): Promise<TcDetail | undefined> {
    for (const page of await this.pages()) {
      const row = page.tcs.find((tc) => tc.id === tcId)
      if (!row) continue
      const text = (await this.read(page.doc)) ?? ''
      const detailBlock = blocks(section(text, 'TC 상세') ?? '').find((block) => block.heading.split(/\s/)[0] === tcId)
      const notes = table(text, '확인 사항')
        .filter((note) => {
          const target = note['적용 대상'] ?? ''
          return target.includes(tcId) || target === '페이지 전체' || target === page.id
        })
        .map((note) => ({ date: note['날짜'] ?? '', question: note['질문'] ?? '', answer: note['사용자 답변'] ?? '', target: note['적용 대상'] ?? '' }))
      const older = (await this.read(`pages/history/${page.id}.md`)) ?? ''
      const runs = [...history(text), ...history(older)].filter((run) => run.tc === tcId)
      for (const run of runs) {
        const report = run.fields['보고서'] ? path.basename(evidencePath(run.fields['보고서']), '.md') : run.run
        if (this.exists(`reports/${report}.md`)) run.report = report
      }
      return { ...row, pageTitle: page.title, steps: await this.steps(row), detail: detailBlock ? fields(detailBlock.lines) : {}, notes, runs }
    }
    return undefined
  }

  /** TC 스크립트를 사람 말 단계로 — 이동 스크립트 · 단계 · 판정 */
  async steps(tc: TcRow): Promise<StepView[]> {
    if (!tc.script) return []
    let script: Script
    try {
      script = await this.script(tc.script)
    } catch {
      return []
    }
    // 보이는 글에는 testdata.md 값을 넣는다(`$이름` → 값). 없는 이름은 그대로
    const testdata = await this.testdata()
    const data = Object.fromEntries(Object.entries(script.data).map(([key, value]) => {
      const ref = typeof value === 'string' ? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim()) : null
      return [key, ref && testdata[ref[1]!] !== undefined ? testdata[ref[1]!] : value]
    }))
    script = { ...script, data }
    const target = (step: ScriptStep) => (typeof step.args?.['target'] === 'string' ? step.args['target'] : typeof step.args?.['url'] === 'string' ? step.args['url'] : typeof step.args?.['text'] === 'string' ? step.args['text'] : undefined)
    const out: StepView[] = script.edges.map((edge) => ({ kind: 'route', tool: 'route', label: `${edge.split('__')[1] ?? edge} 로 이동`, target: `scripts/routes/${edge}.yaml` }))
    for (const step of script.steps) out.push({ kind: 'step', tool: step.tool, label: describeStep(step, script.data), ...(target(step) && { target: target(step) }), ...(step.expected && { expected: fillText(step.expected, script.data) }) })
    for (const item of script.verify) out.push({ kind: 'verify', tool: item.tool, label: `판정: ${fillText(item.pass ?? item.tool, script.data)}`, ...(target(item) && { target: `${item.tool} · ${expectText(item)}` }) })
    return out
  }

  /** system_map 의 페이지 · 이동 — 흐름 지도 */
  async flow(pages: PageSummary[]): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
    const map = await this.map()
    const worst = (counts: Record<string, number>) => (counts['실패'] ? '실패' : counts['차단'] ? '차단' : counts['성공'] ? '성공' : counts['미수행'] ? '미수행' : '')
    const nodes = pages.map((page) => ({ id: page.id, title: page.title, urlPattern: page.urlPattern, entry: page.entry, capture: page.hasCapture ? `captures/${page.id}/page.png` : undefined, worst: worst(page.counts), counts: page.counts, tcCount: page.tcs.length, runCount: page.runCount, lastVerified: page.lastVerified }))
    const edges = (map?.edges ?? [])
      .filter((row) => row['상태'] !== '폐기')
      .map((row) => ({ id: row['edge_id'] ?? '', from: row['출발'] ?? '', to: row['도착'] ?? '', action: row['동작'] ?? '', target: row['대상 요소(역할·이름)'] ?? '', state: row['상태'] ?? '', lastVerified: row['최근 확인일'] ?? '', script: row['이동 스크립트'] && row['이동 스크립트'] !== '없음' ? row['이동 스크립트'] : undefined }))
    return { nodes, edges }
  }

  /** 보고서 md → 패널이 그리는 모양. 캡처마다 한 일 · 기대 · 실제 · 판정(옛 보고서는 제목만) */
  async report(id: string): Promise<ReportView | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(id)) return undefined
    const text = await this.read(`reports/${id}.md`)
    if (text === undefined) return undefined
    const head = Object.fromEntries(headTable(text).map((row) => [row['항목'] ?? '', row['내용'] ?? '']))
    const part = (title: string) => section(text, title) ?? ''
    const steps = blocks(part('캡처')).map((block) => {
      const image = block.lines.map((line) => /!\[[^\]]*\]\(([^)]+)\)/.exec(line)?.[1]).find(Boolean)
      const info = fields(block.lines)
      const capture = image && !/^[a-z]+:/i.test(image) ? path.posix.normalize(path.posix.join('reports', image)) : undefined
      return { title: block.heading, ...(capture && !capture.startsWith('..') && { capture }), action: info['한 일'] ?? '', expected: info['기대'] ?? '', actual: info['실제'] ?? '', verdict: info['판정'] ?? '' }
    })
    return { id, head, title: /^#\s+(.*)$/m.exec(text)?.[1] ?? id, route: part('경로'), procedure: part('수행 절차'), input: part('입력 데이터'), expected: part('기대 결과'), actual: part('실제 결과'), basis: part('판정 근거'), notes: part('불일치·확인 사항'), related: part('관련 증적'), steps }
  }

  async reports(): Promise<ReportSummary[]> {
    const names = (await readdir(this.file('reports')).catch(() => [] as string[])).filter((name) => name.endsWith('.md'))
    const out: ReportSummary[] = []
    for (const name of names) {
      const view = await this.report(name.slice(0, -3))
      if (!view) continue
      const head = view.head
      const tc = /([a-z0-9-]+-TC-\d+)/.exec(head['테스트 케이스'] ?? '')?.[1] ?? ''
      const page = /\(([^)]+)\)\s*$/.exec(head['대상 페이지'] ?? '')?.[1] ?? ''
      const reason = failReason(view)
      out.push({ id: view.id, at: head['일시'] ?? '', page, tc, verdict: head['판정'] ?? '', mode: head['수행 방식'] ?? '', ...(reason && { reason }) })
    }
    out.sort((a, b) => b.id.localeCompare(a.id))
    for (const [index, item] of out.entries()) {
      const trend = trendOf(out.slice(index).filter((other) => other.tc === item.tc).map((other) => other.verdict))
      if (trend) item.trend = trend
    }
    return out
  }

  /** 같은 TC 의 이 보고서보다 앞선 가장 새 「성공」 보고서 — 캡처를 번갈아 보는 데 쓴다 */
  async previousPass(id: string): Promise<ReportView | undefined> {
    const all = await this.reports()
    const tc = all.find((item) => item.id === id)?.tc
    const before = tc ? all.find((item) => item.tc === tc && item.id < id && item.verdict === '성공') : undefined
    return before ? this.report(before.id) : undefined
  }

  /** 테스트 가이드 md — 맨 위 표(개요) · `## ` 절마다 글 · 그림, 「따라 하기」 의 `### ` 단계 */
  async guide(id: string): Promise<GuideView | undefined> {
    if (!/^guide-[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(id)) return undefined
    const text = await this.read(`guides/${id}.md`)
    if (text === undefined) return undefined
    const { meta, body } = frontmatter(text)
    const image = (line: string) => {
      const match = /!\[([^\]]*)\]\(([^)]+)\)/.exec(line)
      if (!match || /^[a-z]+:/i.test(match[2]!)) return undefined
      const capture = path.posix.normalize(path.posix.join('guides', match[2]!))
      return capture.startsWith('captures/') ? { capture, alt: match[1]! } : undefined
    }
    const head = Object.fromEntries(headTable(body).map((row) => [row['항목'] ?? '', row['내용'] ?? '']))
    const sections = body.split(/\n(?=## )/).slice(1).map((chunk) => {
      const [first, ...rest] = chunk.split('\n')
      const items: GuideItem[] = []
      let step: Extract<GuideItem, { kind: 'step' }> | undefined
      for (const raw of rest) {
        const line = raw.trim()
        if (!line) continue
        if (line.startsWith('### ')) {
          step = { kind: 'step', title: line.slice(4), lines: [] }
          items.push(step)
          continue
        }
        const picture = image(line)
        if (step) {
          if (picture) step.capture = picture.capture
          else step.lines.push(line.replace(/^-\s*/, ''))
        } else items.push(picture ? { kind: 'image', ...picture } : { kind: 'text', text: line })
      }
      return { title: first!.replace(/^##\s*/, ''), items }
    })
    return { id, title: String(meta['title'] ?? '') || /^#\s+(.*)$/m.exec(body)?.[1] || id, tcs: Array.isArray(meta['tcs']) ? meta['tcs'] : [], head, sections }
  }

  async guides(): Promise<GuideSummary[]> {
    const names = (await readdir(this.file('guides')).catch(() => [] as string[])).filter((name) => name.endsWith('.md'))
    const out: GuideSummary[] = []
    for (const name of names) {
      const { meta, body } = frontmatter((await this.read(`guides/${name}`)) ?? '')
      const title = String(meta['title'] ?? '') || /^#\s+(.*)$/m.exec(body)?.[1] || name.slice(0, -3)
      out.push({ id: name.slice(0, -3), title, created: String(meta['created'] ?? ''), pages: Array.isArray(meta['pages']) ? meta['pages'] : [], tcs: Array.isArray(meta['tcs']) ? meta['tcs'] : [] })
    }
    return out.sort((a, b) => b.id.localeCompare(a.id))
  }

  /** 테스트 입력값 — 설정 칸의 기본값 위에 testdata.md 의 `이름=값` 줄(계정 · 비밀 같은 이름은 뺀다) */
  async testdata(): Promise<Record<string, string>> {
    const text = (await this.read('testdata.md')) ?? ''
    return { ...this.fallbackData, ...parseTestdata(text.split('\n').filter((line) => !/^\s*[#>`-]/.test(line)).join('\n')) }
  }

  /** 값마다 어디서 왔나 — begin 이 보인다 */
  async testdataSources(): Promise<{ file: string[]; settings: string[] }> {
    const file = Object.keys(parseTestdata(((await this.read('testdata.md')) ?? '').split('\n').filter((line) => !/^\s*[#>`-]/.test(line)).join('\n')))
    return { file, settings: Object.keys(this.fallbackData).filter((name) => !file.includes(name)) }
  }

  async script(relative: string): Promise<Script> {
    const text = await this.read(relative)
    if (text === undefined) throw new Error(`스크립트 파일이 없습니다: ${relative}`)
    const value = lenientYaml(text) as Partial<Script> | null
    if (!value || !Array.isArray(value.steps) || !Array.isArray(value.verify)) throw new Error(`스크립트 형식이 틀렸습니다(steps · verify): ${relative}`)
    return { tc_id: String(value.tc_id ?? ''), page_id: String(value.page_id ?? ''), edges: Array.isArray(value.edges) ? value.edges.map(String) : [], data: value.data ?? {}, steps: value.steps, verify: value.verify, ...(typeof value.changes_data === 'boolean' && { changes_data: value.changes_data }) }
  }

  async route(edge: string): Promise<Route> {
    const relative = `scripts/routes/${edge}.yaml`
    const text = await this.read(relative)
    if (text === undefined) throw new Error(`이동 스크립트가 없습니다: ${relative}`)
    const value = lenientYaml(text) as Partial<Route> | null
    if (!value || !Array.isArray(value.steps)) throw new Error(`이동 스크립트 형식이 틀렸습니다: ${relative}`)
    return { edge_id: edge, steps: value.steps, arrive: Array.isArray(value.arrive) ? value.arrive : [] }
  }

  /** 패널에서 수행할 수 있나 — 안 되면 이유 */
  async runnable(tc: TcRow): Promise<{ ok: true; changesData?: boolean } | { ok: false; why: string }> {
    if (!tc.script || tc.scriptState === '없음') return { ok: false, why: '스크립트 없음' }
    if (tc.scriptState === '깨짐') return { ok: false, why: '스크립트 깨짐' }
    try {
      const script = await this.script(tc.script)
      const bad = script.verify.find((item) => !judgeable(item))
      if (bad) return { ok: false, why: `판정 방식을 모름(${bad.tool}) — expect 가 필요` }
      const missing = script.edges.find((edge) => !this.exists(`scripts/routes/${edge}.yaml`))
      if (missing) return { ok: false, why: `이동 스크립트 없음(${missing})` }
      return { ok: true, ...(script.changes_data !== undefined && { changesData: script.changes_data }) }
    } catch (error) {
      return { ok: false, why: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function tcRows(text: string, page: string): TcRow[] {
  const titles = new Map(blocks(section(text, 'TC 상세') ?? '').map((block) => [block.heading.split(/\s/)[0]!, fields(block.lines)['제목'] ?? '']))
  return table(text, '테스트 케이스')
    .filter((row) => row['tc_id'])
    .map((row) => {
      const script = row['스크립트'] && !['-', '없음'].includes(row['스크립트']) ? evidencePath(row['스크립트']) : undefined
      const lastRunAt = row['최근 수행일'] && row['최근 수행일'] !== '-' ? row['최근 수행일'] : undefined
      const content = row['내용'] ?? ''
      return { id: row['tc_id']!, page, content, title: titles.get(row['tc_id']!) || shortTitle(content), status: row['상태'] || '미수행', ...(lastRunAt && { lastRunAt }), ...(script && { script }), scriptState: row['스크립트 상태'] || '없음', runCount: 0 }
    })
}

/** 제목이 없을 때 — 내용의 「→」 앞(조건 · 동작)을 따옴표 · 꾸밈 없이 30자까지 */
export function shortTitle(content: string): string {
  const head = content.split('→')[0]!.replace(/["“”'‘’]/g, '').replace(/\s+/g, ' ').trim()
  return head.length > 30 ? `${head.slice(0, 29)}…` : head || content.slice(0, 30)
}

/** 「수행 이력」 항목 — `### <run_id> <tc_id> (<판정>)` */
export function history(text: string): RunEntry[] {
  const body = section(text, '수행 이력') ?? text
  return blocks(body)
    .map((block) => {
      const match = /^(\S+)\s+(\S+)\s*\(([^)]*)\)/.exec(block.heading)
      return match ? { run: match[1]!, tc: match[2]!, verdict: match[3]!, fields: fields(block.lines) } : undefined
    })
    .filter((entry): entry is RunEntry => entry !== undefined)
}

const BAD = new Set(['실패', '차단'])

/** 판정 목록(새것부터) → 흐름. 최근이 실패 · 차단이면 연달아 몇 번인지(1번이면 새로 실패), 최근이 성공이고 바로 전이 실패 · 차단이면 고쳐짐 */
export function trendOf(verdicts: string[]): Trend | undefined {
  const [last, before] = verdicts
  if (last === undefined) return undefined
  if (BAD.has(last)) {
    const count = verdicts.findIndex((verdict) => !BAD.has(verdict))
    const run = count < 0 ? verdicts.length : count
    return run > 1 ? { kind: 'still', count: run } : { kind: 'new' }
  }
  return last === '성공' && before !== undefined && BAD.has(before) ? { kind: 'fixed' } : undefined
}

/** 원인 단계 — 멈춤(스크립트 단계 오류 · 중지) 이 먼저, 없으면 다름(판정) */
export function failStep(view: ReportView): FailStep | undefined {
  const index = view.steps.findIndex((step) => step.verdict === '멈춤')
  const at = index >= 0 ? index : view.steps.findIndex((step) => step.verdict === '다름')
  if (at < 0) return undefined
  const found = view.steps[at]!
  const number = /^(\d+)\./.exec(found.title)?.[1]
  return { index: at, ...(number && { step: Number(number) }), title: found.action || found.title.replace(/^\d+\.\s*/, ''), expected: found.expected, actual: found.actual, ...(found.capture && { capture: found.capture }) }
}

/** 실패 · 차단의 한 줄 원인 — 성공이면 없음 */
export function failReason(view: ReportView): string | undefined {
  if (!BAD.has(view.head['판정'] ?? '')) return undefined
  const step = failStep(view)
  const cut = (value: string) => (value.length > 60 ? `${value.slice(0, 59)}…` : value)
  if (step?.step) return cut(`${step.step}단계 ${step.title}에서 멈춤`)
  if (step) return cut(`판정 다름 — ${step.actual}`)
  return view.basis ? cut(view.basis.split('\n')[0]!.replace(/^(차단|기대와 다름):\s*/, '')) : undefined
}

/** 보고서 맨 위 표 (절 제목 앞) */
function headTable(text: string): Record<string, string>[] {
  return table(`## 머리\n${text.split(/\n## /)[0]}`, '머리')
}

/** `{이름}` → data 값 (보이기용 — `$이름` 은 그대로) */
export function fillText(text: string, data: Record<string, unknown>): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name: string) => (name in data ? String(data[name]) : all))
}

/** 단계 하나를 사람 말로 — 보고서 「수행 절차」 · 캡처 제목 · 패널 단계 목록 */
export function describeStep(step: ScriptStep, data: Record<string, unknown> = {}): string {
  const args = step.args ?? {}
  const element = typeof args['element'] === 'string' ? args['element'] : typeof args['target'] === 'string' ? args['target'] : ''
  const text = (() => {
    switch (step.tool) {
      case 'browser_click': return `"${element}" 클릭`
      case 'browser_type': return `"${element}"에 "${String(args['text'] ?? '')}" 입력`
      case 'browser_select_option': return `"${element}"에서 ${JSON.stringify(args['values'] ?? [])} 선택`
      case 'browser_press_key': return `${String(args['key'] ?? '')} 키 누름`
      case 'browser_hover': return `"${element}" 위에 올림`
      case 'browser_navigate': return `${String(args['url'] ?? '')} 로 이동`
      case 'browser_fill_form': return `폼 채우기 (${(Array.isArray(args['fields']) ? args['fields'] : []).map((field: { name?: string }) => field?.name).filter(Boolean).join(', ')})`
      case 'browser_handle_dialog': return `대화상자 ${args['accept'] ? '수락' : '취소'}`
      default: return `${step.tool}${element ? ` (${element})` : ''}`
    }
  })()
  return fillText(text, data)
}

/** 판정 줄의 기대를 짧게 */
export function expectText(item: VerifyItem): string {
  const expect = item.expect ?? (item.tool === 'browser_find' ? { found: '>=1' } : { ok: true })
  if (expect.found !== undefined) return `found ${String(expect.found).replace('>=', '≥ ')}`
  if (expect.equals !== undefined) return `= ${expect.equals}`
  return '오류 없이 끝남'
}

/** AI 가 흔히 틀리는 YAML 을 한 번 고쳐 읽는다 — `expected: "등록" 대화상자 표시` 처럼 따옴표로 시작해 뒤에 글이 더 붙은 한 줄 값,
 *  `최근 통과일: -` 처럼 값이 `-` 하나뿐인 줄(목록 시작으로 읽힌다), 같은 키를 두 번 쓴 것(뒤의 값). 그런 값 줄만 작은따옴표로 감싸 다시 읽고, 그래도 안 되면 처음 오류를 그대로 던진다(파일은 고치지 않는다) */
export function lenientYaml(text: string): unknown {
  try {
    return parseYaml(text)
  } catch (error) {
    const fixed = text.split('\n').map((line) => {
      const dash = /^(\s*(?:-\s+)?[A-Za-z_가-힣][\w가-힣 ]*:)\s+-\s*$/.exec(line)
      if (dash) return `${dash[1]} '-'`
      const match = /^(\s*(?:-\s+)?[A-Za-z_가-힣][\w가-힣]*:\s+)(["'].*\S)\s*$/.exec(line)
      if (!match) return line
      const value = match[2]!
      const quote = value[0]!
      const closes = value.indexOf(quote, 1)
      if (closes < 0 || closes === value.length - 1) return line
      return `${match[1]}'${value.replaceAll("'", "''")}'`
    }).join('\n')
    try {
      return parseYaml(fixed, { uniqueKeys: false })
    } catch {
      throw error
    }
  }
}
