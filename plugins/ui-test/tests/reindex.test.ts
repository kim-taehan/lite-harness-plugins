import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reindex } from '../server/reindex.ts'
import { hashedScenarioId, openStore, requestIdFor, toResultDoc, type RunDoc } from '../server/store.ts'
import { fakeDb } from './store-helper.ts'

// 다시 채우기 — 임시 프로젝트 폴더의 .litecode/plugins/ui-test/scenarios/ 를 훑어 가짜 host.db 의 scenarios 를 맞춘다

let project: string
let pluginDir: string
let scenarioDir: string
const cfg = () => ({ project, scenarioDir })
beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), 'ui-test-reindex-'))
  pluginDir = path.join(project, '.litecode/plugins/ui-test')
  scenarioDir = path.join(pluginDir, 'scenarios')
  mkdirSync(scenarioDir, { recursive: true })
})
afterEach(() => rmSync(project, { recursive: true, force: true }))

const md = (name: string, title: string, extra = ''): string => `---\nname: ${title}\nkind: 정상\n---\n1. 연다\n2. 확인: 보인다\n${extra}`
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(scenarioDir, rel)), { recursive: true })
  writeFileSync(path.join(scenarioDir, rel), text)
}
const run = (scenarios: string[]): RunDoc => ({ at: 1, durationMs: 1, target: { kind: 'scenarios' }, scenarios, totals: { passed: 1, failed: 0, other: 0 }, report: 'one' })
const setup = () => {
  const fake = fakeDb()
  return { ...fake, store: openStore(fake.db) }
}

