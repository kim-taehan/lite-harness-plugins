// 빛톨 서비스 · 게임 규칙 · 페르소나 — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 패널이 service.call 로 묻는 것, AI 가 도구를 부르는 것은 앱에서 확인한다(여기서 못 본다).
import { readFileSync } from 'node:fs'
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
type State = { v: 1; baseline: { tokens: number; cacheRead: number } | null; feed: number; species: string | null; nature: string | null; seen: string[]; graduated: { id: string; nature?: string | null }[]; mate: string | null; names: Record<string, string>; news: string[]; startedAt: number; bg?: string }
type Game = {
  HATCH: number
  BASE: number[]
  fresh: () => State
  ends: (id: string) => number[]
  SPECIES: string[]
  pickSpecies: (rnd?: () => number, graduated?: { id: string }[]) => string
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

  it('부화는 모든 종이 같은 확률이다', () => {
    const n = G.SPECIES.length
    const got = G.SPECIES.map((_, i) => G.pickSpecies(() => (i + 0.5) / n))
    expect(got).toEqual(G.SPECIES)
  })

  it('아직 졸업 못 한 종이 남아 있으면 그 안에서만 나오고, 다 졸업하면 전체에서 나온다', () => {
    const [first, ...rest] = G.SPECIES as [string, ...string[]]
    const last = rest.at(-1)!
    // 하나만 남았으면 무슨 수가 나와도 그 종
    for (const r of [0, 0.4, 0.99]) expect(G.pickSpecies(() => r, rest.slice(0, -1).concat(first).map((id) => ({ id })))).toBe(last)
    // 졸업한 종은 나오지 않는다
    for (let i = 0; i < 20; i++) expect(G.pickSpecies(() => i / 20, [{ id: first }])).not.toBe(first)
    // 다 졸업하면 전체에서 — 첫 수(0)는 첫 종
    expect(G.pickSpecies(() => 0, G.SPECIES.map((id) => ({ id })))).toBe(first)
  })

  it('필요한 먹이는 모든 종이 같다', () => {
    for (const id of G.SPECIES) expect(G.ends(id)).toEqual(G.BASE)
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
    expect(fake.names().sort()).toEqual(['fullscreen', 'seenDex', 'setBg', 'setMate', 'setName', 'state', 'talk'])
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

  it('스킬(token-pet)을 서비스가 올린다 — manifest skills 선언 없이', async () => {
    const { fake } = await start()
    expect(fake.skills()).toEqual([{ name: 'token-pet', path: 'skills/token-pet/SKILL.md' }])
    const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.skills).toBeUndefined()
    expect(readFileSync(path.join(here, 'skills/token-pet/SKILL.md'), 'utf8')).toMatch(/^name: token-pet$/m)
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

  it('처음 졸업한 종은 도감에 "새로 만남" 으로 남고, 상세를 열어 보면(seenDex) 지워진다', async () => {
    const saved = { ...G.fresh(), species: 'sheep', nature: '차분한', feed: G.HATCH + G.BASE[2]! - 1, baseline: total(0) }
    const { fake, snapshot, eat, store } = await start({ saved, usage: total(0) })
    await eat(1)
    const { state } = await snapshot()
    expect(state.graduated.map((g) => g.id)).toEqual(['sheep'])
    expect(state.news).toEqual(['sheep'])
    await fake.call('seenDex', { id: 'sheep' })
    expect((store.get('state') as State).news).toEqual([])
  })

  it('setMate — 졸업한 친구만 무대에 부르고(한 마리, 교체), null 이면 집으로', async () => {
    const saved = { ...G.fresh(), graduated: [{ id: 'sheep', nature: '느긋한' }, { id: 'turtle', nature: '차분한' }] }
    const { fake, store } = await start({ saved })
    await expect(fake.call('setMate', { id: 'squirrel' })).rejects.toThrow()
    await fake.call('setMate', { id: 'sheep' })
    await fake.call('setMate', { id: 'turtle' })
    expect((store.get('state') as State).mate).toBe('turtle')
    await fake.call('setMate', { id: null })
    expect((store.get('state') as State).mate).toBeNull()
  })

  it('setName — 종마다 하나, 졸업한 종만, 글자 수 제한, 빈 글이면 지운다', async () => {
    const saved = { ...G.fresh(), graduated: [{ id: 'sheep', nature: '느긋한' }] }
    const { fake, store } = await start({ saved })
    await fake.call('setName', { id: 'sheep', name: '  몽실  ' })
    expect((store.get('state') as State).names).toEqual({ sheep: '몽실' })
    await expect(fake.call('setName', { id: 'sheep', name: '열한글자짜리이름입니다요요' })).rejects.toThrow()
    await expect(fake.call('setName', { id: 'turtle', name: '거북' })).rejects.toThrow()
    await fake.call('setName', { id: 'sheep', name: '   ' })
    expect((store.get('state') as State).names).toEqual({})
  })

  it('불러온 친구가 무대에 있으면 persona · say 는 그 친구(3단계 · 지은 이름 · 마지막 졸업 성격)로 한다', async () => {
    const saved = { ...G.fresh(), species: 'squirrel', nature: '급한', feed: G.HATCH + 5, baseline: total(0), graduated: [{ id: 'turtle', nature: '느긋한' }], mate: 'turtle', names: { turtle: '둥실' } }
    const { fake, snapshot } = await start({ saved })
    const info = JSON.parse(await fake.callTool('token-pet_persona', {}, { directory: '/work/a' }))
    expect(info).toMatchObject({ name: '둥실', species: 'turtle', stage: 3, nature: '느긋한', raising: '찌릿다람' })
    expect(info.voice).toContain('충청도')
    await fake.callTool('token-pet_say', { text: '천천히 해유' }, { directory: '/work/a' })
    expect((await snapshot()).said).toMatchObject({ by: { species: 'turtle', stage: 2, name: '둥실' } })
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
