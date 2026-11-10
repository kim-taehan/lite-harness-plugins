import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv, KEEP_RUNS } from '../server/config.ts'
import { driverFor, type BrowserLike } from '../server/driver.ts'
import { fingerprint } from '../server/scenario.ts'
import { Workspace, type RunOutcome } from '../server/runner.ts'
import type { PageLike } from '../server/steps.ts'
import { createTools, PANEL_TOOLS } from '../server/tools.ts'
import { fakeDb } from './store-helper.ts'

// 실행기 (0.7.0) — 시나리오 선택자 · 화면 태그 · 결과서 하나/따로 · 비교 · 최근 20개 정리 · DB 없는 실행 · 삭제 · reindex 연동. 진짜 브라우저는 띄우지 않는다(가짜 드라이버 launch)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

function pageAt(): PageLike {
  let current = 'http://a/'
  return {
    screenshot: async () => JPEG,
    url: () => current,
    title: async () => '',
    goto: async (url: string) => {
      current = new URL(url, 'http://a/').href
      return null
    },
  }
}
const browser = (): BrowserLike => ({ newContext: async () => ({ newPage: async () => pageAt(), close: async () => undefined }), close: async () => undefined })

let dir: string
let root: string
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-ws-')))
  root = path.join(dir, 'proj')
  await fs.mkdir(path.join(root, '.litecode/plugins/ui-test/scenarios'), { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const flags = ((globalThis as Record<string, unknown>)['__uiTestWs'] ??= {}) as Record<string, boolean>

/** 시나리오 한 개 — md 와 생성 코드. 1 연다(goto) → 2 확인(그 주소에서). 코드는 flags[이름] 이 false 면 확인에서 실패 */
async function put(rel: string, options: { title: string; page: string; second?: string; request?: string; screens?: string; tags?: string; names?: string; ok?: boolean; checkStep?: boolean }): Promise<string> {
  const key = `${root}|${rel}`
  flags[key] = options.ok ?? true
  const md = `---\nname: ${options.title}\n${options.request ? `request: "${options.request}"\nrequested: 2026-11-10T01:00:00.000Z\n` : ''}${options.tags ? `tags: [${options.tags}]\n` : ''}${options.screens ? `screens: [${options.screens}]\n` : ''}${options.names ? `screen-names: {${options.names}}\n` : ''}---\n1. 연다\n${options.checkStep === false ? '' : '2. 확인: 보인다\n'}${options.second ? '3. 다른 화면을 연다\n4. 확인: 또 보인다\n' : ''}`
  const file = path.join(root, '.litecode/plugins/ui-test/scenarios', rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, md)
  await fs.writeFile(file.replace(/\.md$/, '.spec.mjs'), `// ui-test source: .litecode/plugins/ui-test/scenarios/${rel} · fingerprint: ${fingerprint(md)}\nexport default async ({ step, page }) => {\n  await step('1. 연다', async () => page.goto(${JSON.stringify(options.page)}))\n${options.checkStep === false ? '' : `  await step('2. 확인: 보인다', async () => { if (!globalThis.__uiTestWs[${JSON.stringify(key)}]) throw new Error('안 보임') })\n`}${options.second ? `  await step('3. 다른 화면을 연다', async () => page.goto(${JSON.stringify(options.second)}))\n  await step('4. 확인: 또 보인다', async () => undefined)\n` : ''}}\n`)
  return md
}
const setOk = (rel: string, ok: boolean): void => void (flags[`${root}|${rel}`] = ok)

function open(withDb = true) {
  const fake = fakeDb()
  const config = configFromEnv({ UI_TEST_BASE_URL: 'http://a', UI_TEST_USER: 'tester', UI_TEST_DATA_DIR: path.join(dir, 'data') }, root)
  const space = new Workspace(config, async () => browser(), withDb ? fake.db : undefined)
  return { space, store: space.store!, fake, config }
}
const ids = (outcome: RunOutcome): string[] => outcome.run.cases.map((item) => item.id)

describe('시나리오 선택자', () => {
  async function seed() {
    await put('q1-01.md', { title: '로그인 성공', page: '/main', request: '로그인 화면', screens: '/login', names: '/login: 로그인' })
    await put('q1-02.md', { title: '로그인 실패 안내', page: '/main', request: '로그인 화면', screens: '/login', ok: false })
    await put('menu-목록.md', { title: '메뉴 목록', page: '/main', request: '메뉴 관리 화면', screens: '/admin/menu' })
    await put('menu-저장.md', { title: '메뉴 저장 후 다시 로그인', page: '/main', request: '메뉴 관리 화면', screens: '/admin/menu, /login' })
    const ws = open()
    await ws.space.reindex()
    return ws
  }

  it('아무것도 안 주면 전부, scenarios 는 id · 제목 · 파일 이름, 없는 것은 거절', async () => {
    const { space } = await seed()
    expect((await space.select({})).infos).toHaveLength(4)
    expect((await space.select({ scenarios: ['q1-01', '메뉴 목록', 'menu-저장.md'] })).infos.map((item) => item.scenario.name).sort()).toEqual(['로그인 성공', '메뉴 목록', '메뉴 저장 후 다시 로그인'])
    await expect(space.select({ scenarios: ['q1-09'] })).rejects.toThrow('없는 시나리오: q1-09')
  })

  it('screen — 라우트 또는 화면 이름, 여러 화면에 걸친 시나리오도 그 화면 그룹에 든다', async () => {
    const { space } = await seed()
    const byRoute = await space.select({ screen: '/login' })
    expect(byRoute.infos.map((item) => item.id)).toEqual(expect.arrayContaining(['q1-01', 'q1-02']))
    expect(byRoute.infos).toHaveLength(3)
    expect(byRoute.target).toEqual({ kind: 'screen', value: '/login' })
    expect((await space.select({ screen: '로그인' })).infos).toHaveLength(3)
    expect((await space.select({ screen: '/admin/menu' })).infos).toHaveLength(2)
  })

  it('request — 요청 id(= 파일 이름 앞) 로, failed — 마지막 실행이 실패인 것만, 여럿을 주면 교집합', async () => {
    const { space, store } = await seed()
    const requests = await store.listRequests()
    expect(requests.map((item) => item.doc.text).sort()).toEqual(['로그인 화면', '메뉴 관리 화면'])
    const login = requests.find((item) => item.doc.text === '로그인 화면')!.id
    expect((await space.select({ request: login })).infos.map((item) => item.id).sort()).toEqual(['q1-01', 'q1-02'])
    await space.run({})
    expect((await space.select({ failed: true })).infos.map((item) => item.id)).toEqual(['q1-02'])
    expect((await space.select({ failed: true, screen: '/admin/menu' })).infos).toEqual([])
    expect((await space.select({ failed: true, request: login })).infos.map((item) => item.id)).toEqual(['q1-02'])
    await expect(space.start({ failed: true, screen: '/admin/menu' })).rejects.toThrow('마지막 실행이 실패인 시나리오가 없습니다')
  })
})

describe('화면 태그 — "확인:" 단계를 실행한 주소', () => {
  it('확인 단계의 주소가 라우트 패턴(숫자 → :id)으로 화면 태그가 되고, md 머리의 screens 는 처음뿐', async () => {
    await put('a-01.md', { title: '메뉴 상세', page: '/admin/menu/12?tab=1', screens: '/old' })
    const { space, store } = open()
    await space.reindex()
    expect((await store.getScenario('a-01'))!.screens).toEqual(['/old'])
    const outcome = await space.run({})
    expect(outcome.run.cases[0]!.steps[1]!.url).toBe('/admin/menu/12')
    const doc = (await store.getScenario('a-01'))!
    expect(doc).toMatchObject({ screens: ['/admin/menu/:id'], observed: true, last: { status: 'passed', run: outcome.run.id } })
    // 수행이 정한 뒤로는 reindex 가 md 의 screens 로 덮지 않는다
    await fs.appendFile(path.join(root, '.litecode/plugins/ui-test/scenarios/a-01.md'), '3. 확인: 또\n')
    await space.reindex()
    expect((await store.getScenario('a-01'))!.screens).toEqual(['/admin/menu/:id'])
    expect((await store.getResult('a-01', outcome.run.id))!.urls).toEqual(['/admin/menu/12'])
  })

  it('로그인 시나리오는 로그인 뒤 이동한 화면을 태그로 더하지 않는다 — 머리 screens 그대로, 다른 시나리오는 관찰 주소를 더한다', async () => {
    await put('a-01.md', { title: '정상 로그인', page: '/dashboard', screens: '/login' })
    await put('a-02.md', { title: '인증 화면', page: '/home', screens: '/auth', tags: '로그인' })
    await put('a-03.md', { title: '대시보드', page: '/dashboard/7', screens: '/dashboard' })
    const { space, store } = open()
    await space.reindex()
    await space.run({})
    expect((await store.getScenario('a-01'))!.screens).toEqual(['/login'])
    expect((await store.getScenario('a-01'))!.observed).toBeUndefined()
    expect((await store.getScenario('a-02'))!.screens).toEqual(['/auth'])
    expect((await store.getScenario('a-03'))!.screens).toEqual(['/dashboard/:id']) // 로그인이 아니면 관찰 주소로 바뀌던 기존 동작 그대로
    expect((await store.getScenario('a-03'))!.observed).toBe(true)
    expect((await store.getScenario('a-01'))!.last).toMatchObject({ status: 'passed' })
  })

  it('거쳐 가는 로그인은 "확인:" 단계가 없으면 붙지 않는다 — 확인 단계가 없으면 태그가 안 바뀐다', async () => {
    await put('a-01.md', { title: '로그인만 거침', page: '/login', checkStep: false })
    const { space, store } = open()
    await space.run({})
    expect((await store.getScenario('a-01'))!.screens).toEqual([])
    expect((await store.getScenario('a-01'))!.observed).toBeUndefined()
  })

  it('성공이면 이번에 본 화면으로 바꾸고, 실패하면 거기까지 본 것을 더한다', async () => {
    await put('a-01.md', { title: '두 화면', page: '/orders/7' })
    const { space, store } = open()
    await space.run({})
    await store.upsertScenario('a-01', { screens: ['/orders/:id', '/legacy'] })
    await space.run({})
    expect((await store.getScenario('a-01'))!.screens).toEqual(['/orders/:id'])
    await store.upsertScenario('a-01', { screens: ['/orders/:id', '/legacy'] })
    setOk('a-01.md', false)
    await space.run({})
    expect((await store.getScenario('a-01'))!.screens).toEqual(['/orders/:id', '/legacy'])
  })
})

describe('결과서 — 늘 시나리오마다 따로', () => {
  async function two() {
    await put('a-01.md', { title: '에이', page: '/a' })
    await put('a-02.md', { title: '비', page: '/b', ok: false })
    return open()
  }

  it('여러 개를 실행하면 시나리오 폴더마다 하나, 그 시나리오 것만 — 합치는 선택은 없다', async () => {
    const { space, store } = await two()
    const outcome = await space.run({})
    expect(outcome.reports.map((item) => item.file)).toEqual(['a-01', 'a-02'].map((id) => path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, id, 'index.html')))
    const first = await fs.readFile(outcome.reports[0]!.file, 'utf8')
    expect(first).toContain('에이')
    expect(first).not.toContain('id="s-a-02"')
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, 'index.html'))).toBe(false)
    expect((await store.getRun(outcome.run.id))!.report).toBe('each')
    expect(space.documentsOf(outcome.run.id, 'each', 'a-01').report).toEqual({ file: `.litecode/plugins/ui-test/reports/${outcome.run.id}/a-01/index.html` })
    expect(JSON.parse(JSON.stringify(space.current().reports!.map((item) => item.scenario)))).toEqual(['a-01', 'a-02'])
  })

  it('시나리오가 하나뿐이어도 시나리오 폴더에 낸다', async () => {
    await put('a-01.md', { title: '에이', page: '/a' })
    const { space, store } = open()
    const outcome = await space.run({})
    expect(outcome.mode).toBe('each')
    expect(outcome.reports[0]!.file).toBe(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, 'a-01', 'index.html'))
    expect((await store.getRun(outcome.run.id))!.report).toBe('each')
  })

  it('가이드 — 시나리오 폴더마다', async () => {
    const { space } = await two()
    const each = await space.run({})
    const files = await space.writeGuide(each.run.id)
    expect(files.map((item) => path.basename(path.dirname(item.file)))).toEqual(['a-01', 'a-02'])
    expect(space.documentsOf(each.run.id, 'each', 'a-02').guide).toEqual({ file: `.litecode/plugins/ui-test/reports/${each.run.id}/a-02/guide.html` })
  })
})

