import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 패널(index.html)의 순수 로직 — `// <pure>` ~ `// </pure>` 구간(DOM 을 모르는 그룹 · 검색 · 상태 · 질문 흐름)만 잘라 시험한다. 그리기는 실제 Chrome 으로 본다(README "앱에서 못 본 것")
const html = readFileSync(path.resolve(import.meta.dirname, '../index.html'), 'utf8')
const source = /\/\/ <pure>[^\n]*\n([\s\S]*?)\/\/ <\/pure>/.exec(html)?.[1]
if (!source) throw new Error('index.html 에서 <pure> 구간을 찾지 못했습니다')

type Row = { id: string; title: string; screens: string[]; request: string | null; status: string | null; lastAt: number | null }
type Group = { key: string; kind?: string; title: string; rows: Row[]; selector?: Record<string, string>; loose?: boolean; shown?: Row[]; lastRun?: { at: number } | null }
const api = new Function(`${source}\nreturn { whenText, dayText, dotOf, liveStatus, whenParts, sortRows, buildGroups, matches, showGroups, sharedCount, runPrompt, runCount, finishNote, bareTitle, docKey, docLabel, docChoices }`)() as {
  whenText(ms: number, now?: number): string
  dayText(ms: number): string
  dotOf(status: string): string
  liveStatus(row: Row, progress?: unknown): string
  whenParts(row: Row, status: string, now?: number): { kind: string; text: string; lead?: string }
  sortRows(rows: Row[], requests: Map<string, { at: number }>): Row[]
  buildGroups(view: string, rows: Row[], screens: Map<string, { name: string; lastRun?: { at: number } | null }>, requests: Map<string, { text: string; at: number; lastRun?: unknown }>): Group[]
  matches(row: Row, query: string, screens: Map<string, { name: string }>, requests: Map<string, { text: string }>): boolean
  showGroups(groups: Group[], query: string, screens: Map<string, { name: string }>, requests: Map<string, { text: string }>): Group[]
  sharedCount(rows: Row[]): number
  runPrompt(rows: unknown[]): string
  runCount(progress: unknown): { total: number; done: number; at: number; percent: number }
  finishNote(progress: unknown): { text: string; detail: string; report?: { file: string } }
  bareTitle(title: string): string
  docKey(doc: { run: string; kind: string; scenario?: string }): string
  docLabel(doc: { kind: string }): string
  docChoices(noPdf: boolean): string[]
}

const at = (d: number, h: number, m: number): number => new Date(2026, 10, d, h, m).getTime()
const NOW = at(10, 12, 0)
const row = (id: string, title: string, screens: string[], request: string | null, status: string | null = null, lastAt: number | null = null): Row => ({ id, title, screens, request, status, lastAt })
const rows = [
  row('a', '로그인 성공', ['/login'], 'r1', 'passed', at(10, 10, 42)),
  row('b', '로그인 실패 안내', ['/login'], 'r1', 'failed', at(10, 10, 42)),
  row('c', '메뉴 저장 후 다시 로그인', ['/admin/menu', '/login'], 'r2'),
  row('d', '요청 없이 만든 것', [], null),
]
const screens = new Map([['/login', { name: '로그인', lastRun: { at: at(10, 10, 42) } }], ['/admin/menu', { name: '/admin/menu', lastRun: null }]])
const requests = new Map([['r1', { text: '로그인화면', at: at(9, 15, 0) }], ['r2', { text: '메뉴 저장 흐름', at: at(10, 11, 0) }]])