describe('reindex', () => {
  it('추가 — ASCII 이름은 이름이 id, 한글 파일명은 s-<해시> + file 색인', async () => {
    write('login-ok.md', md('x', '로그인'))
    write('01-정상-렌더링.md', md('x', '정상 렌더링'))
    const { store } = setup()
    const result = await reindex(store, cfg())
    expect(result).toMatchObject({ added: 2, updated: 0, removed: 0 })
    const all = new Map((await store.listScenarios()).map((item) => [item.id, item.doc]))
    expect(all.get('login-ok')).toMatchObject({ title: '로그인', kind: '정상', file: '.litecode/plugins/ui-test/scenarios/login-ok.md', screens: [], recent: [] })
    const korean = hashedScenarioId('.litecode/plugins/ui-test/scenarios/01-정상-렌더링.md')
    expect(all.get(korean)).toMatchObject({ title: '정상 렌더링', file: '.litecode/plugins/ui-test/scenarios/01-정상-렌더링.md' })
    expect(all.get('login-ok')!.fingerprint).toMatch(/^[0-9a-f]{12}$/)
  })

  it('같은 것은 건드리지 않는다 — 두 번째는 쓰기가 없다', async () => {
    write('a.md', md('x', 'A'))
    write('01-가.md', md('x', '가'))
    const { store, calls } = setup()
    await reindex(store, cfg())
    const writes = (): number => calls.filter((c) => ['set', 'delete', 'batch'].includes(c.method)).length
    const before = writes()
    expect(await reindex(store, cfg())).toMatchObject({ added: 0, updated: 0, removed: 0 })
    expect(writes()).toBe(before)
  })

  it('갱신 — 지문이 달라지면 고치고 last · recent 같은 기록은 그대로', async () => {
    write('a.md', md('x', 'A'))
    const { store } = setup()
    await reindex(store, cfg())
    await store.setLast('a', { status: 'passed', at: 1, run: 'r1' })
    const before = (await store.getScenario('a'))!
    write('a.md', md('x', 'A 고침', '3. 또 한다\n'))
    expect(await reindex(store, cfg())).toMatchObject({ added: 0, updated: 1, removed: 0 })
    const after = (await store.getScenario('a'))!
    expect(after.title).toBe('A 고침')
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(after.last).toEqual(before.last)
  })

  it('삭제 — 파일이 없어진 줄은 results 와 함께 지우고 파일로 지울 것을 돌려준다', async () => {
    write('a.md', md('x', 'A'))
    write('b.md', md('x', 'B'))
    const { store } = setup()
    await reindex(store, cfg())
    await store.recordRun('r1', run(['a', 'b']), [toResultDoc('r1', 1, { id: 'a', title: 'A', status: 'passed', durationMs: 1, steps: [{ title: 'x', status: 'passed', durationMs: 1, shot: '/d/01.jpg', used: [] }] }), toResultDoc('r1', 1, { id: 'b', title: 'B', status: 'passed', durationMs: 1, steps: [] })])
    rmSync(path.join(scenarioDir, 'a.md'))
    const result = await reindex(store, cfg())
    expect(result).toMatchObject({ added: 0, updated: 0, removed: 1 })
    expect(result.dropped.results.map((r) => [r.scenario, r.shots])).toEqual([['a', ['01.jpg']]])
    expect(result.dropped.runs).toEqual([])
    expect(await store.getScenario('a')).toBeNull()
    expect(await store.getResult('a', 'r1')).toBeNull()
    expect(await store.getResult('b', 'r1')).not.toBeNull()
  })

  it('수에 안 드는 것 — _ · . 로 시작하는 파일 · 하위 폴더 · 단계 없는 md', async () => {
    write('_prompt.md', md('x', 'P'))
    write('.hidden.md', md('x', 'H'))
    write('join/d.md', md('x', 'D'))
    write('notes.md', '# 메모\n그냥 글\n')
    write('ok.md', md('x', 'OK'))
    const { store } = setup()
    expect(await reindex(store, cfg())).toMatchObject({ added: 1 })
    expect((await store.listScenarios()).map((item) => item.id)).toEqual(['ok'])
  })

  it('수행 기록(<id>.history.md)은 시나리오가 아니다 — 번호 줄이 있어도 목록에 안 나온다', async () => {
    write('ok.md', md('x', 'OK'))
    write('ok.history.md', '## 다음 수행 때 지킬 것\n1. 첫 번째로 본 것\n2. 두 번째로 본 것\n\n## 2026-11-10 16:20 — 통과\n- 수행: r1\n')
    const { store } = setup()
    expect(await reindex(store, cfg())).toMatchObject({ added: 1 })
    expect((await store.listScenarios()).map((item) => item.id)).toEqual(['ok'])
  })

  it('요청 태그 — 머리 request · requested 에서, 파일 이름이 <요청 id>-<번호> 면 그 앞이 요청 id', async () => {
    const head = (title: string) => `---\nname: ${title}\nrequest: "메뉴 관리 화면 진행해줘 #12"\nrequested: 2026-11-10T01:05:00.000Z\n---\n1. 연다\n2. 확인: 보인다\n`
    write('20261110T110500_01-01.md', head('목록'))
    write('20261110T110500_01-02.md', head('저장'))
    write('옛이름.md', head('한글 파일명도 같은 요청 글이면 같은 요청'))
    write('other.md', md('x', '요청 머리 없음'))
    const { store } = setup()
    await reindex(store, cfg())
    const id = '20261110T110500_01'
    const request = (await store.getRequest(id))!
    expect(request).toMatchObject({ text: '메뉴 관리 화면 진행해줘 #12', at: Date.parse('2026-11-10T01:05:00.000Z'), scenarios: ['20261110T110500_01-01', '20261110T110500_01-02'] })
    expect((await store.getScenario('20261110T110500_01-02'))!.request).toBe(id)
    // 규칙에 안 맞는 파일 이름은 요청 글 · 시각의 해시 — 같은 글이어도 규칙에 맞는 이름과는 다른 요청
    const byText = requestIdFor(hashedScenarioId('.litecode/plugins/ui-test/scenarios/옛이름.md'), '메뉴 관리 화면 진행해줘 #12', '2026-11-10T01:05:00.000Z')
    expect(byText).toMatch(/^q-[0-9a-f]{12}$/)
    expect((await store.getScenario(hashedScenarioId('.litecode/plugins/ui-test/scenarios/옛이름.md')))!.request).toBe(byText)
    expect((await store.getScenario('other'))!.request).toBeUndefined()
  })

  it('화면 태그 — 한 번도 안 돈 시나리오는 머리 screens, 수행이 정한 뒤로는 덮지 않는다 · screen-names 는 screens 컬렉션에', async () => {
    write('a.md', `---\nname: A\nscreens: [/login, /admin/menu/12]\nscreen-names: {/login: 로그인, /admin/menu/12: 메뉴 관리}\n---\n1. 연다\n2. 확인: 보인다\n`)
    const { store } = setup()
    await reindex(store, cfg())
    expect((await store.getScenario('a'))!.screens).toEqual(['/login', '/admin/menu/:id'])
    expect((await store.getScreen('/login'))).toMatchObject({ route: '/login', name: '로그인' })
    expect((await store.getScreen('/admin/menu/:id'))).toMatchObject({ name: '메뉴 관리' })
    // 머리가 바뀌면 (아직 안 돌았으니) 따라간다
    write('a.md', `---\nname: A\nscreens: [/login]\n---\n1. 연다\n2. 확인: 보인다\n`)
    await reindex(store, cfg())
    expect((await store.getScenario('a'))!.screens).toEqual(['/login'])
    // 수행이 정한 뒤 — observed
    await store.upsertScenario('a', { screens: ['/seen'], observed: true })
    write('a.md', `---\nname: A\nscreens: [/login, /other]\n---\n1. 연다\n2. 확인: 보인다\n`)
    await reindex(store, cfg())
    expect((await store.getScenario('a'))!.screens).toEqual(['/seen'])
  })

  it('DB 가 비면 파일에서 다시 채운다 — 수행 기록만 잃는다', async () => {
    write('a.md', md('x', 'A'))
    const first = setup()
    await reindex(first.store, cfg())
    const second = setup()
    expect(await reindex(second.store, cfg())).toMatchObject({ added: 1 })
    expect((await second.store.getScenario('a'))!.title).toBe('A')
  })

  it('시나리오 폴더가 없으면 아무것도 지우지 않고, 있는데 비었으면 지운다', async () => {
    write('a.md', md('x', 'A'))
    const { store } = setup()
    await reindex(store, cfg())
    rmSync(scenarioDir, { recursive: true })
    expect(await reindex(store, cfg())).toMatchObject({ added: 0, updated: 0, removed: 0 })
    expect(await store.getScenario('a')).not.toBeNull()
    mkdirSync(scenarioDir)
    expect(await reindex(store, cfg())).toMatchObject({ removed: 1 })
    expect(await store.getScenario('a')).toBeNull()
  })
})