describe('비교 — 시나리오마다 마지막으로 실제 실행한 결과와', () => {
  it('새로 실패 · 고쳐짐 · 그대로 실패, 일부만 실행해도 나머지의 마지막 결과가 남는다', async () => {
    await put('a-01.md', { title: '에이', page: '/a' })
    await put('a-02.md', { title: '비', page: '/b', ok: false })
    const { space } = open()
    const first = await space.run({})
    expect(first.run.compare).toBeUndefined()
    expect(first.recorded).toBe(true)
    setOk('a-01.md', false)
    setOk('a-02.md', true)
    const second = await space.run({ scenarios: ['a-02'] }) // 02 만 다시 — 01 은 성공 그대로
    expect(second.run.compare).toMatchObject({ previousId: first.run.id, newFail: [], fixed: ['a-02'], stillFail: [] })
    const third = await space.run({})
    expect(third.run.compare).toMatchObject({ previousId: second.run.id, newFail: ['a-01'], fixed: [], stillFail: [] })
    const fourth = await space.run({ failed: true })
    expect(ids(fourth)).toEqual(['a-01'])
    expect(fourth.run.compare).toMatchObject({ newFail: [], stillFail: ['a-01'] })
  })
})

describe('정리 — 시나리오마다 최근 20개', () => {
  it('넘친 결과 · 스크린샷 · 결과 없는 수행의 결과서를 지운다', async () => {
    await put('a-01.md', { title: '에이', page: '/a' })
    const { space, store } = open()
    const runIds: string[] = []
    for (let index = 0; index < 22; index++) runIds.push((await space.run({})).run.id)
    const doc = (await store.getScenario('a-01'))!
    expect(doc.recent).toEqual(runIds.slice(2))
    expect(await store.getRun(runIds[0]!)).toBeNull()
    expect(await store.getResult('a-01', runIds[1]!)).toBeNull()
    for (const gone of runIds.slice(0, 2)) {
      expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', gone))).toBe(false)
      expect(existsSync(space.files.shotsDir(gone))).toBe(false)
    }
    for (const kept of runIds.slice(2)) {
      expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', kept, 'a-01', 'index.html'))).toBe(true)
      expect(existsSync(space.files.shotsDir(kept))).toBe(true)
    }
    expect(KEEP_RUNS).toBe(20)
  })
})

