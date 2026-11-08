// 빛톨 게임 규칙 (0.3.0) — 서비스(service/index.mjs 가 import 한다)와 패널(index.html 이 <script src> 로 싣는다)이 같이 쓴다.
// persona.js 처럼 export 없이 globalThis.TOKEN_PET_GAME 에 둔다: 패널은 classic 스크립트로, 서비스는 import 의 부수 효과로 읽는다.
// 먹이 · 부화 · 진화 · 졸업은 서비스가 계산하고, 패널은 같은 규칙으로 진행률만 그린다(stageOf · ends).
globalThis.TOKEN_PET_GAME = (() => {
  // 기준 (#1186, 0.2.0 에서 ⅓ 로) — 턴 하나가 맥락 전체를 실어 수십만~백만 토큰이다(캐시는 반만 친다). 흔한 종 기준 하루 50턴이면
  // 부화 ~1시간 미만 · 2단계 몇 시간 · 3단계 반나절~하루 · 졸업 ~2일. 보통 ×1.25, 드묾 ×2(~4일). 값은 부화 뒤 누적
  const HATCH = 1_500_000
  const BASE = [10_000_000, 40_000_000, 100_000_000]
  const SPECIES = {
    squirrel: { weight: 60, mult: 1 },
    sheep: { weight: 30, mult: 1.25 },
    turtle: { weight: 10, mult: 2 },
  }
  // 단계 이름 — 패널의 그림 표(index.html SPECIES)와 같다. AI 도구 persona 가 지금 빛톨의 이름을 알려 주는 데 쓴다
  const NAMES = { squirrel: ['찌릿다람', '번쩍다람', '뇌전다람'], sheep: ['김양', '뭉게양', '폭풍양'], turtle: ['온돌북', '화산북', '용암요새'] }
  const EGG_NAME = '빛알'
  const NATURES = ['급한', '차분한', '느긋한', '호기심 많은', '수줍은']

  const fresh = () => ({ v: 1, baseline: null, feed: 0, species: null, nature: null, seen: [], graduated: [], startedAt: Date.now() })
  const ends = (id) => BASE.map((t) => Math.round(t * SPECIES[id].mult))

  function stageOf(s) {
    if (!s.species) return { stage: -1, from: 0, to: HATCH }
    const e = ends(s.species)
    const fed = s.feed - HATCH
    if (fed < e[0]) return { stage: 0, from: 0, to: e[0] }
    if (fed < e[1]) return { stage: 1, from: e[0], to: e[1] }
    return { stage: 2, from: e[1], to: e[2] }
  }

  function pickSpecies(rnd = Math.random) {
    const total = Object.values(SPECIES).reduce((n, s) => n + s.weight, 0)
    let r = rnd() * total
    for (const [id, s] of Object.entries(SPECIES)) if ((r -= s.weight) < 0) return id
    return 'squirrel'
  }

  const markSeen = (state, id, stage) => {
    const key = `${id}:${stage}`
    if (!state.seen.includes(key)) state.seen.push(key)
  }

  /** 먹이를 주고 부화 · 진화 · 졸업을 정한다. 일어난 일('eat' · 'hatch' · 'evolve' · 'graduate')을 돌려준다 — 먹이가 없으면 null */
  function feed(state, amount, rnd = Math.random) {
    if (amount <= 0) return null
    const before = stageOf(state)
    state.feed += amount
    let event = 'eat'
    if (!state.species && state.feed >= HATCH) {
      state.species = pickSpecies(rnd)
      state.nature = NATURES[Math.floor(rnd() * NATURES.length)]
      event = 'hatch'
    }
    if (state.species) {
      const e = ends(state.species)
      if (state.feed - HATCH >= e[2]) {
        state.graduated.push({ id: state.species, nature: state.nature, at: Date.now() })
        for (let s = 0; s <= 2; s++) markSeen(state, state.species, s)
        state.species = null
        state.nature = null
        state.feed = 0
        return 'graduate'
      }
      const now = stageOf(state)
      // 기준이 ⅓ 로 줄어(0.2.0) 한 번에 여러 단계를 건너뛸 수 있다 — 지나간 단계도 도감 기록에 남긴다
      for (let s = 0; s <= now.stage; s++) markSeen(state, state.species, s)
      if (event !== 'hatch' && now.stage > before.stage) event = 'evolve'
    }
    return event
  }

  /** 사용량 장부(total: { tokens, cacheRead })를 보고 늘어난 만큼 먹인다. 처음(또는 장부가 새로 시작)이면 기준만 잡는다 — 지난 것은 먹이로 치지 않는다 */
  function applyUsage(state, total, rnd = Math.random) {
    if (!state.baseline || total.tokens < state.baseline.tokens) {
      state.baseline = { tokens: total.tokens, cacheRead: total.cacheRead }
      return null
    }
    const dTokens = total.tokens - state.baseline.tokens
    const dCache = Math.max(0, total.cacheRead - state.baseline.cacheRead)
    state.baseline = { tokens: total.tokens, cacheRead: total.cacheRead }
    return feed(state, Math.max(0, Math.round(dTokens - dCache / 2)), rnd)
  }

  return { HATCH, BASE, SPECIES, NAMES, EGG_NAME, NATURES, fresh, ends, stageOf, pickSpecies, feed, applyUsage }
})()