describe('패널 순수 로직', () => {
  it('시각 글 — 오늘 · 어제 · 월-일', () => {
    expect(api.whenText(at(10, 9, 5), NOW)).toBe('오늘 09:05')
    expect(api.whenText(at(9, 17, 20), NOW)).toBe('어제 17:20')
    expect(api.whenText(at(8, 14, 30), NOW)).toBe('11-08 14:30')
    expect(api.dayText(at(9, 1, 0))).toBe('11-09')
  })

  it('상태 점 — 성공 · 실패 · 도는 중 · 대기 말고는 빈 고리', () => {
    expect(['passed', 'failed', 'running', 'queued', 'none', 'stopped', 'no-code', 'x'].map(api.dotOf)).toEqual(['passed', 'failed', 'running', 'queued', 'none', 'none', 'none', 'none'])
  })

  it('줄 상태 — 실행 중인 수행에 든 시나리오는 진행(도는 중 · 대기 · 방금 끝난 결과), 아니면 마지막 결과 · 실행 전', () => {
    const progress = { running: true, cases: [{ id: 'a', status: 'running' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'failed' }] }
    expect(rows.map((item) => api.liveStatus(item, progress))).toEqual(['running', 'queued', 'failed', 'none'])
    expect(rows.map((item) => api.liveStatus(item, { ...progress, running: false }))).toEqual(['passed', 'failed', 'none', 'none'])
    expect(api.liveStatus(rows[0]!, undefined)).toBe('passed')
  })

  it('줄 오른쪽 글 — 실패는 강조 + 시각, 실행 전 · 실행 중 · 대기', () => {
    expect(api.whenParts(rows[1]!, 'failed', NOW)).toEqual({ kind: 'fail', lead: '실패', text: '오늘 10:42' })
    expect(api.whenParts(rows[0]!, 'passed', NOW)).toEqual({ kind: 'plain', text: '오늘 10:42' })
    expect(api.whenParts(rows[3]!, 'none', NOW).text).toBe('실행 전')
    expect(api.whenParts(rows[0]!, 'running', NOW)).toEqual({ kind: 'run', text: '실행 중' })
    expect(api.whenParts(rows[0]!, 'queued', NOW).text).toBe('대기')
  })

  it('전체 목록 순서 — 새 요청의 시나리오가 위, 요청 없는 것은 맨 아래', () => {
    expect(api.sortRows(rows, requests).map((item) => item.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('화면별 — 여러 화면에 걸친 시나리오는 그 화면마다 들고, 최근 실행한 화면이 먼저, 화면 태그 없는 것은 끝의 "화면 미정"(실행 · 삭제 없음)', () => {
    const groups = api.buildGroups('screen', rows, screens, requests)
    expect(groups.map((group) => [group.key, group.title, group.rows.map((item) => item.id)])).toEqual([
      ['/login', '로그인', ['a', 'b', 'c']],
      ['/admin/menu', '/admin/menu', ['c']],
      ['', '화면 미정', ['d']],
    ])
    expect(groups[0]!.selector).toEqual({ screen: '/login' })
    expect(groups.at(-1)).toMatchObject({ loose: true })
  })

  it('요청별 — 새 요청이 먼저, 요청 없는 것은 끝(요청 없음), 요청 문장이 제목 · 선택자는 request', () => {
    const groups = api.buildGroups('request', rows, screens, requests)
    expect(groups.map((group) => [group.key, group.title])).toEqual([['r2', '메뉴 저장 흐름'], ['r1', '로그인화면'], ['', '요청 없음']])
    expect(groups[0]!.selector).toEqual({ request: 'r2' })
    expect(api.buildGroups('all', rows, screens, requests)).toEqual([{ key: 'all', rows }])
  })

  it('검색 — 제목 · 화면 이름 · 라우트 · 요청 문장, 대소문자 무시, 맞는 줄이 없는 그룹은 뺀다', () => {
    const find = (query: string) => rows.filter((item) => api.matches(item, query, screens, requests)).map((item) => item.id)
    expect(find('')).toEqual(['a', 'b', 'c', 'd'])
    expect(find('안내')).toEqual(['b'])
    expect(find('로그인화면')).toEqual(['a', 'b']) // 요청 문장
    expect(find('/ADMIN')).toEqual(['c']) // 라우트
    expect(find('로그인')).toEqual(['a', 'b', 'c']) // 제목 · 화면 이름 · 요청 문장
    const shown = api.showGroups(api.buildGroups('screen', rows, screens, requests), '요청 없이', screens, requests)
    expect(shown.map((group) => [group.title, group.shown!.map((item) => item.id)])).toEqual([['화면 미정', ['d']]])
    expect(api.showGroups(api.buildGroups('screen', rows, screens, requests), '없는말', screens, requests)).toEqual([])
  })

  it('삭제 확인의 "걸친" 개수', () => {
    expect(api.sharedCount(rows)).toBe(1)
    expect(api.sharedCount([rows[0]!, rows[3]!])).toBe(0)
  })

  it('실행 요청 글 — 첫 줄 /ui-test-run, 시나리오마다 id · md · 코드 · 수행 기록 경로, 코드 없는 것은 대상에서 뺀다', () => {
    const text = api.runPrompt([
      { id: 'a-01', title: '정상 로그인', file: '.litecode/plugins/ui-test/scenarios/a-01.md', hasCode: true, hasHistory: false },
      { id: 'a-03', title: '기록 있는 것', file: '.litecode/plugins/ui-test/scenarios/a-03.md', hasCode: true, hasHistory: true },
      { id: 'a-02', title: '코드 없는 것', file: '.litecode/plugins/ui-test/scenarios/a-02.md', hasCode: false, hasHistory: false },
    ])
    expect(text.split('\n')[0]).toBe('/ui-test-run 아래 시나리오를 실행하고 결과를 알려 주세요.')
    expect(text).toContain([
      '- 정상 로그인 (id a-01)',
      '  - 시나리오 `.litecode/plugins/ui-test/scenarios/a-01.md`',
      '  - 코드 `.litecode/plugins/ui-test/scenarios/a-01.spec.mjs`',
      '  - 수행 기록 `.litecode/plugins/ui-test/scenarios/a-01.history.md`(아직 없음)',
    ].join('\n'))
    expect(text).toContain('  - 수행 기록 `.litecode/plugins/ui-test/scenarios/a-03.history.md`\n')
    expect(text).toContain('코드가 없어 실행 대상에서 뺀 것:\n- 코드 없는 것 (id a-02) — 코드 없음')
    expect(text).not.toContain('a-02.spec.mjs')
    // 절차 · 정리 규칙 · 파일 내용은 글에 없다 — 스킬(ui-test-run)이 한다
    expect(text.split('\n').length).toBeLessThan(15)
    expect(text).not.toContain('다음 수행 때 지킬 것')
  })

  it('실행 배너 숫자와 완료 알림 글', () => {
    const progress = { running: true, cases: [{ status: 'passed' }, { status: 'running' }, { status: 'waiting' }] }
    expect(api.runCount(progress)).toEqual({ total: 3, done: 1, at: 2, percent: 50 })
    expect(api.runCount({ cases: [] })).toEqual({ total: 0, done: 0, at: 0, percent: 0 })
    expect(api.runCount({ cases: [{ status: 'passed' }, { status: 'failed' }] })).toMatchObject({ done: 2, at: 2, percent: 100 })
    const one = api.finishNote({ cases: [{ status: 'passed' }, { status: 'failed' }], reports: [{ file: '.litecode/plugins/ui-test/reports/r/index.html' }], recorded: true })
    expect(one).toMatchObject({ text: '2개 실행을 마쳤습니다 — 실패 1개', detail: '', report: { file: '.litecode/plugins/ui-test/reports/r/index.html' } })
    const each = api.finishNote({ cases: [{ status: 'passed' }, { status: 'passed' }], reports: [{ file: 'a' }, { file: 'b' }], recorded: false, stale: ['x'] })
    expect(each.report).toBeUndefined()
    expect(each.text).toBe('2개 실행을 마쳤습니다')
    expect(each.detail).toContain('코드가 낡은 채로 실행한 것 1개')
    expect(each.detail).toContain('기록은 남기지 못했습니다')
    expect(each.detail).toContain('시나리오마다 따로')
  })

  it('단계 제목 앞의 번호는 뗀다', () => {
    expect(['1. 연다', '2) 확인: 보인다', '확인: 숫자 10 개', ' 3.  넓게'].map(api.bareTitle)).toEqual(['연다', '확인: 보인다', '확인: 숫자 10 개', '넓게'])
  })
})

describe('패널 소스 규칙', () => {
  const script = html.slice(html.indexOf('<script>'))
  it('서비스를 거치는 이름만 부른다 — 앱 통로는 service.call 과 앱이 허용한 events · settings 뿐(규칙 10)', () => {
    const direct = [...script.matchAll(/\bcall\('([a-z.]+)'/g)].map((match) => match[1])
    expect([...new Set(direct)].sort()).toEqual(['events.subscribe', 'service.call', 'settings.open'])
    const names = [...script.matchAll(/\btool\('([A-Za-z]+)'/g)].map((match) => match[1])
    expect([...new Set(names)].sort()).toEqual(['ask', 'delete', 'detail', 'exportPdf', 'guide', 'list', 'openFile', 'prefs', 'progress', 'reindex', 'shot', 'stop'])
  })

  it('사용자 글은 innerHTML 로 넣지 않는다 — 고정 도판(svg)만, 바깥 리소스 · 하위 iframe 없음', () => {
    const inner = [...script.matchAll(/innerHTML\s*=\s*([^\n]+)/g)].map((match) => match[1]!)
    expect(inner.every((line) => /ICONS\[name\]|\bmarkup\b/.test(line))).toBe(true)
    expect(html).not.toMatch(/<(script|link|iframe|img)\b[^>]*\b(src|href)=/i)
    expect(html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//)
  })

  it('옛 말투가 없다 — 돌리기 · 묶음 · 수행 ▾', () => {
    const visible = html.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(visible).not.toMatch(/돌리|돌려|묶음|수행 ▾|suite/)
  })
})

describe('결과서 · 가이드 링크의 선택', () => {
  it('같은 수행의 결과서와 가이드, 시나리오마다 키가 다르다 — 한 번에 한 줄만 펼치는 기준', () => {
    const base = { run: '20261110T161829_01', scenario: 'a' }
    expect(api.docKey({ ...base, kind: 'report' })).not.toBe(api.docKey({ ...base, kind: 'guide' }))
    expect(api.docKey({ ...base, kind: 'report' })).not.toBe(api.docKey({ run: base.run, kind: 'report', scenario: 'b' }))
    expect(api.docKey({ run: 'r', kind: 'report' })).toBe('r:report:')
  })

  it('이름 — 가이드면 화면 가이드, 아니면 결과서', () => {
    expect([api.docLabel({ kind: 'guide' }), api.docLabel({ kind: 'report' })]).toEqual(['화면 가이드', '결과서'])
  })

  it('버튼 — PDF 로 저장 · 열기 · 취소, PDF 저장을 모르는 앱이면 열기 · 취소만', () => {
    expect(api.docChoices(false)).toEqual(['pdf', 'open', 'cancel'])
    expect(api.docChoices(true)).toEqual(['open', 'cancel'])
  })
})