describe('DB 없는 실행 (앱 밖 · CI · 옛 앱)', () => {
  it('실행 · 결과서는 되고 기록 · 비교는 건너뛴다 — 결과 글에 안내가 있고 목록 · 삭제는 db-unavailable', async () => {
    await put('a-01.md', { title: '에이', page: '/a' })
    await put('a-02.md', { title: '비', page: '/b', ok: false })
    const { space } = open(false)
    expect(space.store).toBeUndefined()
    const tools = createTools({ workspace: space, checkDriver: () => driverFor('web', { channel: 'chrome' }), serverFile: '/p/ui-test.mjs' })
    const tool = (name: string) => tools.find((item) => item.name === name)!
    const result = await tool('run').run({ scenarios: ['a-01'] })
    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('기록은 남기지 않았습니다(앱 밖 실행)')
    expect(result.text).not.toContain('지난 실행')
    const outcome = await space.run({})
    expect(ids(outcome)).toEqual(['a-01', 'a-02'])
    expect(outcome.recorded).toBe(false)
    expect(outcome.run.compare).toBeUndefined()
    expect(outcome.reports.map((item) => existsSync(item.file))).toEqual([true, true])
    expect(existsSync(space.files.shotsDir(outcome.run.id))).toBe(true)
    await expect(space.run({ screen: '/login' })).rejects.toThrow('db-unavailable')
    await expect(space.run({ failed: true })).rejects.toThrow('db-unavailable')
    await expect(space.run({ scenarios: ['없음'] })).rejects.toThrow('없는 시나리오')
    // 방금 실행한 수행의 가이드는 메모리 기록으로 쓴다
    expect((await space.writeGuide(outcome.run.id)).length).toBe(2) // 시나리오마다 하나
    for (const [name, args] of [['list', {}], ['list', { json: true }], ['delete', { scenarios: ['a-01'] }], ['reindex', {}], ['detail', { id: 'a-01' }]] as const) {
      const out = await tool(name).run({ ...args })
      expect(out).toMatchObject({ isError: true })
      expect(out.text).toMatch(/^db-unavailable/)
    }
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/scenarios/a-01.md'))).toBe(true)
  })
})

