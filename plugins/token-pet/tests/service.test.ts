// 빛톨 서비스 · 게임 규칙 · 페르소나 — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 패널이 service.call 로 묻는 것, AI 가 도구를 부르는 것은 앱에서 확인한다(여기서 못 본다).
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')

type Persona = {
  ACTIONS: string[]
  react: (species: string | null, stage: number, nature: string | null, avoid?: string, rnd?: () => number) => { text: string; action: string }
  voice: (species: string | null, stage: number, nature: string | null) => { voice: string; actions: string[]; rules: string[] }
}
type State = { v: 1; baseline: { tokens: number; cacheRead: number } | null; feed: number; species: string | null; nature: string | null; seen: string[]; graduated: { id: string }[]; startedAt: number; bg?: string }
type Game = {
  HATCH: number
  BASE: number[]
  fresh: () => State
  ends: (id: string) => number[]
  stageOf: (s: State) => { stage: number; from: number; to: number }
  feed: (s: State, amount: number, rnd?: () => number) => string | null
  applyUsage: (s: State, total: { tokens: number; cacheRead: number }, rnd?: () => number) => string | null
}
let P: Persona
let G: Game
let bundle: (host: unknown) => never
beforeAll(async () => {
  await import(path.join(here, 'persona.js'))
  await import(path.join(here, 'game.js'))
  P = (globalThis as unknown as { TOKEN_PET_PERSONA: Persona }).TOKEN_PET_PERSONA
  G = (globalThis as unknown as { TOKEN_PET_GAME: Game }).TOKEN_PET_GAME
  // 서비스는 묶어서 시험한다 — zip 에 들어가는 service.mjs 와 같은 묶음(game.js · persona.js 째 한 파일)
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const text = out.outputFiles[0]!.text
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).default
})

const total = (tokens: number, cacheRead = 0) => ({ tokens, cacheRead })
const summary = (tokens: number, cacheRead = 0) => ({ total: total(tokens, cacheRead), today: { tokens: 123, turns: 4 } })

/** 가짜 host 에 서비스를 올린다 — storage 와 사용량은 바꿀 수 있는 값으로 흉내 낸다 */
async function start(options: { usage?: { tokens: number; cacheRead: number }; saved?: unknown } = {}) {
  const store = new Map<string, unknown>()
  if (options.saved) store.set('state', options.saved)
  let usage = options.usage ?? total(0)
  const fake = createFakeHost({
    id: 'token-pet',
    scope: 'app',
    events: ['usage.changed'],
    calls: {
      'storage.get': (params) => store.get((params as { key: string }).key) ?? null,
      'storage.set': (params) => void store.set((params as { key: string }).key, (params as { value: unknown }).value),
      'usage.summary': () => summary(usage.tokens, usage.cacheRead),
    },
  })
  fake.mount(bundle)
  const snapshot = async () => (await fake.call('state')) as { state: State; today: { tokens: number; turns: number } | null; error: string | null; said: { text: string; action?: string } | null }
  await snapshot() // 첫 읽기가 끝날 때까지
  const eat = async (tokens: number) => {
    usage = total(usage.tokens + tokens, usage.cacheRead)
    await fake.emit('usage.changed')
    await snapshot()
  }
  return { fake, store, snapshot, eat }
}

describe('game.js', () => {
  it('처음 장부는 기준만 잡고 먹이로 치지 않는다', () => {
    const state = G.fresh()
    expect(G.applyUsage(state, total(5_000_000))).toBeNull()
    expect(state.feed).toBe(0)
    expect(state.baseline).toEqual(total(5_000_000))
  })

  it('늘어난 토큰이 먹이다 — 캐시로 읽은 것은 반만 친다', () => {
    const state = G.fresh()
    G.applyUsage(state, total(1_000, 0))
    expect(G.applyUsage(state, total(3_000, 1_000))).toBe('eat')
    expect(state.feed).toBe(1_500) // (3000-1000) - 1000/2
  })

  it('장부가 줄면(새로 시작) 기준을 다시 잡는다', () => {
    const state = G.fresh()
    G.applyUsage(state, total(9_000))
    G.applyUsage(state, total(100))
    expect(state.baseline).toEqual(total(100))
    expect(state.feed).toBe(0)
  })

  it('부화 · 진화 · 졸업 순서로 일어난다', () => {
    const rnd = () => 0 // 첫 종(번개 다람쥐) · 첫 성격
    const state = G.fresh()
    expect(G.feed(state, G.HATCH, rnd)).toBe('hatch')
    expect(state.species).toBe('squirrel')
    expect(G.stageOf(state).stage).toBe(0)
    const [first, , last] = G.ends('squirrel') as [number, number, number]
    expect(G.feed(state, first, rnd)).toBe('evolve')
    expect(G.stageOf(state).stage).toBe(1)
    expect(G.feed(state, last, rnd)).toBe('graduate')
    expect(state.species).toBeNull()
    expect(state.feed).toBe(0)
    expect(state.graduated).toHaveLength(1)
    expect(state.seen).toEqual(['squirrel:0', 'squirrel:1', 'squirrel:2'])
  })
})

