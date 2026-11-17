// 리센느 키우기 서비스 · 게임 규칙 — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 패널이 service.call 로 묻는 것, AI 가 도구를 부르는 것은 앱에서 확인한다(여기서 못 본다).
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')

type State = {
  v: 2
  baseline: { tokens: number; cacheRead: number } | null
  active: string | null
  progress: Record<string, { feed: number }>
  graduated: { id: string; at: number }[]
  news: string[]
  startedAt: number
}
type Event = { type: string; id: string; unlocked?: string | null }
type Roster = { memberId: string; name: string; soon?: boolean; current: string | null; active: boolean; finished: boolean; characters: { id: string; name: string; stage: number | null; feed: number; graduated: boolean; locked: boolean; isNew: boolean }[] }[]
type Game = {
  ENDS: number[]
  MEMBERS: Record<string, { name: string; soon?: boolean; characters: string[] }>
  CHARACTERS: Record<string, { member: string; name: string; soon?: boolean }>
  fresh: () => State
  migrate: (saved: unknown) => State
  currentOf: (s: State, member: string) => string
  activeCharacter: (s: State) => string | null
  stageOf: (s: State, id?: string | null) => { stage: number; from: number; to: number }
  feed: (s: State, amount: number) => Event | null
  applyUsage: (s: State, total: { tokens: number; cacheRead: number }) => Event | null
  select: (s: State, member: string) => void
  deselect: (s: State) => void
  roster: (s: State) => Roster
  MEMBER_IDS: string[]
}
let G: Game
let bundle: (host: unknown) => never