describe('삭제', () => {
  async function setup() {
    await put('q-01.md', { title: '로그인', page: '/login' })
    await put('q-02.md', { title: '메뉴 목록', page: '/admin/menu' })
    await put('q-03.md', { title: '메뉴 저장 뒤 로그인', page: '/admin/menu', second: '/login' })
    const ws = open()
    await ws.space.reindex()
    return ws
  }

  it('화면 그룹 — 그 화면의 시나리오 전부(여러 화면에 걸친 것도) · md · 코드 · 기록 · 스크린샷', async () => {
    const { space, store } = await setup()
    const outcome = await space.run({})
    const shots = space.files.shotsDir(outcome.run.id)
    expect(existsSync(shots)).toBe(true)
    const removed = await space.remove({ screen: '/login' })
    expect(removed.scenarios).toHaveLength(2)
    expect(removed.scenarios).toContain('q-01')
    expect(removed.files.sort()).toEqual(['.litecode/plugins/ui-test/scenarios/q-01.md', '.litecode/plugins/ui-test/scenarios/q-01.spec.mjs', '.litecode/plugins/ui-test/scenarios/q-03.md', '.litecode/plugins/ui-test/scenarios/q-03.spec.mjs'])
    expect((await store.listScenarios()).map((item) => item.id)).toEqual(['q-02'])
    // 지운 시나리오의 결과서 폴더는 지워지고, 남은 시나리오 것은 그대로
    const reportDir = path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id)
    expect(existsSync(path.join(reportDir, 'q-01'))).toBe(false)
    expect(existsSync(path.join(reportDir, 'q-02', 'index.html'))).toBe(true)
    expect(existsSync(path.join(shots, 'c1-s1.jpg'))).toBe(false) // 지운 시나리오의 스크린샷
    expect(existsSync(path.join(shots, 'c2-s1.jpg'))).toBe(true)
    // 마지막 시나리오까지 지우면 수행이 통째로 사라진다
    await space.remove({ scenarios: ['q-02'] })
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id))).toBe(false)
    expect(existsSync(shots)).toBe(false)
    expect(await store.getRun(outcome.run.id)).toBeNull()
  })

  it('따로 낸 결과서는 그 시나리오 폴더만 지운다 · 요청 그룹 삭제 · 고르지 않으면 거절 · 수행 중이면 거절', async () => {
    const { space, store } = await setup()
    const outcome = await space.run({})
    await space.remove({ scenarios: ['q-01'] })
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, 'q-01'))).toBe(false)
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, 'q-02/index.html'))).toBe(true)
    await expect(space.remove({})).rejects.toThrow('지울 시나리오를 골라')
    await store.putRequest('rq', { text: '요청', at: 1, scenarios: ['q-02'] })
    await store.upsertScenario('q-02', { request: 'rq' })
    const running = await space.start({ scenarios: ['q-02'] })
    await expect(space.remove({ request: 'rq' })).rejects.toThrow('수행 중인 시나리오')
    await running.done
    expect((await space.remove({ request: 'rq' })).scenarios).toEqual(['q-02'])
    expect(await store.getRequest('rq')).toBeNull()
  })

  it('사용자가 파일을 직접 지우면 reindex 가 줄 · 기록 · 스크린샷 · 결과서 절을 같이 지운다', async () => {
    const { space, store } = await setup()
    const outcome = await space.run({})
    await fs.rm(path.join(root, '.litecode/plugins/ui-test/scenarios/q-02.md'))
    const result = await space.reindex()
    expect(result.removed).toBe(1)
    expect(await store.getScenario('q-02')).toBeNull()
    expect(await store.getResult('q-02', outcome.run.id)).toBeNull()
    expect(await fs.readFile(outcome.run.report, 'utf8')).not.toContain('id="s-q-02"')
    const doc = (await store.getRun(outcome.run.id))!
    expect(doc.scenarios).toContain('q-02') // 수행 기록은 남은 시나리오 몫으로 계속
    expect((await store.resultsOfRun(doc, outcome.run.id)).map((item) => item.scenario)).not.toContain('q-02')
  })
})

