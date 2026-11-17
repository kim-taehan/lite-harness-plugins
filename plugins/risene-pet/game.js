// 리센느 키우기 게임 규칙 — 서비스(service/index.mjs 가 import 한다)와 패널(index.html 이 <script src> 로 싣는다)이 같이 쓴다.
// export 없이 globalThis.RISENE_PET_GAME 에 둔다: 패널은 classic 스크립트로, 서비스는 import 의 부수 효과로 읽는다.
// 알 · 부화 · 무작위 뽑기가 없다. 멤버를 골라 키운다 — 먹이는 고른 멤버의 "현재 캐릭터"만 받고, 졸업하면 그 멤버의 다음 캐릭터가 열린다.
globalThis.RISENE_PET_GAME = (() => {
  // 성장 기준(빛톨의 절반) — 캐릭터가 받은 누적 먹이. 앞의 둘은 1→2단계 · 2→3단계, 마지막은 졸업. 모든 캐릭터가 같은 양
  const ENDS = [1_650_000, 6_650_000, 16_500_000]
  // 캐릭터는 여기 두 표(데이터)에만 둔다. 더하는 일 = 아래 두 표에 한 줄씩 + assets/<id>/ + persona.js 대사.
  // MEMBERS: 멤버 id → { name, sayMax(AI 도구 say 가 한 번에 보내는 글자 수 상한 — 말이 긴 멤버는 크게), soon?, characters: 캐릭터 id 순서(앞이 졸업하면 다음이 열린다) } · CHARACTERS: 캐릭터 id → { member, name(화면에 보이는 이름), soon? }
  // soon: true 는 "준비중" — 도감에 카드만 보이고 고르거나 키울 수 없다(진행 · 졸업 · 해금 계산에 넣지 않는다). 준비되면 soon 만 지운다.
  // 순서 = 도감 순서: 키울 수 있는 멤버가 먼저, 준비중 멤버는 뒤에(원이 → 메이 → 미나미 → 리브 → 제나).
  // 메이(매트 · 디렉터)의 대사 · 유행어 · 컷아웃은 저장소 밖 risene-archive/may/ 에 있다(README.md 의 "다시 넣는 방법"). 미나미는 메모의 페르소나 원문과 시트를 쓴다.
  const MEMBERS = {
    woni: { name: '원이', sayMax: 40, characters: ['woni-a', 'woni-b'] },
    may: { name: '메이', sayMax: 700, characters: ['met', 'mei'] },
    minami: { name: '미나미', soon: true, characters: ['minami-gyaru'] },
    liv: { name: '리브', soon: true, characters: ['liv-1'] },
    zena: { name: '제나', soon: true, characters: ['zena-1'] },
  }
  const CHARACTERS = {
    'woni-a': { member: 'woni', name: '거제소녀' },
    'woni-b': { member: 'woni', name: '파이리원이' },
    met: { member: 'may', name: '매트' },
    mei: { member: 'may', name: '디렉터' },
    'minami-gyaru': { member: 'minami', name: '갸루 미나미', soon: true },
    'liv-1': { member: 'liv', name: '리트', soon: true },
    'zena-1': { member: 'zena', name: '신라공주', soon: true },
  }
  /** sayMax 를 안 적은 멤버(준비중 등)의 기본 상한 */
  const DEFAULT_SAY_MAX = 40
  const sayMaxOfMember = (memberId) => MEMBERS[memberId]?.sayMax ?? DEFAULT_SAY_MAX
  /** 키울 수 있는 멤버 id — 준비중(soon)은 뺀다 */
  const playableIds = () => Object.keys(MEMBERS).filter((id) => !MEMBERS[id].soon)
  const MEMBER_IDS = playableIds()

  // active: 키우는 멤버 id(없으면 null — 멤버가 한 명뿐이면 처음부터 그 멤버) · progress: 캐릭터마다 { feed }(받은 누적 먹이)
  // graduated: 졸업 기록 { id, at } · news: 도감에 새로 들어온(졸업했거나 새로 열린, 아직 안 열어 본) 캐릭터
  /** 키울 수 있는(준비중이 아닌) 멤버가 한 명뿐이면 고를 것이 없으니 그 멤버 id, 둘 이상이면 null */
  const onlyMember = () => {
    const ids = playableIds()
    return ids.length === 1 ? ids[0] : null
  }
  const fresh = () => ({ v: 2, baseline: null, active: onlyMember(), progress: {}, graduated: [], news: [], startedAt: Date.now() })

  /**
   * 저장해 둔 상태를 읽는다 — 옛 형식(v 1: 캐릭터를 직접 무대에 세우던 `stage`)은 그 캐릭터의 멤버를 고른 것으로 옮기고, 모르는 모양은 새로 시작.
   * 이름 짓기(names)는 없어졌고, 목록에서 빠진 멤버 · 캐릭터(예: 메이를 뺐을 때의 may · met · mei)의 진행 · 졸업 · 새로 만남은 버린다
   */
  function migrate(saved) {
    if (!saved || typeof saved !== 'object' || (saved.v !== 1 && saved.v !== 2)) return fresh()
    const { names, stage, ...rest } = saved
    const state = { ...fresh(), ...rest, v: 2 }
    if (saved.v === 1) state.active = CHARACTERS[stage]?.member ?? null
    // 옛 형식이거나 사라진 멤버였던 경우(= 옮긴 결과가 비었을 때)에만 한 명뿐인 멤버를 고른다. 저장된 active: null(키우기 멈춤)은 존중한다
    const playable = (memberId) => MEMBERS[memberId] && !MEMBERS[memberId].soon
    const gone = saved.v === 1 || (state.active !== null && !playable(state.active))
    if (!playable(state.active)) state.active = gone ? onlyMember() : null
    // 준비중(soon) 캐릭터는 진행이 없다 — 옛 저장값에 흔적이 있어도 버린다
    const known = (id) => CHARACTERS[id] && !CHARACTERS[id].soon
    state.progress = Object.fromEntries(Object.entries(state.progress ?? {}).filter(([id]) => known(id)))
    state.graduated = (state.graduated ?? []).filter((g) => known(g?.id))
    state.news = (state.news ?? []).filter(known)
    return state
  }

  const isGraduated = (state, id) => state.graduated.some((g) => g.id === id)
  const feedOf = (state, id) => state.progress[id]?.feed ?? 0
  /** 그 멤버의 현재 캐릭터 — 목록에서 처음으로 졸업 안 한 캐릭터, 모두 졸업이면 마지막 캐릭터 */
  function currentOf(state, memberId) {
    const list = MEMBERS[memberId].characters
    return list.find((id) => !isGraduated(state, id)) ?? list[list.length - 1]
  }

  /** 아직 안 열린 캐릭터 — 앞선 캐릭터 중 졸업 안 한 것이 있다 */
  function isLocked(state, id) {
    const list = MEMBERS[CHARACTERS[id].member].characters
    return list.slice(0, list.indexOf(id)).some((before) => !isGraduated(state, before))
  }

  /** 지금 먹이를 받는 캐릭터(키우는 멤버의 현재 캐릭터) — 키우는 멤버가 없으면 null */
  const activeCharacter = (state) => (state.active && !MEMBERS[state.active]?.soon ? currentOf(state, state.active) : null)

  /** 그 캐릭터의 단계(0~2) — id 를 안 주면 먹이를 받는 캐릭터. 졸업했으면 마지막 단계에 머문다. 캐릭터가 없으면 stage -1 */
  function stageOf(state, id = activeCharacter(state)) {
    if (!id) return { stage: -1, from: 0, to: ENDS[0] }
    const fed = feedOf(state, id)
    if (fed < ENDS[0]) return { stage: 0, from: 0, to: ENDS[0] }
    if (fed < ENDS[1]) return { stage: 1, from: ENDS[0], to: ENDS[1] }
    return { stage: 2, from: ENDS[1], to: ENDS[2] }
  }

  /**
   * 먹이를 먹이 받는 캐릭터에게 준다. 일어난 일 { type: 'eat' | 'evolve' | 'graduate', id, unlocked? }을 돌려준다
   * — 먹일 수 없으면(키우는 멤버가 없거나 완주) null. 'graduate' 는 새로 열린 캐릭터 id(없으면 null)를 unlocked 에 싣는다
   */
  function feed(state, amount) {
    const id = activeCharacter(state)
    if (!id || amount <= 0 || isGraduated(state, id)) return null
    const before = stageOf(state, id).stage
    const total = feedOf(state, id) + amount
    if (total < ENDS[2]) {
      state.progress[id] = { feed: total }
      return { type: stageOf(state, id).stage > before ? 'evolve' : 'eat', id }
    }
    state.progress[id] = { feed: ENDS[2] }
    state.graduated.push({ id, at: Date.now() })
    const list = MEMBERS[CHARACTERS[id].member].characters
    const unlocked = list[list.indexOf(id) + 1] ?? null
    for (const added of [id, unlocked]) if (added && !state.news.includes(added)) state.news.push(added)
    return { type: 'graduate', id, unlocked }
  }

  /** 사용량 장부(total: { tokens, cacheRead })를 보고 늘어난 만큼 먹인다. 처음(또는 장부가 새로 시작)이면 기준만 잡는다 — 지난 것은 먹이로 치지 않는다 */
  function applyUsage(state, total) {
    if (!state.baseline || total.tokens < state.baseline.tokens) {
      state.baseline = { tokens: total.tokens, cacheRead: total.cacheRead }
      return null
    }
    const dTokens = total.tokens - state.baseline.tokens
    const dCache = Math.max(0, total.cacheRead - state.baseline.cacheRead)
    state.baseline = { tokens: total.tokens, cacheRead: total.cacheRead }
    return feed(state, Math.max(0, Math.round(dTokens - dCache / 2)))
  }

  /** 멤버를 골라 키운다 — 이미 그 멤버면 그대로. 다른 멤버는 진행을 유지한 채 멈춘다 */
  function select(state, memberId) {
    if (!Object.hasOwn(MEMBERS, memberId)) throw new Error(`멤버는 ${playableIds().join(' · ')} 중 하나여야 합니다.`)
    if (MEMBERS[memberId].soon) throw new Error('준비 중인 멤버입니다.')
    state.active = memberId
  }

  /** 키우는 멤버를 없앤다 — 먹이는 사라진다 */
  function deselect(state) {
    state.active = null
  }

  /**
   * 대기실 · 도감용 파생값 — 멤버마다 { memberId, name, current, active, finished, characters: [{ id, name, stage|null, feed, graduated, locked, isNew }] }.
   * 대기실에는 멤버마다 current 캐릭터가 한 명씩 있다(키우는 멤버도 그대로). stage 는 잠긴 캐릭터면 null.
   * 준비중(soon) 멤버는 계산에 넣지 않고 고정 모양 { memberId, name, soon: true, current: null, active: false, finished: false, characters: [{ id, name, soon: true, stage: null, feed: 0, graduated: false, locked: true, isNew: false }] } 으로 돌려준다
   */
  function roster(state) {
    return Object.keys(MEMBERS).map((memberId) => {
      const { name, characters, soon } = MEMBERS[memberId]
      if (soon)
        return {
          memberId,
          name,
          soon: true,
          current: null,
          active: false,
          finished: false,
          characters: characters.map((id) => ({ id, name: CHARACTERS[id].name, soon: true, stage: null, feed: 0, graduated: false, locked: true, isNew: false })),
        }
      return {
        memberId,
        name,
        current: currentOf(state, memberId),
        active: state.active === memberId,
        finished: characters.every((id) => isGraduated(state, id)),
        characters: characters.map((id) => {
          const locked = isLocked(state, id)
          return { id, name: CHARACTERS[id].name, stage: locked ? null : stageOf(state, id).stage, feed: feedOf(state, id), graduated: isGraduated(state, id), locked, isNew: state.news.includes(id) }
        }),
      }
    })
  }

  /** say 가 지금 받는 글자 수 상한 — 키우는 멤버 기준(없으면 기본) */
  const sayMaxOf = (state) => sayMaxOfMember(state.active)
  /** 멤버 가운데 가장 큰 상한 — 도구 스키마의 maxLength */
  const sayMaxAll = () => Math.max(...playableIds().map(sayMaxOfMember))

  return { ENDS, MEMBERS, CHARACTERS, MEMBER_IDS, fresh, migrate, isGraduated, isLocked, feedOf, currentOf, activeCharacter, stageOf, feed, applyUsage, select, deselect, roster, sayMaxOfMember, sayMaxOf, sayMaxAll }
})()
