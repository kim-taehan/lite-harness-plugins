// 패널(index.html)의 순수 로직 — `// <pure>` 구간만 잘라 시험한다. 그리기는 build/ui-auto 를 브라우저로 열어 본다(README "앱에서 못 본 것")
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8')
const source = /\/\/ <pure>[^\n]*\n([\s\S]*?)\/\/ <\/pure>/.exec(html)?.[1]
if (!source) throw new Error('index.html 에서 <pure> 구간을 찾지 못했습니다')
type Counts = Record<string, number>
const api = new Function(`${source}\nreturn { badgeOf, scriptTagOf, donutArcs, passText, successRate, sumCounts, barParts, countsLine, filterPages, filterTcs, statusSegments, sortPages, trendText, attentionItems, deltaText, filterReports, timelineStates, pairStep, causeTitle, layoutFlow, confirmText, progressText, finishText, guideFor, logParts, splitPath, procedureSteps, runningStates }`)() as {
  badgeOf(value: string): string
  scriptTagOf(value: string): string
  donutArcs(counts: Counts, c: number): { cls: string; len: number; at: number }[]
  passText(counts: Counts): { total: number; pass: number; text: string }
  successRate(counts: Counts): { rate: number; done: number } | null
  sumCounts(pages: { counts: Counts }[]): Counts
  barParts(counts: Counts): { total: number; s: number; f: number; b: number }
  countsLine(counts: Counts): string
  filterPages(pages: unknown[], query: string): { id: string }[]
  filterTcs(tcs: unknown[], mode: string, retired: boolean, query?: string): { id: string }[]
  statusSegments(tcs: unknown[]): [string, string, number][]
  sortPages(pages: unknown[], sort?: { key: string; dir: string }): { id: string }[]
  trendText(trend: unknown, verdict: string): string
  attentionItems(pages: unknown[], reports: unknown[], edges: unknown[], now: Date): Record<string, unknown>[]
  deltaText(tcs: unknown[]): string
  filterReports(reports: unknown[], mode: string): { id: string }[]
  timelineStates(steps: { kind: string }[], report?: unknown): string[]
  pairStep(steps: { title: string; capture?: string }[] | undefined, step: { title: string }): { title: string; capture?: string } | undefined
  causeTitle(fail: unknown, verdict: string): string
  layoutFlow(nodes: { id: string; entry?: boolean }[], edges: { from: string; to: string }[], modals?: { id: string; page: string }[]): { pos: Record<string, { x: number; y: number }>; mpos: Record<string, { x: number; y: number }>; width: number; height: number; size: { h: number; mh: number } }
  confirmText(tcs: unknown[]): string
  progressText(progress: unknown): { done: number; total: number; text: string }
  finishText(progress: unknown): { tone: string; text: string; detail: string }
  guideFor(guides: { id: string; tcs: string[] }[], tc: string): { id: string } | undefined
  logParts(line: string): [string, string]
  splitPath(path: string): [string, string]
  procedureSteps(text: string): string[]
  runningStates(steps: { kind: string }[], step?: number): string[]
}

const page = (id: string, counts: Counts, extra = {}) => ({ id, title: id, urlPattern: `/${id}`, stale: false, counts, tcs: [], ...extra })