describe('service', () => {
  it('usage.changed 만 구독하고 패널이 부를 메서드와 AI 도구 둘을 올린다', async () => {
    const { fake } = await start()
    expect(fake.names().sort()).toEqual(['fullscreen', 'setBg', 'state', 'talk'])
    expect(fake.tools().map((t) => t.name).sort()).toEqual(['token-pet_persona', 'token-pet_say'])
  })

  it('사용량이 늘면 먹이를 주고 저장하고 패널에 밀어 보낸다 — 패널이 닫혀 있어도', async () => {
    const { fake, store, snapshot, eat } = await start({ usage: total(1_000) })
    await eat(G.HATCH)
    const { state } = await snapshot()
    expect(state.feed).toBeGreaterThanOrEqual(G.HATCH)
    expect(state.species).not.toBeNull()
    expect((store.get('state') as State).feed).toBe(state.feed)
    const pushes = fake.pushes().filter((p) => p.event === 'service.update')
    expect((pushes.at(-1)?.data as { event?: string }).event).toBe('hatch')
  })

  it('키우던 빛톨(storage state)을 이어받는다', async () => {
    const saved = { ...G.fresh(), species: 'sheep', nature: '차분한', feed: G.HATCH + 5, baseline: total(10) }
    const { snapshot } = await start({ saved, usage: total(10) })
    expect((await snapshot()).state).toMatchObject({ species: 'sheep', nature: '차분한' })
  })

  it('0.1.1 에서 부화한 성격 없는 빛톨은 성격을 하나 정해 남긴다', async () => {
    const saved = { ...G.fresh(), species: 'turtle', feed: G.HATCH + 5, baseline: total(10) }
    const { snapshot, store } = await start({ saved, usage: total(10) })
    expect((await snapshot()).state.nature).not.toBeNull()
    expect((store.get('state') as State).nature).not.toBeNull()
  })

  it('사용량을 못 읽으면 error 로 알리고 서비스는 계속 돈다', async () => {
    const fake = createFakeHost({ id: 'token-pet', scope: 'app', events: ['usage.changed'], calls: { 'storage.get': () => null, 'usage.summary': () => { throw Object.assign(new Error('x'), { code: 'permission-missing' }) } } })
    fake.mount(bundle)
    const snap = (await fake.call('state')) as { error: string | null }
    expect(snap.error).toBe('permission-missing')
  })

  it('setBg 는 배경을 저장하고 모르는 모양은 거절한다', async () => {
    const { fake, store } = await start()
    await fake.call('setBg', { bg: 'night' })
    expect((store.get('state') as State).bg).toBe('night')
    await expect(fake.call('setBg', { bg: 1 })).rejects.toThrow()
  })

  it('talk 는 "빛톨아, " 를 채워 새 대화를 연다 (보내지 않는다)', async () => {
    const { fake } = await start()
    const calls = createFakeHost({ id: 'token-pet', scope: 'app', events: ['usage.changed'], calls: { 'chat.compose': () => true, 'storage.get': () => null, 'usage.summary': () => summary(0) } })
    calls.mount(bundle)
    await calls.call('talk', undefined, { directory: '/work/a' })
    expect(calls.calls.find((c) => c.method === 'chat.compose')).toMatchObject({ params: { text: '빛톨아, ', send: false }, directory: '/work/a' })
    expect(fake.names()).toContain('talk')
  })

  it('fullscreen 은 패널 전체 화면을 서비스가 연다', async () => {
    const fake = createFakeHost({ id: 'token-pet', scope: 'app', events: ['usage.changed'], calls: { 'panel.fullscreen': () => true, 'storage.get': () => null, 'usage.summary': () => summary(0) } })
    fake.mount(bundle)
    await fake.call('fullscreen', { on: true }, { directory: '/work/a' })
    await fake.call('fullscreen', { on: 'yes' }, { directory: '/work/a' })
    expect(fake.calls.filter((c) => c.method === 'panel.fullscreen').map((c) => c.params)).toEqual([{ on: true }, { on: false }])
  })

  it('persona 는 지금 빛톨을 알려 준다 — 양은 "매에~", 거북은 충청도', async () => {
    const sheep = await start({ saved: { ...G.fresh(), species: 'sheep', nature: '차분한', feed: G.HATCH + 5, baseline: total(0) } })
    const info = JSON.parse(await sheep.fake.callTool('token-pet_persona', {}, { directory: '/work/a' }))
    expect(info).toMatchObject({ name: '김양', species: 'sheep', stage: 1, nature: '차분한', todayTokens: 123, mood: '배고픔' })
    expect(info.voice).toContain('매에~')
    const turtle = await start({ saved: { ...G.fresh(), species: 'turtle', nature: '느긋한', feed: G.HATCH + 5, baseline: total(0) } })
    expect(JSON.parse(await turtle.fake.callTool('token-pet_persona', {}, { directory: '/work/a' })).voice).toContain('충청도')
  })

  it('알이면 이름이 빛알, 단계 0', async () => {
    const { fake } = await start()
    expect(JSON.parse(await fake.callTool('token-pet_persona', {}, { directory: '/work/a' }))).toMatchObject({ name: '빛알', species: null, stage: 0 })
  })

  it('say 는 말을 패널에 밀어 보낸다', async () => {
    const { fake, snapshot } = await start()
    await fake.callTool('token-pet_say', { text: '안녕, 찌릿!', action: 'zap' }, { directory: '/work/a' })
    const last = fake.pushes().at(-1)
    expect(last?.event).toBe('service.update')
    expect((last?.data as { said: { text: string; action: string } }).said).toMatchObject({ text: '안녕, 찌릿!', action: 'zap' })
    expect((await snapshot()).said?.text).toBe('안녕, 찌릿!')
  })

  it('say 는 모르는 action · 빈 글 · 너무 긴 글을 거절한다', async () => {
    const { fake } = await start()
    await expect(fake.callTool('token-pet_say', { text: 'hi', action: 'fly' }, { directory: '/work/a' })).rejects.toThrow()
    await expect(fake.callTool('token-pet_say', { text: '   ' }, { directory: '/work/a' })).rejects.toThrow()
    await expect(fake.callTool('token-pet_say', { text: 'x'.repeat(201) }, { directory: '/work/a' })).rejects.toThrow()
  })

  it('내리면 도구와 소식 구독이 걷힌다', async () => {
    const { fake } = await start()
    await fake.dispose()
    expect(fake.tools()).toEqual([])
  })
})