describe('reindex 와의 연동', () => {
  it('실행 시작 때 방금 쓴 파일을 읽고, DB 가 비어도 파일에서 목록 · 요청 태그가 돌아온다(수행 기록만 잃는다)', async () => {
    const first = open()
    await put('20261110T110500_01-01.md', { title: '새 시나리오', page: '/x', request: '새 요청', screens: '/x' })
    const outcome = await first.space.run({}) // reindex 를 따로 부르지 않았다
    expect(ids(outcome)).toEqual(['20261110T110500_01-01'])
    expect((await first.store.getRequest('20261110T110500_01'))).toMatchObject({ text: '새 요청', scenarios: ['20261110T110500_01-01'] })
    const fresh = open()
    expect(await fresh.store.listScenarios()).toEqual([])
    await fresh.space.reindex()
    const doc = (await fresh.store.getScenario('20261110T110500_01-01'))!
    expect(doc).toMatchObject({ title: '새 시나리오', request: '20261110T110500_01', screens: ['/x'], recent: [] })
    expect(doc.last).toBeUndefined()
    expect(await fresh.store.getRequest('20261110T110500_01')).toMatchObject({ text: '새 요청' })
  })
})

describe('도구 — 패널 · AI', () => {
  async function setup() {
    await put('q-01.md', { title: '로그인', page: '/login-ok', request: '로그인 화면', screens: '/login', names: '/login: 로그인 화면' })
    await put('q-02.md', { title: '메뉴', page: '/admin/menu/3', request: '로그인 화면' })
    const ws = open()
    const tools = createTools({ workspace: ws.space, checkDriver: () => driverFor('web', { channel: 'chrome' }), serverFile: '/p/ui-test.mjs' })
    const tool = (name: string) => tools.find((item) => item.name === name)!
    return { ...ws, tools, tool }
  }

  it('list JSON — 한 쪽(시나리오 · 상태 · 화면 · 요청 · 낡음) + 화면 · 요청 그룹 정보, 그룹의 마지막 결과서', async () => {
    const { space, tool } = await setup()
    await space.reindex()
    await space.run({ screen: '/login' })
    const json = JSON.parse((await tool('list').run({ json: true })).text)
    expect(json).toMatchObject({ scenarioDir: '.litecode/plugins/ui-test/scenarios', baseUrl: 'http://a', running: null })
    expect(json.cursor).toBeUndefined()
    const login = json.scenarios.find((item: { id: string }) => item.id === 'q-01')
    expect(login).toMatchObject({ title: '로그인', screens: ['/login'], status: 'passed', hasCode: true, stale: false, steps: 2, checks: 1, rows: 0, file: '.litecode/plugins/ui-test/scenarios/q-01.md' })
    expect(json.scenarios.find((item: { id: string }) => item.id === 'q-02')).toMatchObject({ status: null, lastRun: null })
    expect(json.screens).toEqual([{ route: '/login', name: '로그인 화면', lastRun: expect.objectContaining({ mode: 'each' }) }])
    expect(json.requests).toHaveLength(1)
    expect(json.requests[0]).toMatchObject({ text: '로그인 화면', count: 2, lastRun: null })
    // 쪽 읽기 — 선택자를 주면 걸러서
    expect(JSON.parse((await tool('list').run({ json: true, screen: '/admin/menu/:id' })).text).scenarios).toEqual([])
  })

  it('list JSON — 최근 수행의 결과서 · 가이드 유무(lastReport · lastGuide)를 알려 준다 — 패널이 놓친 수행의 가이드를 맞추는 데 쓴다', async () => {
    const { space, tool } = await setup()
    await space.reindex()
    await space.run({ screen: '/login' })
    const find = async () => JSON.parse((await tool('list').run({ json: true })).text).scenarios.find((item: { id: string }) => item.id === 'q-01')
    const row = await find()
    expect(row).toMatchObject({ lastReport: true, lastGuide: false }) // 결과서만 만들어진 수행
    const made = await tool('guide').run({ run: row.lastRun })
    expect(made.isError, made.text).toBeFalsy()
    expect(await find()).toMatchObject({ lastReport: true, lastGuide: true })
    expect(JSON.parse((await tool('list').run({ json: true })).text).scenarios.find((item: { id: string }) => item.id === 'q-02')).toMatchObject({ lastReport: false, lastGuide: false }) // 아직 안 돈 시나리오
  })

  it('list — _prompt.md 유무를 서버가 직접 알려 준다(JSON prompt · 글 머리) — 파일은 읽지 않는다', async () => {
    const { tool } = await setup()
    const file = '.litecode/plugins/ui-test/_prompt.md'
    expect(JSON.parse((await tool('list').run({ json: true })).text).prompt).toEqual({ file, exists: false })
    expect((await tool('list').run({})).text).toContain(`프로젝트 프롬프트: ${file} (없음)`)
    // 읽을 수 없는 파일(폴더)이어도 있다고만 본다 — 내용을 읽지 않는다는 뜻
    await fs.mkdir(path.join(root, file), { recursive: true })
    expect(JSON.parse((await tool('list').run({ json: true })).text).prompt).toEqual({ file, exists: true })
    await fs.rm(path.join(root, file), { recursive: true })
    await fs.writeFile(path.join(root, file), '# 프롬프트\n')
    expect(JSON.parse((await tool('list').run({ json: true })).text).prompt).toEqual({ file, exists: true })
    expect((await tool('list').run({})).text).toContain(`프로젝트 프롬프트: ${file} (있음)`)
  })

  it('list 글(AI) — 파일을 먼저 읽고, 시나리오 · 화면별 · 요청별', async () => {
    const { tool } = await setup()
    const text = (await tool('list').run({})).text
    expect(text).toContain('파일에서 다시 읽음: 새로 2')
    expect(text).toContain('- q-01: 로그인 · 화면 /login')
    expect(text).toContain('아직 실행 안 함')
    expect(text).toContain('화면별')
    expect(text).toContain('- /login (로그인 화면): 1개')
    expect(text).toContain('요청별')
    expect(text).toContain('AI 없이: node "/p/ui-test.mjs" run')
    expect((await tool('list').run({ failed: true })).text).toContain('조건에 맞는 시나리오가 없습니다')
  })

  it('detail JSON — 원문 · 단계 · 태그 · 최근 결과(수행 id · 결과서 · 가이드)', async () => {
    const { space, tool } = await setup()
    await space.reindex()
    const outcome = await space.run({ scenarios: ['q-01'] })
    await space.writeGuide(outcome.run.id)
    const json = JSON.parse((await tool('detail').run({ id: 'q-01' })).text)
    expect(json).toMatchObject({ id: 'q-01', title: '로그인', screens: ['/login'], status: 'passed', hasCode: true, stale: false, file: '.litecode/plugins/ui-test/scenarios/q-01.md', request: { text: '로그인 화면' } })
    expect(json.source).toContain('1. 연다')
    expect(json.steps).toEqual([{ no: 1, text: '연다', kind: 'action' }, { no: 2, text: '확인: 보인다', kind: 'check' }])
    expect(json.latest).toMatchObject({ run: outcome.run.id, status: 'passed', urls: ['/login-ok'] })
    expect(json.latest.steps[0].shot).toBe('c1-s1.jpg')
    expect(json.results).toEqual([{ run: outcome.run.id, at: expect.any(Number), status: 'passed', durationMs: expect.any(Number), failure: null, report: { file: `.litecode/plugins/ui-test/reports/${outcome.run.id}/q-01/index.html` }, guide: { file: `.litecode/plugins/ui-test/reports/${outcome.run.id}/q-01/guide.html` } }])
    expect(await tool('detail').run({ id: 'nope' })).toMatchObject({ isError: true })
  })

  it('run · report · guide · delete 도구 — 선택자 · 결과서 방식 · 스크린샷', async () => {
    const { space, tool } = await setup()
    const run = await tool('run').run({ screen: '/nope' })
    expect(run).toMatchObject({ isError: true })
    const out = await tool('run').run({ scenarios: ['q-01', 'q-02'] })
    expect(out.text).toMatch(/^실행 끝 — 시나리오 2개 .* 수행 id \d{8}T\d{6}_\d{2}/)
    expect(out.text).toContain('결과서(시나리오마다 따로): .litecode/plugins/ui-test/reports/')
    expect(out.text).toContain('본 화면: /login-ok')
    const runId = /수행 id (\S+)/.exec(out.text)![1]!
    const again = await tool('report').run({ run: runId })
    expect(again.text).toContain('실행 끝')
    expect((await tool('report').run({ scenario: 'q-02' })).text).toContain('q-02 의 최근 결과 (1)')
    expect((await tool('report').run({})).isError).toBe(true)
    expect((await tool('guide').run({ run: runId, json: true })).text).toBe(JSON.stringify({ files: [`.litecode/plugins/ui-test/reports/${runId}/q-01/guide.html`, `.litecode/plugins/ui-test/reports/${runId}/q-02/guide.html`] }))
    const shot = await tool('shot').run({ run: runId, name: 'c1-s1.jpg' })
    expect(shot.text).toMatch(/^data:image\/jpeg;base64,/)
    expect(await tool('shot').run({ run: '../x', name: 'c1-s1.jpg' })).toMatchObject({ isError: true })
    expect(await tool('shot').run({ run: runId, name: '../../x.jpg' })).toMatchObject({ isError: true })
    expect(JSON.parse((await tool('delete').run({ scenarios: ['q-02'] })).text)).toMatchObject({ scenarios: ['q-02'], files: ['.litecode/plugins/ui-test/scenarios/q-02.md', '.litecode/plugins/ui-test/scenarios/q-02.spec.mjs'], runs: 0 })
    expect(JSON.parse((await tool('reindex').run({})).text)).toEqual({ added: 0, updated: 0, removed: 0 })
  })

  it('newRequest — 요청 id · 파일 이름 · 머리 줄, 따옴표는 작은따옴표로 · 같은 id 의 파일이 있으면 번호를 올린다', async () => {
    const { tool } = await setup()
    const text = (await tool('newRequest').run({ text: '메뉴 "관리" 화면\n진행해줘 #12' })).text
    const id = /요청 id: (\S+)/.exec(text)![1]!
    expect(id).toMatch(/^\d{8}T\d{6}_01$/)
    expect(text).toContain(`${id}-01.md`)
    expect(text).toContain(`request: "메뉴 '관리' 화면 진행해줘 #12"`)
    expect(text).toMatch(/requested: \d{4}-\d{2}-\d{2}T/)
    await fs.writeFile(path.join(root, '.litecode/plugins/ui-test/scenarios', `${id}-01.md`), '1. x\n')
    expect((await tool('newRequest').run({ text: '다시' })).text).not.toContain(`요청 id: ${id}\n`)
    expect(await tool('newRequest').run({ text: '  ' })).toMatchObject({ isError: true })
  })

  it('패널 전용 도구 목록이 서비스가 올리는 panelTools 와 같고, 모든 도구가 이름 목록에 있다', async () => {
    const { tools } = await setup()
    expect(PANEL_TOOLS.every((name) => tools.some((tool) => tool.name === name))).toBe(true)
    const aiTools = tools.map((tool) => tool.name).filter((name) => !PANEL_TOOLS.includes(name))
    expect(aiTools).toEqual(['list', 'run', 'report', 'guide', 'newRequest', 'fingerprint', 'check'])
  })
})