describe('panel pure', () => {
  it('성공률은 수행한 TC 의 최근 판정만으로', () => {
    expect(api.successRate({ 성공: 2, 실패: 1, 차단: 1, 미수행: 5 })).toEqual({ rate: 50, done: 4 })
    expect(api.successRate({ 미수행: 3 })).toBeNull()
    expect(api.sumCounts([page('a', { 성공: 1 }), page('b', { 성공: 2, 실패: 1 })])).toEqual({ 성공: 3, 실패: 1 })
    expect(api.barParts({ 성공: 1, 실패: 1, 미수행: 2, 폐기: 4 })).toEqual({ total: 4, s: 25, f: 25, b: 0 })
    expect(api.countsLine({ 미수행: 1, 성공: 2 })).toBe('성공 2 · 미수행 1')
  })

  it('배지 — 판정(채움)과 스크립트 상태(테두리)는 다른 색 · 모양', () => {
    expect(['성공', '일치', '실패', '다름', '차단', '멈춤', '미수행', '폐기', '?'].map(api.badgeOf)).toEqual(['ok', 'ok', 'ng', 'ng', 'hold', 'hold', 'idle', 'gone', 'idle'])
    expect(['검증됨', '미검증', '깨짐', '없음'].map(api.scriptTagOf)).toEqual(['s-verified', 's-pending', 's-broken', 's-none'])
  })

  it('도넛 · 통과 글 — 폐기는 세지 않는다', () => {
    expect(api.passText({ 성공: 3, 실패: 1, 폐기: 2 })).toEqual({ total: 4, pass: 3, text: '전체 4건 중 3건 통과' })
    expect(api.passText({})).toMatchObject({ total: 0, text: 'TC 없음' })
    const arcs = api.donutArcs({ 성공: 3, 미수행: 1 }, 100)
    expect(arcs).toEqual([{ cls: 's', len: 75, at: 0 }, { cls: 'i', len: 25, at: 75 }])
  })

  it('페이지 · TC 거르기', () => {
    const pages = [page('a', { 실패: 1 }), page('b', { 미수행: 2 }), page('c', { 성공: 1 }, { stale: true, tcs: [{ id: 'c-TC-001', content: '로그인 확인' }] })]
    expect(api.filterPages(pages, '').map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(api.filterPages(pages, '로그인').map((item) => item.id)).toEqual(['c'])
    const tcs = [{ id: '1', status: '성공', runCount: 2, title: '목록을 검색한다', content: '' }, { id: '2', status: '미수행', runCount: 0, title: '', content: '저장 → 안내' }, { id: '3', status: '폐기', runCount: 1, content: '' }, { id: '4', status: '실패', runCount: 1, content: '' }]
    expect(api.filterTcs(tcs, 'all', false).map((tc) => tc.id)).toEqual(['1', '2', '4'])
    expect(api.filterTcs(tcs, 'all', true).map((tc) => tc.id)).toEqual(['1', '2', '3', '4'])
    expect(api.filterTcs(tcs, '실패', false).map((tc) => tc.id)).toEqual(['4'])
    expect(api.filterTcs(tcs, 'all', false, '검색').map((tc) => tc.id)).toEqual(['1'])
    expect(api.statusSegments(tcs)).toEqual([['all', '전체', 3], ['실패', '실패', 1], ['미수행', '미수행', 1], ['성공', '성공', 1]])
  })

  it('페이지 표 정렬 — 결과는 실패 · 차단 몫, TC 없는 페이지는 맨 뒤. 정렬이 없으면 원래 순서', () => {
    const pages = [page('a', { 성공: 4 }), page('b', { 실패: 1, 성공: 1 }), page('c', {}), page('d', { 차단: 1, 성공: 3 })]
    expect(api.sortPages(pages, undefined).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(api.sortPages(pages, { key: 'result', dir: 'desc' }).map((item) => item.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(api.sortPages(pages, { key: 'result', dir: 'asc' }).map((item) => item.id)).toEqual(['c', 'a', 'd', 'b'])
  })

  it('확인 필요 — 실패 먼저 · 차단 · 불일치 이동 · 오래된 페이지, 원인과 꼬리표', () => {
    const pages = [
      page('a', { 차단: 1 }, { title: '설계', tcs: [{ id: 'a-TC-1', title: '승인 요청한다', status: '차단', lastRunAt: '2026-11-11', trend: { kind: 'still', count: 2 } }] }),
      page('b', { 실패: 1 }, { title: '요구사항', stale: true, lastVerified: '2026-10-01', tcs: [{ id: 'b-TC-1', title: '추가한다', status: '실패', lastRunAt: '2026-11-10', trend: { kind: 'new' } }, { id: 'b-TC-2', status: '성공', trend: { kind: 'fixed' } }] }),
    ]
    const reports = [{ id: 'r2', tc: 'b-TC-1', reason: '3단계 저장에서 멈춤', at: '2026-11-11 15:57' }, { id: 'r1', tc: 'b-TC-1', reason: '옛 원인' }]
    const items = api.attentionItems(pages, reports, [{ from: 'a', to: 'b', state: '불일치', lastVerified: '2026-11-01' }], new Date('2026-11-11T09:00:00'))
    expect(items.map((item) => [item['kind'], item['title'], item['tag']])).toEqual([['tc', '추가한다', '새로 실패'], ['tc', '승인 요청한다', '계속 차단 2회'], ['edge', '설계 → 요구사항', undefined], ['page', '요구사항', undefined]])
    expect(items[0]).toMatchObject({ reason: '3단계 저장에서 멈춤', at: '2026-11-11 15:57', page: 'b' })
    expect(items[3]!['reason']).toBe('최근 확인 41일 전')
    expect(api.deltaText(pages.flatMap((item) => (item as { tcs: unknown[] }).tcs))).toBe('지난 수행보다 실패 +1 · 고쳐짐 1')
    expect(api.trendText({ kind: 'fixed' }, '성공')).toBe('고쳐짐')
    expect(api.filterReports([{ id: '1', verdict: '성공' }, { id: '2', verdict: '실패' }], '실패').map((item) => item.id)).toEqual(['2'])
  })

  it('타임라인 — 멈춘 단계는 실패, 뒤는 하지 않음 · 판정이 다르면 판정만 실패 · 이동에서 막히면 첫 단계', () => {
    const steps = [{ kind: 'route' }, { kind: 'step' }, { kind: 'step' }, { kind: 'step' }, { kind: 'verify' }]
    const report = (verdict: string, extra = {}) => ({ head: { 판정: verdict }, steps: [], ...extra })
    expect(api.timelineStates(steps, undefined)).toEqual(['', '', '', '', ''])
    expect(api.timelineStates(steps, report('성공'))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(api.timelineStates(steps, report('차단', { failStep: { index: 3, step: 2 }, steps: [{ verdict: '' }, { verdict: '수행됨' }, { verdict: '멈춤' }] }))).toEqual(['ok', 'ok', 'ng', 'skip', 'skip'])
    expect(api.timelineStates(steps, report('실패', { failStep: { index: 4 } }))).toEqual(['ok', 'ok', 'ok', 'ok', 'ng'])
    expect(api.timelineStates(steps, report('차단'))).toEqual(['ng', 'skip', 'skip', 'skip', 'skip'])
    expect(api.causeTitle({ step: 3, title: '"저장하기" 클릭' }, '차단')).toBe('3단계 "저장하기" 클릭에서 멈춤')
    expect(api.causeTitle({ index: 4 }, '실패')).toBe('판정에서 다름')
  })

  it('수행 중 타임라인 — 지금 단계까지 통과, 그 단계는 진행 중, 이동 중이면 이동이 진행 중', () => {
    const steps = [{ kind: 'route' }, { kind: 'step' }, { kind: 'step' }, { kind: 'step' }, { kind: 'verify' }]
    expect(api.runningStates(steps, 0)).toEqual(['now', '', '', '', ''])
    expect(api.runningStates(steps, 2)).toEqual(['ok', 'ok', 'now', '', ''])
  })

  it('지난 성공과 같은 자리 — 단계 번호 · 판정 화면 · 대상 페이지끼리', () => {
    const before = [{ title: '대상 페이지 (수행 전)', capture: 'p' }, { title: '1. "추가하기" 클릭', capture: 'c1' }, { title: '판정 화면', capture: 'v' }]
    expect(api.pairStep(before, { title: '1. "추가하기" 클릭 — 멈춘 화면' })?.capture).toBe('c1')
    expect(api.pairStep(before, { title: '판정 화면 (기대와 다름)' })?.capture).toBe('v')
    expect(api.pairStep(undefined, { title: '판정 화면' })).toBeUndefined()
  })

  it('흐름 지도 배치 — 진입점이 첫 열, 이동 수가 열, 닿지 않는 페이지는 마지막 열', () => {
    const { pos, width } = api.layoutFlow([{ id: 'main', entry: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'lost' }], [{ from: 'main', to: 'a' }, { from: 'main', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'main' }])
    expect(pos['main']!.x).toBeLessThan(pos['a']!.x)
    expect(pos['a']!.x).toBe(pos['b']!.x)
    expect(pos['a']!.y).not.toBe(pos['b']!.y)
    expect(pos['c']!.x).toBeGreaterThan(pos['a']!.x)
    expect(pos['lost']!.x).toBeGreaterThan(pos['c']!.x)
    expect(width).toBeGreaterThan(pos['lost']!.x)
  })

  it('흐름 지도 배치 — 모달은 그 페이지 바로 아래에 차례로, 같은 열의 다음 페이지는 그만큼 내려간다', () => {
    const { pos, mpos, height, size } = api.layoutFlow([{ id: 'main', entry: true }, { id: 'a' }, { id: 'b' }], [{ from: 'main', to: 'a' }, { from: 'main', to: 'b' }], [{ id: 'a__new', page: 'a' }, { id: 'a__edit', page: 'a' }, { id: 'x__lost', page: 'x' }])
    expect(mpos['a__new']!.y).toBeGreaterThan(pos['a']!.y + size.h)
    expect(mpos['a__edit']!.y).toBeGreaterThan(mpos['a__new']!.y + size.mh)
    expect(pos['b']!.y).toBeGreaterThan(mpos['a__edit']!.y + size.mh)
    expect(mpos['x__lost']).toBeUndefined()
    expect(height).toBeGreaterThan(pos['b']!.y + size.h)
  })

  it('수행 확인 · 진행 · 마침 글', () => {
    expect(api.confirmText([{ id: 'a', runnable: { ok: true, changesData: true } }])).toBe('데이터를 만들거나 바꾸는 TC 입니다: a')
    expect(api.confirmText([{ id: 'a', runnable: { ok: true } }])).toContain('적혀 있지 않습니다')
    expect(api.progressText({ cases: [{ tc: 'a', state: '성공' }, { tc: 'b', state: '수행 중', step: 2, total: 5 }] })).toMatchObject({ done: 1, total: 2, text: 'b 수행 중 · 2/5단계' })
    expect(api.finishText({ cases: [{ tc: 'a', state: '성공' }, { tc: 'b', state: '차단', reason: '1단계 오류' }] })).toEqual({ tone: 'err', text: '패널 수행을 마쳤습니다 — 성공 1 · 차단 1', detail: 'b: 1단계 오류' })
    expect(api.guideFor([{ id: 'g2', tcs: ['x'] }, { id: 'g1', tcs: ['a'] }], 'a')?.id).toBe('g1')
    expect(api.logParts('[tool] browser_click(x) — 완료')).toEqual(['[tool]', ' browser_click(x) — 완료'])
  })

  it('절차 — 한 줄 「1) … 2) …」 도, 줄마다 「1. …」 도 단계로', () => {
    expect(api.procedureSteps('1) "추가하기" 클릭 2) 이름 입력')).toEqual(['"추가하기" 클릭', '이름 입력'])
    expect(api.procedureSteps('1. "추가하기" 클릭 → 대화상자\n2. 프로그램명 = `PROGRAM_NAME`')).toEqual(['"추가하기" 클릭 → 대화상자', '프로그램명 = `PROGRAM_NAME`'])
    expect(api.procedureSteps('')).toEqual([])
  })

  it('경로 가운데 자르기 — 끝 두 마디는 늘 남긴다', () => {
    expect(api.splitPath('/ko')).toEqual(['', '/ko'])
    expect(api.splitPath('/ko/process-management/analyze/*')).toEqual(['/ko/process-management', '/analyze/*'])
    expect(api.splitPath('/a/very-long-segment-name-that-goes-on')).toEqual(['/a', '/very-long-segment-name-that-goes-on'])
    const [head, tail] = api.splitPath('/ko/process-management/systemdesign/detail/edit')
    expect(head + tail).toBe('/ko/process-management/systemdesign/detail/edit')
    expect(tail).toBe('/detail/edit')
  })
})
