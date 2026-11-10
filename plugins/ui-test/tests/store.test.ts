import { describe, expect, it } from 'vitest'
import type { CaseResult } from '../server/types.ts'
import { COLLECTIONS, fitResult, hashedScenarioId, importedRequestId, isValidId, newScenarioId, openStore, resultId, scenarioIdForFile, timeId, toResultDoc, type RunDoc, type ScenarioDoc } from '../server/store.ts'
import { fakeDb } from './store-helper.ts'

// 저장 계층 — 진짜 앱과 같은 처리기를 쓰는 SDK 가짜 host 의 host.db 로 본다

const doc = (extra: Partial<ScenarioDoc> = {}): Partial<ScenarioDoc> => ({ title: '제목', fingerprint: 'aaaaaaaaaaaa', file: 'ui-tests/a.md', ...extra })
const run = (scenarios: string[]): RunDoc => ({ at: 1, durationMs: 10, target: { kind: 'scenarios' }, scenarios, totals: { passed: scenarios.length, failed: 0, other: 0 }, report: 'one' })
const caseOf = (id: string, extra: Partial<CaseResult> = {}): CaseResult => ({ id, title: id, status: 'passed', durationMs: 5, steps: [{ title: '열기', status: 'passed', durationMs: 1, shot: '/data/shots/r1/01.jpg', used: [] }], ...extra })

describe('id', () => {
  it('isValidId — ASCII 와 _ . - 128자까지, 한글 · 슬래시 · ~ 는 거부', () => {
    expect(isValidId('20261110T110500_01-02')).toBe(true)
    expect(isValidId('a'.repeat(128))).toBe(true)
    expect(isValidId('a'.repeat(129))).toBe(false)
    for (const bad of ['', '01-정상', 'a/b', 'a~b', 'a b', 5, undefined]) expect(isValidId(bad)).toBe(false)
  })

  it('timeId 는 시각순 · 번호, 새 시나리오 id 는 요청 id-번호', () => {
    const id = timeId(new Date(2026, 10, 10, 11, 5, 0))
    expect(id).toBe('20261110T110500_01')
    expect(timeId(new Date(2026, 10, 10, 11, 5, 1)) > timeId(new Date(2026, 10, 10, 11, 5, 0), 9)).toBe(true)
    expect(newScenarioId(id, 2)).toBe('20261110T110500_01-02')
    expect(isValidId(newScenarioId(id, 2))).toBe(true)
  })

  it('옛 파일 이름 — 한글 · 하위 폴더는 s-<해시>, 바로 아래 ASCII 는 이름 그대로', () => {
    const korean = scenarioIdForFile('ui-tests/가입/01-정상-렌더링.md', false)
    expect(korean).toMatch(/^s-[0-9a-f]{12}$/)
    expect(korean).toBe(hashedScenarioId('ui-tests/가입/01-정상-렌더링.md'))
    expect(scenarioIdForFile('ui-tests/01-정상.md', true)).toMatch(/^s-/)
    expect(scenarioIdForFile('ui-tests/login-ok.md', true)).toBe('login-ok')
    expect(scenarioIdForFile('ui-tests/join/login-ok.md', false)).toMatch(/^s-/)
    expect(importedRequestId('가입설계')).toMatch(/^q-[0-9a-f]{12}$/)
    expect(isValidId(resultId('s-abc', timeId(new Date())))).toBe(true)
  })
})