describe('쓰는 위치 — 프로젝트 .litecode/plugins/ui-test/ 안', () => {
  it('결과서는 reports/<수행 id>/ 에, 옛 testDir 환경값은 무시한다', async () => {
    await put('a-01.md', { title: '로그인', page: '/login' })
    const { space } = open()
    await space.reindex()
    const outcome = await space.run({})
    expect(outcome.run.report).toBe(path.join(root, '.litecode/plugins/ui-test/reports', outcome.run.id, 'a-01', 'index.html'))
    expect(existsSync(outcome.run.report)).toBe(true)
  })

  it('reports 가 밖을 가리키는 심볼릭 링크면 결과서를 쓰지 않고 정리로 밖을 지우지도 않는다', async () => {
    await put('a-01.md', { title: '로그인', page: '/login' })
    const outside = path.join(dir, 'outside')
    await fs.mkdir(path.join(outside, '20261110T000000_01'), { recursive: true })
    await fs.writeFile(path.join(outside, '20261110T000000_01', 'keep.txt'), 'x')
    await fs.symlink(outside, path.join(root, '.litecode/plugins/ui-test/reports'))
    const { space } = open()
    await space.reindex()
    await expect(space.run({})).rejects.toThrow('플러그인 폴더')
    expect(await fs.readdir(outside)).toEqual(['20261110T000000_01'])
    await space.cleanup({ results: [], runs: ['20261110T000000_01'] })
    expect(existsSync(path.join(outside, '20261110T000000_01', 'keep.txt'))).toBe(true)
  })
})