beforeAll(async () => {
  await import(path.join(here, 'game.js'))
  G = (globalThis as unknown as { RISENE_PET_GAME: Game }).RISENE_PET_GAME
  // 서비스는 묶어서 시험한다 — zip 에 들어가는 service.mjs 와 같은 묶음(game.js · persona.js 째)
  const out = await build({
    entryPoints: [path.join(here, 'service/index.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
})

const total = (tokens: number, cacheRead = 0) => ({ tokens, cacheRead })
const summary = (tokens: number, cacheRead = 0) => ({ total: total(tokens, cacheRead), today: { tokens: 123, turns: 4 } })
/** 멤버를 고른 상태 — progress 는 캐릭터별 먹이, graduated 는 졸업한 캐릭터 id */
const grown = (active: string | null, progress: Record<string, number> = {}, graduated: string[] = []): State => ({
  ...G.fresh(),
  active,
  baseline: total(0),
  progress: Object.fromEntries(Object.entries(progress).map(([id, feed]) => [id, { feed }])),
  graduated: graduated.map((id) => ({ id, at: 1 })),
})

/** 가짜 host 에 서비스를 올린다 — storage 와 사용량은 바꿀 수 있는 값으로 흉내 낸다 */
async function start(options: { usage?: { tokens: number; cacheRead: number }; saved?: unknown } = {}) {
  const store = new Map<string, unknown>()
  if (options.saved) store.set('state', options.saved)
  let usage = options.usage ?? total(0)
  const fake = createFakeHost({
    id: 'risene-pet',
    scope: 'app',
    events: ['usage.changed'],
    calls: {
      'storage.get': (params) => store.get((params as { key: string }).key) ?? null,
      'storage.set': (params) => void store.set((params as { key: string }).key, (params as { value: unknown }).value),
      'usage.summary': () => summary(usage.tokens, usage.cacheRead),
      'chat.compose': () => true,
    },
  })
  fake.mount(bundle)
  const snapshot = async () => (await fake.call('state')) as { state: State; today: { tokens: number; turns: number } | null; error: string | null; said: { text: string; action?: string; by: { id: string; name: string } } | null }
  await snapshot() // 첫 읽기가 끝날 때까지
  const eat = async (tokens: number) => {
    usage = total(usage.tokens + tokens, usage.cacheRead)
    await fake.emit('usage.changed')
    await snapshot()
  }
  const saved = () => store.get('state') as State
  const lastPush = () => fake.pushes().filter((p) => p.event === 'service.update').at(-1)?.data as { state: State; event?: string; id?: string; unlocked?: string | null }
  return { fake, store, snapshot, eat, saved, lastPush }
}

const E0 = 1_650_000
/** 멤버 하나를 임시로 준비중(soon)으로 돌려 놓고 fn 을 돌린 뒤 되돌린다 */
const withSoon = (member: string, fn: () => void) => {
  const m = G.MEMBERS[member]!
  const before = [m.soon, ...m.characters.map((id) => G.CHARACTERS[id]!.soon)]
  m.soon = true
  for (const id of m.characters) G.CHARACTERS[id]!.soon = true
  try {
    fn()
  } finally {
    m.soon = before[0]
    m.characters.forEach((id, i) => (G.CHARACTERS[id]!.soon = before[i + 1]))
  }
}
const mayRow = (state: State) => G.roster(state).find((m) => m.memberId === 'may')!
const woniRow = (state: State) => G.roster(state).find((m) => m.memberId === 'woni')!
const ENDS_LAST = 16_500_000

describe('game.js', () => {
  it('캐릭터는 두 표(MEMBERS · CHARACTERS)에서만 나오고 서로 맞는다 — 키울 수 있는 멤버는 원이 · 메이, 미나미 · 리브 · 제나는 준비중', () => {
    expect(G.ENDS).toEqual([E0, 6_650_000, ENDS_LAST])
    expect(Object.fromEntries(Object.entries(G.MEMBERS).map(([id, m]) => [id, m.characters]))).toEqual({ woni: ['woni-a', 'woni-b'], may: ['met', 'mei'], minami: ['minami-gyaru'], liv: ['liv-1'], zena: ['zena-1'] })
    expect(Object.keys(G.MEMBERS)).toEqual(['woni', 'may', 'minami', 'liv', 'zena']) // 키울 수 있는 멤버가 먼저, 준비중은 뒤에
    for (const [member, { characters }] of Object.entries(G.MEMBERS)) for (const id of characters) expect(G.CHARACTERS[id]!.member).toBe(member)
    expect(Object.entries(G.CHARACTERS).filter(([, c]) => c.soon).map(([id]) => id)).toEqual(['minami-gyaru', 'liv-1', 'zena-1'])
    for (const id of ['minami', 'liv', 'zena']) expect(G.MEMBERS[id]!.soon).toBe(true)
    expect(G.CHARACTERS['liv-1']!.name).toBe('리트')
    expect(G.CHARACTERS['zena-1']!.name).toBe('신라공주')
    expect(G.MEMBERS.may!.soon).toBeUndefined()
    expect(G.MEMBERS.woni!.soon).toBeUndefined()
    expect(G.MEMBER_IDS).toEqual(['woni', 'may'])
  })

  it('say 글자 수 상한은 멤버별이다 — 원이 40, 메이 700', () => {
    expect(G.MEMBERS.woni!.sayMax).toBe(40)
    expect(G.MEMBERS.may!.sayMax).toBe(700)
    expect(G.sayMaxOf(grown('woni'))).toBe(40)
    expect(G.sayMaxOf(grown('may'))).toBe(700)
    expect(G.sayMaxAll()).toBe(700)
  })

  it('키울 수 있는 멤버가 한 명뿐이면(나머지가 준비중이면) 처음부터 그 멤버가 골라져 있어 먹이를 바로 받는다', () => {
    withSoon('may', () => {
      const state = G.fresh()
      expect(state.active).toBe('woni')
      G.applyUsage(state, total(0))
      expect(G.applyUsage(state, total(1_000))).toEqual({ type: 'eat', id: 'woni-a' })
      expect(state.progress).toEqual({ 'woni-a': { feed: 1_000 } })
    })
  })

  it('키울 수 있는 멤버가 둘(원이 · 메이)이면 처음엔 고른 멤버가 없고 먹이는 어디에도 가지 않는다', () => {
    const state = G.fresh()
    expect(state.active).toBeNull()
    G.applyUsage(state, total(0))
    expect(G.applyUsage(state, total(5_000_000))).toBeNull()
    expect(state.progress).toEqual({})
    expect(G.migrate({ v: 1, stage: null }).active).toBeNull() // 옛 형식도 고를 멤버가 둘이면 비워 둔다
  })

  it('처음 장부는 기준만 잡고, 늘어난 토큰이 먹이다 — 캐시로 읽은 것은 반만 친다', () => {
    const state = G.fresh()
    G.select(state, 'woni')
    expect(G.applyUsage(state, total(5_000_000))).toBeNull()
    expect(G.applyUsage(state, total(5_003_000, 1_000))).toEqual({ type: 'eat', id: 'woni-a' })
    expect(state.progress['woni-a']!.feed).toBe(2_500) // 3000 - 1000/2
  })

  it('장부가 줄면(새로 시작) 기준을 다시 잡는다', () => {
    const state = G.fresh()
    G.select(state, 'woni')
    G.applyUsage(state, total(9_000))
    G.applyUsage(state, total(100))
    expect(state.baseline).toEqual(total(100))
    expect(state.progress).toEqual({})
  })

  it('멤버를 고르면 먹이를 받고, 이미 고른 멤버를 또 골라도 그대로이며, 해제하면 먹이가 사라진다', () => {
    const state = grown('woni', { 'woni-a': 50 })
    G.feed(state, 7)
    G.select(state, 'woni')
    expect(state.progress).toEqual({ 'woni-a': { feed: 57 } })
    G.deselect(state)
    expect(state.active).toBeNull()
    expect(G.feed(state, 500)).toBeNull()
    expect(state.progress).toEqual({ 'woni-a': { feed: 57 } })
  })

  it('select 는 모르는 멤버 · 준비중 멤버를 거절한다 (캐릭터 id 도 멤버가 아니다)', () => {
    const state = grown(null)
    for (const id of ['egg', 'woni-a', 'minami']) expect(() => G.select(state, id)).toThrow()
    expect(state.active).toBeNull()
  })

  it('진화 · 졸업 순서로 일어나고, 졸업하면 다음 캐릭터(파이리원이)가 열려 현재 캐릭터가 된다', () => {
    const state = grown('woni')
    expect(G.stageOf(state).stage).toBe(0)
    expect(G.feed(state, 1_000)).toEqual({ type: 'eat', id: 'woni-a' })
    expect(G.feed(state, E0)).toEqual({ type: 'evolve', id: 'woni-a' })
    expect(G.stageOf(state).stage).toBe(1)
    expect(G.feed(state, 6_650_000 - E0)).toEqual({ type: 'evolve', id: 'woni-a' })
    expect(G.stageOf(state).stage).toBe(2)
    expect(G.feed(state, ENDS_LAST)).toEqual({ type: 'graduate', id: 'woni-a', unlocked: 'woni-b' })
    expect(state.progress['woni-a']!.feed).toBe(ENDS_LAST)
    expect(state.news).toEqual(['woni-a', 'woni-b'])
    expect(G.currentOf(state, 'woni')).toBe('woni-b')
    expect(G.activeCharacter(state)).toBe('woni-b')
    expect(G.feed(state, 100)).toEqual({ type: 'eat', id: 'woni-b' })
  })

  it('메이는 선택해서 키울 수 있다 — 매트가 먼저, 졸업하면 디렉터가 열린다 (다른 멤버는 멈춘다)', () => {
    const state = grown('woni', { 'woni-a': 10 })
    G.select(state, 'may')
    expect(G.activeCharacter(state)).toBe('met')
    expect(G.feed(state, 100)).toEqual({ type: 'eat', id: 'met' })
    expect(state.progress).toEqual({ 'woni-a': { feed: 10 }, met: { feed: 100 } })
    expect(G.feed(state, ENDS_LAST)).toEqual({ type: 'graduate', id: 'met', unlocked: 'mei' })
    expect(state.news).toEqual(['met', 'mei'])
    expect(G.activeCharacter(state)).toBe('mei')
    expect(G.feed(state, 5)).toEqual({ type: 'eat', id: 'mei' })
    expect(mayRow(state)).toMatchObject({ current: 'mei', active: true, finished: false })
    expect(mayRow(state).characters).toMatchObject([{ id: 'met', graduated: true, stage: 2 }, { id: 'mei', graduated: false, stage: 0, locked: false }])
  })

  it('마지막 캐릭터까지 졸업하면 완주 — 먹이를 받지 않고 마지막 캐릭터가 현재로 남는다', () => {
    const state = grown('woni', { 'woni-a': ENDS_LAST, 'woni-b': ENDS_LAST - 1 }, ['woni-a'])
    expect(G.feed(state, 5)).toEqual({ type: 'graduate', id: 'woni-b', unlocked: null })
    expect(G.currentOf(state, 'woni')).toBe('woni-b')
    expect(G.feed(state, 1_000_000)).toBeNull()
    expect(state.progress['woni-b']!.feed).toBe(ENDS_LAST)
    expect(state.graduated).toHaveLength(2)
    expect(woniRow(state)).toMatchObject({ memberId: 'woni', finished: true, current: 'woni-b' })
  })

  it('목록에 캐릭터를 더하면 완주했던 멤버가 다시 자란다', () => {
    const state = grown('woni', { 'woni-a': ENDS_LAST, 'woni-b': ENDS_LAST }, ['woni-a', 'woni-b'])
    expect(G.feed(state, 100)).toBeNull()
    G.MEMBERS.woni!.characters.push('extra')
    G.CHARACTERS.extra = { member: 'woni', name: '추가' }
    try {
      expect(G.currentOf(state, 'woni')).toBe('extra')
      expect(woniRow(state)).toMatchObject({ finished: false, current: 'extra' })
      expect(G.feed(state, 100)).toEqual({ type: 'eat', id: 'extra' })
      expect(state.progress.extra!.feed).toBe(100)
    } finally {
      G.MEMBERS.woni!.characters.pop()
      delete G.CHARACTERS.extra
    }
  })

  it('멤버가 하나 더 생겨도(목록에 더하면) 고른 멤버만 먹고 다른 멤버는 멈춘다', () => {
    G.MEMBERS.tmp = { name: '임시', characters: ['tmp-a'] }
    G.CHARACTERS['tmp-a'] = { member: 'tmp', name: '임시A' }
    try {
      const state = grown('woni', { 'woni-a': 10 })
      G.feed(state, 5)
      G.select(state, 'tmp')
      G.feed(state, 7)
      expect(state.progress).toEqual({ 'woni-a': { feed: 15 }, 'tmp-a': { feed: 7 } })
      expect(G.roster(state).map((m) => m.memberId)).toEqual(['woni', 'may', 'minami', 'liv', 'zena', 'tmp'])
    } finally {
      delete G.MEMBERS.tmp
      delete G.CHARACTERS['tmp-a']
    }
  })

  it('roster — 원이 선택 + 메이 활성 + 미나미 · 리브 · 제나 준비중(순서 원이 → 메이 → 미나미 → 리브 → 제나)', () => {
    const state = grown('woni', { 'woni-a': E0 })
    expect(G.roster(state)).toEqual([
      {
        memberId: 'woni', name: '원이', current: 'woni-a', active: true, finished: false,
        characters: [
          { id: 'woni-a', name: '거제소녀', stage: 1, feed: E0, graduated: false, locked: false, isNew: false },
          { id: 'woni-b', name: '파이리원이', stage: null, feed: 0, graduated: false, locked: true, isNew: false },
        ],
      },
      {
        memberId: 'may', name: '메이', current: 'met', active: false, finished: false,
        characters: [
          { id: 'met', name: '매트', stage: 0, feed: 0, graduated: false, locked: false, isNew: false },
          { id: 'mei', name: '디렉터', stage: null, feed: 0, graduated: false, locked: true, isNew: false },
        ],
      },
      {
        memberId: 'minami', name: '미나미', soon: true, current: null, active: false, finished: false,
        characters: [
          { id: 'minami-gyaru', name: '갸루상', soon: true, stage: null, feed: 0, graduated: false, locked: true, isNew: false },
        ],
      },
      {
        memberId: 'liv', name: '리브', soon: true, current: null, active: false, finished: false,
        characters: [{ id: 'liv-1', name: '리트', soon: true, stage: null, feed: 0, graduated: false, locked: true, isNew: false }],
      },
      {
        memberId: 'zena', name: '제나', soon: true, current: null, active: false, finished: false,
        characters: [{ id: 'zena-1', name: '신라공주', soon: true, stage: null, feed: 0, graduated: false, locked: true, isNew: false }],
      },
    ])
  })

  it('준비중(soon) 멤버(미나미 · 리브 · 제나)는 고를 수 없고 먹이 · 졸업 · 해금 계산에 들어가지 않는다', () => {
    const state = grown('woni', { 'woni-a': 5 })
    for (const id of ['minami', 'liv', 'zena']) expect(() => G.select(state, id)).toThrow('준비 중인 멤버입니다.')
    expect(state.active).toBe('woni')
    // 저장값이 억지로 준비중 멤버를 가리켜도 먹이를 받지 않는다
    for (const member of ['minami', 'liv', 'zena']) {
      const forced = { ...grown(member), progress: {} }
      expect(G.activeCharacter(forced)).toBeNull()
      expect(G.feed(forced, 1_000_000)).toBeNull()
      expect(forced.progress).toEqual({})
    }
    expect(G.fresh().active).toBeNull() // 준비중이 셋이 더 있어도 키울 수 있는 멤버는 원이 · 메이 둘
  })

  it('soon 을 지우면 일반 멤버가 되고, 준비중인 동안은 자동 선택의 멤버 수에 들지 않는다', () => {
    withSoon('may', () => {
      expect(G.fresh().active).toBe('woni') // 메이가 준비중이면 키울 수 있는 멤버는 원이 하나
      expect(() => G.select(grown(null), 'may')).toThrow('준비 중인 멤버입니다.')
      expect(mayRow(grown(null))).toMatchObject({ soon: true, current: null })
    })
    expect(G.fresh().active).toBeNull() // 되돌리면 둘
    delete G.MEMBERS.minami!.soon
    for (const id of G.MEMBERS.minami!.characters) delete G.CHARACTERS[id]!.soon
    try {
      const state = grown(null)
      G.select(state, 'minami')
      expect(G.feed(state, 100)).toEqual({ type: 'eat', id: 'minami-gyaru' })
      expect(G.sayMaxOf(state)).toBe(40) // sayMax 가 없는 멤버는 기본값
    } finally {
      G.MEMBERS.minami!.soon = true
      for (const id of G.MEMBERS.minami!.characters) G.CHARACTERS[id]!.soon = true
    }
  })

  it('migrate — 옛 형식(stage)은 그 캐릭터의 멤버를 고른 것으로 옮기고 names 는 버린다, 모르는 모양은 새로 시작', () => {
    const old = { v: 1, baseline: total(5), stage: 'woni-a', progress: { 'woni-a': { feed: 42 } }, graduated: [], names: { 'woni-a': '만두' }, news: [], startedAt: 1 }
    const state = G.migrate(old)
    expect(state).toMatchObject({ v: 2, active: 'woni', progress: { 'woni-a': { feed: 42 } }, baseline: total(5) })
    expect(state).not.toHaveProperty('names')
    expect(state).not.toHaveProperty('stage')
    expect(G.migrate({ v: 1, stage: null }).active).toBeNull() // 키울 수 있는 멤버가 둘이라 비워 둔다
    expect(G.migrate({ v: 1, species: 'sheep', feed: 5 }).active).toBeNull() // 빛톨 모양
    expect(G.migrate({ v: 9 })).toMatchObject({ v: 2, active: null, progress: {} })
    expect(G.migrate(null)).toMatchObject({ v: 2, active: null })
    withSoon('may', () => expect(G.migrate({ v: 1, stage: null }).active).toBe('woni')) // 한 명뿐이면 그 멤버
  })

  it('migrate — 준비중 멤버(미나미)나 모르는 캐릭터의 흔적은 버리고 원이 · 메이 진행은 그대로 둔다', () => {
    const saved = {
      v: 2,
      baseline: total(5),
      active: 'minami',
      progress: { 'minami-gyaru': { feed: 9 }, ghost: { feed: 1 }, met: { feed: 7 }, 'woni-a': { feed: 42 } },
      graduated: [{ id: 'minami-gyaru', at: 1 }, { id: 'woni-a', at: 2 }],
      news: ['minami-gyaru', 'ghost', 'woni-b'],
      startedAt: 1,
    }
    expect(G.migrate(saved)).toMatchObject({ active: null, progress: { met: { feed: 7 }, 'woni-a': { feed: 42 } }, graduated: [{ id: 'woni-a', at: 2 }], news: ['woni-b'] })
    expect(G.migrate({ ...saved, active: 'woni' }).active).toBe('woni') // 저장된 선택은 유지
    expect(G.migrate({ ...saved, active: 'may' }).active).toBe('may')
    expect(G.migrate({ ...saved, active: null }).active).toBeNull() // 키우기 멈춤은 존중
    expect(G.migrate({ v: 1, stage: 'met', progress: { met: { feed: 5 } }, graduated: [], news: [] })).toMatchObject({ active: 'may', progress: { met: { feed: 5 } } })
  })
})

describe('service', () => {
  it('usage.changed 만 구독하고 패널이 부를 메서드와 AI 도구 둘을 올린다', async () => {
    const { fake } = await start()
    expect(fake.names().sort()).toEqual(['deselect', 'fullscreen', 'seenDex', 'select', 'state', 'talk'])
    expect(fake.tools().map((t) => t.name).sort()).toEqual(['risene-pet_persona', 'risene-pet_say'])
  })

  it('스킬(risene-pet)을 서비스가 올린다 — manifest skills 선언 없이', async () => {
    const { fake } = await start()
    expect(fake.skills()).toEqual([{ name: 'risene-pet', path: 'skills/risene-pet/SKILL.md' }])
  })

  it('사용량이 늘면 고른 멤버의 캐릭터에게 먹이를 주고 저장하고 패널에 밀어 보낸다 — 패널이 닫혀 있어도', async () => {
    const { snapshot, eat, saved, lastPush } = await start({ saved: grown('woni'), usage: total(0) })
    await eat(E0)
    expect((await snapshot()).state.progress['woni-a']!.feed).toBe(E0)
    expect(saved().progress['woni-a']!.feed).toBe(E0)
    expect(lastPush()).toMatchObject({ event: 'evolve', id: 'woni-a' })
    expect(lastPush().state.progress['woni-a']!.feed).toBe(E0)
  })

  it('졸업하면 graduate 소식에 졸업한 id 와 새로 열린 unlocked 를 싣고 news 에 둘 다 남긴다', async () => {
    const { eat, saved, lastPush, fake } = await start({ saved: grown('woni', { 'woni-a': ENDS_LAST - 1 }), usage: total(0) })
    await eat(1)
    expect(lastPush()).toMatchObject({ event: 'graduate', id: 'woni-a', unlocked: 'woni-b' })
    expect(saved().news).toEqual(['woni-a', 'woni-b'])
    await fake.call('seenDex', { id: 'woni-b' })
    expect(saved().news).toEqual(['woni-a'])
  })

  it('고른 멤버가 없으면 먹이는 사라진다', async () => {
    const { snapshot, eat } = await start({ saved: grown(null), usage: total(0) })
    await eat(1_000_000)
    expect((await snapshot()).state.progress).toEqual({})
  })

  it('저장한 상태를 이어받는다 — 옛 names 는 버려지고 이름은 기본 이름으로 나온다', async () => {
    const a = await start({ saved: { ...grown('woni', { 'woni-a': 77 }), names: { 'woni-a': '만두' } }, usage: total(0) })
    const { state } = await a.snapshot()
    expect(state).toMatchObject({ active: 'woni', progress: { 'woni-a': { feed: 77 } } })
    expect(state).not.toHaveProperty('names')
    expect(JSON.parse(await a.fake.callTool('risene-pet_persona', {}, { directory: '/work/a' })).name).toBe('거제소녀')
  })

  it('옛 형식(v 1)과 준비중 멤버(minami)가 든 저장값도 깨지지 않는다', async () => {
    const old = { v: 1, baseline: total(0), stage: 'woni-b', progress: { 'woni-b': { feed: 5 }, 'minami-gyaru': { feed: 9 } }, graduated: [{ id: 'minami-gyaru', at: 1 }], names: {}, news: [], startedAt: 1 }
    const b = await start({ saved: old, usage: total(0) })
    expect((await b.snapshot()).state).toMatchObject({ v: 2, active: 'woni', progress: { 'woni-b': { feed: 5 } }, graduated: [] })
    const c = await start({ saved: { ...grown('minami', { 'minami-gyaru': 1 }, ['minami-gyaru']) }, usage: total(0) })
    expect((await c.snapshot()).state).toMatchObject({ active: null, progress: {}, graduated: [] })
  })

  it('새로 시작하면(키울 수 있는 멤버가 둘) 고른 멤버가 없고, 저장된 active 는 그대로 이어진다 — 키우기 멈춤(null)도 되살아나지 않는다', async () => {
    const first = await start({ usage: total(0) })
    expect((await first.snapshot()).state.active).toBeNull()
    await first.eat(1_000)
    expect((await first.snapshot()).state.progress).toEqual({}) // 고르기 전에는 먹이가 사라진다
    await first.fake.call('select', { member: 'woni' })
    await first.eat(1_000)
    expect((await first.snapshot()).state.progress['woni-a']!.feed).toBe(1_000)
    // 저장된 active: 'woni' 는 다시 켜도 그대로(이미 원이를 키우던 사용자는 계속 원이)
    const again = await start({ saved: first.saved(), usage: total(0) })
    expect((await again.snapshot()).state.active).toBe('woni')
    await first.fake.call('deselect')
    const paused = await start({ saved: first.saved(), usage: total(0) })
    expect((await paused.snapshot()).state.active).toBeNull()
    await paused.eat(1_000)
    expect((await paused.snapshot()).state.progress['woni-a']!.feed).toBe(1_000)
  })

  it('사용량을 못 읽으면 error 로 알리고 서비스는 계속 돈다', async () => {
    const fake = createFakeHost({ id: 'risene-pet', scope: 'app', events: ['usage.changed'], calls: { 'storage.get': () => null, 'usage.summary': () => { throw Object.assign(new Error('x'), { code: 'permission-missing' }) } } })
    fake.mount(bundle)
    expect(((await fake.call('state')) as { error: string | null }).error).toBe('permission-missing')
  })

  it('select · deselect — 멤버를 고르고 해제해 저장하고 패널에 알린다 (같은 스냅샷을 돌려준다)', async () => {
    const { fake, saved, lastPush } = await start()
    await expect(fake.call('select', { member: 'egg' })).rejects.toThrow()
    await expect(fake.call('select', { member: 'woni-a' })).rejects.toThrow()
    for (const member of ['minami', 'liv', 'zena']) await expect(fake.call('select', { member })).rejects.toThrow('준비 중인 멤버입니다.')
    await expect(fake.call('select')).rejects.toThrow()
    const snap = (await fake.call('select', { member: 'woni' })) as { state: State }
    expect(snap.state.active).toBe('woni')
    expect(saved().active).toBe('woni')
    expect(lastPush().state.active).toBe('woni')
    await fake.call('select', { member: 'woni' }) // 이미 그 멤버
    expect(saved().active).toBe('woni')
    await fake.call('select', { member: 'may' }) // 메이도 고를 수 있다
    expect(saved().active).toBe('may')
    await fake.call('deselect')
    expect(saved().active).toBeNull()
  })

  it('처음 졸업한 캐릭터는 "새로 만남" 으로 남고, 도감에서 열어 보면(seenDex) 지워진다', async () => {
    const { fake, snapshot, eat, saved } = await start({ saved: grown('woni', { 'woni-a': ENDS_LAST - 1 }), usage: total(0) })
    await eat(1)
    expect((await snapshot()).state.news).toEqual(['woni-a', 'woni-b'])
    await fake.call('seenDex', { id: 'woni-a' })
    expect(saved().news).toEqual(['woni-b'])
  })

  it('talk 는 먹이 받는 캐릭터 이름을 채워 새 대화를 연다 (보내지 않는다) — 고른 멤버가 없으면 거절', async () => {
    const { fake } = await start({ saved: grown('woni') })
    await fake.call('talk', undefined, { directory: '/work/a' })
    expect(fake.calls.find((c) => c.method === 'chat.compose')).toMatchObject({ params: { text: '거제소녀, ', send: false }, directory: '/work/a' })
    const empty = await start({ saved: grown(null) })
    await expect(empty.fake.call('talk', undefined, { directory: '/work/a' })).rejects.toThrow()
  })

  it('fullscreen 은 패널 전체 화면을 서비스가 연다', async () => {
    const fake = createFakeHost({ id: 'risene-pet', scope: 'app', events: ['usage.changed'], calls: { 'panel.fullscreen': () => true, 'storage.get': () => null, 'usage.summary': () => summary(0) } })
    fake.mount(bundle)
    await fake.call('fullscreen', { on: true }, { directory: '/work/a' })
    await fake.call('fullscreen', { on: 'yes' }, { directory: '/work/a' })
    expect(fake.calls.filter((c) => c.method === 'panel.fullscreen').map((c) => c.params)).toEqual([{ on: true }, { on: false }])
  })

  it('persona 는 고른 멤버의 현재 캐릭터를 알려 준다 — 졸업하면 다음 캐릭터, 고른 멤버가 없으면 알려만 준다', async () => {
    const { fake } = await start({ saved: grown('woni', { 'woni-a': E0 + 1 }) })
    const info = JSON.parse(await fake.callTool('risene-pet_persona', {}, { directory: '/work/a' }))
    expect(info).toMatchObject({ onStage: true, id: 'woni-a', name: '거제소녀', member: 'woni', memberName: '원이', stage: 2, graduated: false, todayTokens: 123, mood: '배고픔' })
    expect(info.characterName).toEqual(expect.any(String))
    const next = await start({ saved: grown('woni', { 'woni-a': ENDS_LAST }, ['woni-a']) })
    expect(JSON.parse(await next.fake.callTool('risene-pet_persona', {}, { directory: '/work/a' }))).toMatchObject({ id: 'woni-b', name: '파이리원이', stage: 1 })
    const empty = await start({ saved: grown(null) })
    expect(JSON.parse(await empty.fake.callTool('risene-pet_persona', {}, { directory: '/work/a' }))).toMatchObject({ onStage: false })
  })

  it('say 는 먹이 받는 캐릭터의 말을 패널에 밀어 보낸다', async () => {
    const { fake, snapshot } = await start({ saved: grown('woni', {}, ['woni-a']) })
    await fake.callTool('risene-pet_say', { text: '파아~', action: 'flame' }, { directory: '/work/a' })
    const last = fake.pushes().at(-1)
    expect(last?.event).toBe('service.update')
    expect((last?.data as { said: { text: string; action: string } }).said).toMatchObject({ text: '파아~', action: 'flame' })
    expect((await snapshot()).said).toMatchObject({ by: { id: 'woni-b', name: '파이리원이' } })
  })

  it('say 글자 수 상한은 현재 키우는 멤버 기준이다 — 원이 40자, 메이 700자', async () => {
    const woni = await start({ saved: grown('woni') })
    await expect(woni.fake.callTool('risene-pet_say', { text: 'hi', action: 'fly' }, { directory: '/work/a' })).rejects.toThrow()
    await expect(woni.fake.callTool('risene-pet_say', { text: '   ' }, { directory: '/work/a' })).rejects.toThrow()
    await woni.fake.callTool('risene-pet_say', { text: 'x'.repeat(40) }, { directory: '/work/a' })
    await expect(woni.fake.callTool('risene-pet_say', { text: 'x'.repeat(41) }, { directory: '/work/a' })).rejects.toThrow('1~40')
    const may = await start({ saved: grown('may') })
    await may.fake.callTool('risene-pet_say', { text: 'x'.repeat(700) }, { directory: '/work/a' })
    await expect(may.fake.callTool('risene-pet_say', { text: 'x'.repeat(701) }, { directory: '/work/a' })).rejects.toThrow('1~700')
    // 도구 스키마의 최댓값은 멤버별 최댓값(700), 설명에 멤버별 상한이 있다
    const say = may.fake.tools().find((t) => t.name === 'risene-pet_say') as unknown as { inputSchema: { properties: { text: { maxLength: number; description: string } } } }
    expect(say.inputSchema.properties.text.maxLength).toBe(700)
    expect(say.inputSchema.properties.text.description).toMatch(/원이 up to 40.*메이 up to 700/)
    const empty = await start({ saved: grown(null) })
    await expect(empty.fake.callTool('risene-pet_say', { text: 'hi' }, { directory: '/work/a' })).rejects.toThrow()
  })

  it('내리면 도구와 소식 구독이 걷힌다', async () => {
    const { fake } = await start()
    await fake.dispose()
    expect(fake.tools()).toEqual([])
  })
})