describe('openStore', () => {
  it('db 가 없으면 db-unavailable', () => {
    expect(() => openStore(undefined)).toThrowError('db-unavailable')
    try {
      openStore(undefined)
    } catch (error) {
      expect((error as { code: string }).code).toBe('db-unavailable')
    }
  })

  it('시나리오 upsert(합치기) · get · 삭제', async () => {
    const store = openStore(fakeDb().db)
    await store.upsertScenario('a', doc())
    await store.upsertScenario('a', { title: '새 제목' })
    expect(await store.getScenario('a')).toEqual({ ...doc(), title: '새 제목', screens: [], recent: [] })
    expect(await store.setLast('a', { status: 'failed', at: 5, run: 'r' })).toBe(true)
    expect((await store.getScenario('a'))!.last).toEqual({ status: 'failed', at: 5, run: 'r' })
    expect(await store.setLast('nope', { status: 'passed', at: 1, run: 'r' })).toBe(false)
    expect(await store.deleteScenario('a')).toEqual({ results: [], runs: [] })
    expect(await store.getScenario('a')).toBeNull()
  })

  it('요청 · 수행 id 는 같은 초에 번호가 오른다', async () => {
    const fixed = new Date(2026, 10, 10, 11, 5, 0)
    const store = openStore(fakeDb().db, { now: () => fixed })
    const first = await store.recordRequest('가입 화면 테스트', ['a'])
    const second = await store.recordRequest('또', [])
    expect([first, second]).toEqual(['20261110T110500_01', '20261110T110500_02'])
    expect(await store.getRequest(first)).toEqual({ text: '가입 화면 테스트', at: fixed.getTime(), scenarios: ['a'] })
    const runId = await store.newRunId()
    await store.recordRun(runId, run([]), [])
    expect(await store.newRunId()).toBe('20261110T110500_02')
  })

  it('시간 id 는 정리로 지워진 id 를 다시 내지 않는다(id 순이 시간순)', async () => {
    const fixed = new Date(2026, 10, 10, 11, 5, 0)
    const { db } = fakeDb()
    const store = openStore(db, { now: () => fixed })
    const first = await store.newRunId()
    await store.recordRun(first, run([]), [])
    const second = await store.newRunId()
    await store.recordRun(second, run([]), [])
    await db.delete('runs', first) // 정리가 오래된 수행을 지웠다
    expect(await store.newRunId()).toBe('20261110T110500_03')
  })

  it('toResultDoc — 단계의 확인 주소(url)에서 본 주소를 모은다', () => {
    const result: CaseResult = { id: 'a', title: 'A', status: 'passed', durationMs: 1, steps: [{ title: '1. 연다', status: 'passed', durationMs: 1, used: [] }, { title: '2. 확인: x', status: 'passed', durationMs: 1, url: '/a/1', used: [] }, { title: '3. 확인: y', status: 'passed', durationMs: 1, url: '/a/1', used: [] }, { title: '4. 확인: z', status: 'passed', durationMs: 1, url: '/b', used: [] }] }
    expect(toResultDoc('r', 1, result).urls).toEqual(['/a/1', '/b'])
    expect(toResultDoc('r', 1, result).steps[1]!.url).toBe('/a/1')
  })

  it('markGroupRun — 요청 · 화면 그룹의 마지막 수행을 적는다(화면 문서가 없으면 만든다)', async () => {
    const store = openStore(fakeDb().db)
    await store.putRequest('q1', { text: '요청', at: 1, scenarios: ['a'] })
    await store.markGroupRun({ kind: 'request', value: 'q1' }, 'r1')
    await store.markGroupRun({ kind: 'screen', value: '/login' }, 'r2')
    await store.markGroupRun({ kind: 'scenarios' }, 'r3')
    await store.markGroupRun({ kind: 'request', value: 'none' }, 'r4')
    expect((await store.getRequest('q1'))!.lastRun).toBe('r1')
    expect(await store.getScreen('/login')).toMatchObject({ route: '/login', name: '/login', rules: [], lastRun: 'r2' })
    expect(await store.getRequest('none')).toBeNull()
  })

  it('recordRun — 결과는 파일 이름만, recent 에 수행 id', async () => {
    const store = openStore(fakeDb().db)
    await store.upsertScenario('a', doc())
    await store.recordRun('r1', run(['a']), [toResultDoc('r1', 1, caseOf('a'), ['/join'])])
    const result = await store.getResult('a', 'r1')
    expect(result).toMatchObject({ scenario: 'a', run: 'r1', status: 'passed', shots: ['01.jpg'], urls: ['/join'] })
    expect(result!.steps[0]!.shot).toBe('01.jpg')
    expect((await store.getScenario('a'))!.recent).toEqual(['r1'])
    expect(await store.getRun('r1')).toMatchObject({ scenarios: ['a'] })
  })

  it('최근 20개만 남기고 넘친 results · 결과 없어진 runs 를 돌려준다', async () => {
    const { db } = fakeDb()
    const store = openStore(db)
    await store.upsertScenario('a', doc())
    await store.upsertScenario('b', doc({ file: 'ui-tests/b.md' }))
    for (let n = 1; n <= 22; n++) {
      const id = `r${String(n).padStart(2, '0')}`
      // 앞 두 수행은 a · b 같이, 나머지는 a 만 — b 는 두 개뿐이라 안 넘친다
      const ids = n <= 2 ? ['a', 'b'] : ['a']
      await store.recordRun(id, run(ids), ids.map((s) => toResultDoc(id, n, caseOf(s))))
    }
    const dropped = await store.pruneResults(['a', 'b'])
    expect(dropped.results.map((r) => [r.scenario, r.run])).toEqual([['a', 'r01'], ['a', 'r02']])
    expect(dropped.results[0]!.shots).toEqual(['01.jpg'])
    // r01 · r02 는 b 가 아직 들고 있어 run 은 남는다
    expect(dropped.runs).toEqual([])
    expect((await store.getScenario('a'))!.recent).toHaveLength(20)
    expect(await store.getResult('a', 'r01')).toBeNull()
    expect(await store.getResult('b', 'r01')).not.toBeNull()
    // b 를 지우면 r01 · r02 의 결과가 모두 사라져 그 runs 도 돌려준다
    const gone = await store.deleteScenario('b')
    expect(gone.results.map((r) => r.run)).toEqual(['r01', 'r02'])
    expect(gone.runs).toEqual(['r01', 'r02'])
    expect(await store.getRun('r01')).toBeNull()
    expect(await store.getRun('r03')).not.toBeNull()
  })

  it('시나리오 삭제는 results 까지, 요청 태그에서도 빠지고 비면 요청도 지운다', async () => {
    const { db } = fakeDb()
    const store = openStore(db)
    const request = await store.recordRequest('요청', ['a', 'b'])
    await store.upsertScenario('a', doc({ request }))
    await store.upsertScenario('b', doc({ request }))
    await store.recordRun('r1', run(['a', 'b']), [toResultDoc('r1', 1, caseOf('a')), toResultDoc('r1', 1, caseOf('b'))])
    expect(await store.deleteScenario('a')).toMatchObject({ runs: [] })
    expect(await store.getResult('a', 'r1')).toBeNull()
    expect((await store.getRequest(request))!.scenarios).toEqual(['b'])
    expect((await store.deleteScenario('b')).runs).toEqual(['r1'])
    expect(await store.getRequest(request)).toBeNull()
    for (const name of Object.values(COLLECTIONS)) expect((await db.list(name)).docs).toEqual([])
  })

  it('batch 는 50개씩 나눠 보낸다 — 쓰기(수행 기록)도 지우기(시나리오 삭제)도', async () => {
    const { db } = fakeDb()
    const sizes: number[] = []
    const store = openStore({ ...db, batch: (ops) => (sizes.push(ops.length), db.batch(ops)) })
    const ids = Array.from({ length: 60 }, (_, n) => `s${n}`)
    for (const id of ids) await store.upsertScenario(id, doc())
    await store.recordRun('r1', run(ids), ids.map((id) => toResultDoc('r1', 1, caseOf(id))))
    expect(sizes).toEqual([50, 50, 21])
    sizes.length = 0
    await store.upsertScenario('big', doc())
    for (let n = 1; n <= 120; n++) await store.recordRun(`q${String(n).padStart(3, '0')}`, run(['big']), [toResultDoc(`q${n}`, n, caseOf('big'))])
    sizes.length = 0
    const dropped = await store.deleteScenario('big')
    expect(dropped.results).toHaveLength(120)
    expect(dropped.runs).toHaveLength(120)
    expect(sizes.every((size) => size <= 50)).toBe(true)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(120 + 1 + 120)
  })

  it('쪽 읽기 — 200 넘는 시나리오 250개는 두 쪽으로 모두 읽힌다', async () => {
    const { db, calls } = fakeDb()
    const store = openStore(db)
    for (let n = 0; n < 250; n++) await store.upsertScenario(`s${String(n).padStart(3, '0')}`, doc())
    const before = calls.filter((c) => c.method === 'list').length
    const all = await store.listScenarios()
    expect(all).toHaveLength(250)
    expect(all.map((item) => item.id)).toEqual([...all.map((item) => item.id)].sort())
    expect(calls.filter((c) => c.method === 'list').length - before).toBe(2)
    const first = await store.scenarioPage()
    expect(first.items).toHaveLength(200)
    expect((await store.scenarioPage(first.cursor)).items).toHaveLength(50)
  })

  it('화면 문서는 라우트를 해시 id 로', async () => {
    const store = openStore(fakeDb().db)
    await store.putScreen({ route: '/join/:id', name: '가입', rules: [] })
    expect(await store.getScreen('/join/:id')).toMatchObject({ name: '가입' })
    expect((await store.listScreens()).map((s) => s.doc.route)).toEqual(['/join/:id'])
  })
})

describe('fitResult', () => {
  it('긴 오류 글을 자르고 256KB 를 넘지 않는다', () => {
    const long = 'x'.repeat(100_000)
    const steps = Array.from({ length: 30 }, (_, n) => ({ title: `단계 ${n}`, status: 'failed' as const, durationMs: 1, error: long, used: ['a'.repeat(500)] }))
    const result = toResultDoc('r', 1, caseOf('a', { status: 'failed', error: long, steps, rows: [{ row: 1, label: 'x', status: 'failed', durationMs: 1, steps, error: long }] }))
    const fit = fitResult(result)
    expect(fit.error!.length).toBeLessThanOrEqual(2001)
    expect(Buffer.byteLength(JSON.stringify(fit))).toBeLessThan(256 * 1024)
  })

  it('작은 결과는 그대로', () => {
    const result = toResultDoc('r', 1, caseOf('a'))
    expect(fitResult(result)).toEqual(result)
  })
})