describe('persona.js', () => {
  it('구름 양은 어떤 성격이든 늘 "매에~" 로 끝난다', () => {
    for (const nature of ['급한', '차분한', '느긋한', '호기심 많은', '수줍은'])
      for (let stage = 0; stage < 3; stage++)
        for (let i = 0; i < 20; i++) expect(P.react('sheep', stage, nature).text.endsWith('매에~')).toBe(true)
  })

  it('바로 전에 한 말은 다시 고르지 않는다', () => {
    let last = ''
    for (let i = 0; i < 200; i++) {
      const { text } = P.react('squirrel', 0, '차분한', last)
      expect(text).not.toBe(last)
      last = text
    }
  })

  it('호기심 많은 성격의 되묻는 말은 종의 말투를 따른다 — 거북은 충청도, 양은 끝이 "매에~"', () => {
    for (let i = 0; i < 40; i++) {
      const turtle = P.react('turtle', 1, '호기심 많은').text
      expect(turtle).not.toContain('그건 뭐야?')
      const sheep = P.react('sheep', 0, '호기심 많은').text
      expect(sheep.endsWith('매에~')).toBe(true)
    }
    expect(Array.from({ length: 40 }, () => P.react('turtle', 1, '호기심 많은').text).some((t) => t.includes('그건 뭐여?'))).toBe(true)
  })

  it('행동은 정해 둔 것 중 하나, 알은 소리만', () => {
    for (let i = 0; i < 50; i++) expect(P.ACTIONS).toContain(P.react('turtle', 2, '수줍은').action)
    expect(P.voice(null, 0, null).voice).toContain('말을 못 한다')
  })
})
