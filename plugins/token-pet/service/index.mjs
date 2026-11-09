// 빛톨 키우기 서비스 (0.4.0) — 앱 안에서 도는 코드. 패널을 닫아 둬도 토큰이 먹이로 쌓이고, AI 도구(persona · say)도 여기서 올린다.
// 번들(build.mjs 가 이 파일과 game.js · persona.js 를 service.mjs 한 파일로 묶는다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다.
// 상태는 서비스가 들고(storage 'state', 패널이 쓰던 키 그대로라 키우던 빛톨이 이어진다), 패널은 service.call 로 읽고 service.update 소식으로 받는다.
import '../game.js'
import '../persona.js'

const G = globalThis.TOKEN_PET_GAME
const P = globalThis.TOKEN_PET_PERSONA
const SAY_MAX = 200
/** 사용량 소식을 놓쳐도 이 시간마다 한 번은 읽는다 */
const SAFETY_POLL_MS = 60_000

function mood(todayTokens) {
  if (todayTokens >= 5_000_000) return '배부름'
  if (todayTokens >= 500_000) return '기분 좋음'
  return '배고픔'
}

export default (host) =>
  class TokenPet extends host.Service {
    state = G.fresh()
    summary = null
    error = null
    said = null
    /** 사용량 읽기를 한 줄로 세운다 — 기준(baseline)이 겹쳐 두 번 먹이지 않게 */
    queue = Promise.resolve()

    constructor(ctx) {
      super(ctx)
      this.loaded = this.load()
      this.first = this.loaded.then(() => this.poll())
      ctx.on('usage.changed', () => void this.poll())
      const timer = setInterval(() => void this.poll(), SAFETY_POLL_MS)
      ctx.effect(() => () => clearInterval(timer))

      // 패널이 service.call 로 부르는 것
      this.expose('state', async () => {
        await this.first
        return this.snapshot()
      })
      this.expose('setBg', async (params) => {
        await this.loaded
        const bg = params && typeof params === 'object' ? params.bg : undefined
        if (typeof bg !== 'string' || bg.length > 20) throw new Error('bg 는 짧은 글이어야 합니다.')
        this.state.bg = bg
        this.save()
        this.push()
        return this.snapshot()
      })
      // 무대에 친구 불러오기 — 졸업한 종만, 한 마리(다른 친구를 부르면 교체). null 이면 집으로 돌려보낸다
      this.expose('setMate', async (params) => {
        await this.loaded
        const id = params && typeof params === 'object' ? params.id : undefined
        if (id !== null && !this.graduatedIds().includes(id)) throw new Error('졸업한 친구만 무대에 부를 수 있습니다.')
        this.state.mate = id
        this.save()
        this.push()
        return this.snapshot()
      })
      // 이름 짓기 — 종마다 하나, 졸업한 종만, 빈 글이면 지운다
      this.expose('setName', async (params) => {
        await this.loaded
        const id = params && typeof params === 'object' ? params.id : undefined
        const raw = params && typeof params === 'object' && typeof params.name === 'string' ? params.name : ''
        if (!this.graduatedIds().includes(id)) throw new Error('졸업한 친구만 이름을 지을 수 있습니다.')
        const name = raw.trim()
        if ([...name].length > G.NAME_MAX) throw new Error(`이름은 ${G.NAME_MAX}자까지입니다.`)
        const names = { ...this.state.names }
        if (name) names[id] = name
        else delete names[id]
        this.state.names = names
        this.save()
        this.push()
        return this.snapshot()
      })
      // 도감에서 그 친구를 열어 봤다 — "새로 만남" 표시를 지운다
      this.expose('seenDex', async (params) => {
        await this.loaded
        const id = params && typeof params === 'object' ? params.id : undefined
        if (this.state.news.includes(id)) {
          this.state.news = this.state.news.filter((item) => item !== id)
          this.save()
          this.push()
        }
        return this.snapshot()
      })
      // 말 걸기 — 서비스는 AI 를 직접 부르지 못해서 새 대화를 "빛톨아, " 로 채워 연다. 대답은 스킬 + persona · say 도구가 한다
      this.expose('talk', (_params, { directory }) => host.call('chat.compose', { text: '빛톨아, ', send: false }, { directory }))

      // 전체 화면 — 서비스가 그 패널 탭에 열고 닫는다(패널이 보이는 탭일 때만 된다)
      this.expose('fullscreen', (params, { directory }) => host.call('panel.fullscreen', { on: params?.on === true }, { directory }))

      // 스킬 — "빛톨아" 같은 말에 AI 가 persona 도구로 그 말투로만 답하게 하는 지침. 서비스가 켜진 프로젝트에서만 보인다
      host.skills.register({ name: 'token-pet', path: 'skills/token-pet/SKILL.md' })

      // AI 도구 — AI 에는 token-pet_persona · token-pet_say 로 보인다
      host.tools.register({
        name: 'persona',
        description:
          "Get the user's current pet (빛톨): its name, species, stage, nature, today's food and mood, and the speaking rules for its voice. Call this before answering as the pet.",
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async () => {
          await this.first
          return this.persona()
        },
      })
      host.tools.register({
        name: 'say',
        description: 'Show the line you just answered as the pet in its speech bubble on the token-pet panel, with one matching action.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: SAY_MAX, description: "The pet's line, exactly as you answered." },
            action: { type: 'string', enum: P.ACTIONS, description: 'How the pet moves while saying it.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        run: (args) => this.say(args),
      })
    }

    async load() {
      try {
        const saved = await host.call('storage.get', { key: 'state' })
        if (saved && saved.v === 1) this.state = { ...G.fresh(), ...saved }
      } catch {
        /* 처음 */
      }
      // 0.1.1 에서 이미 부화한 빛톨은 성격이 없다 — 하나 정해 남긴다
      if (this.state.species && !this.state.nature) {
        this.state.nature = G.NATURES[Math.floor(Math.random() * G.NATURES.length)]
        this.save()
      }
    }

    save() {
      host.call('storage.set', { key: 'state', value: this.state }).catch(() => {
        /* 다음에 다시 */
      })
    }

    /** 사용량을 읽어 늘어난 만큼 먹인다. 먹이를 먹었으면 패널에 일어난 일(event)을 알린다 */
    poll() {
      this.queue = this.queue.then(() => this.pollNow()).catch((error) => this.ctx.logger.warn('poll', error))
      return this.queue
    }

    async pollNow() {
      await this.loaded
      try {
        this.summary = await host.call('usage.summary')
        this.error = null
      } catch (error) {
        this.error = typeof error?.code === 'string' ? error.code : 'usage-failed'
        return this.push()
      }
      const event = G.applyUsage(this.state, this.summary.total)
      if (event || !this.state.savedOnce) {
        this.state.savedOnce = true
        this.save()
      }
      this.push(event ? { event } : {})
    }

    graduatedIds() {
      return [...new Set(this.state.graduated.map((g) => g.id))]
    }

    /** 지금 무대에 서서 말하는 친구 — 불러온 친구(3단계 · 마지막 졸업 때의 성격)가 있으면 그 친구, 없으면 키우는 빛톨 */
    onStage() {
      const { state } = this
      if (state.mate && this.graduatedIds().includes(state.mate)) {
        const last = G.lastGraduation(state, state.mate)
        return { species: state.mate, stage: 2, nature: last?.nature ?? null, name: G.displayName(state, state.mate, 2), mate: true }
      }
      const stage = this.stage()
      return { species: state.species, stage, nature: state.nature, name: state.species ? G.displayName(state, state.species, stage) : G.EGG_NAME, mate: false }
    }

    stage() {
      return this.state.species ? Math.max(0, G.stageOf(this.state).stage) : 0
    }

    snapshot() {
      return { state: this.state, today: this.summary ? { tokens: this.summary.today.tokens, turns: this.summary.today.turns } : null, error: this.error, said: this.said }
    }

    /** 패널에 지금 모습을 밀어 보낸다 — extra.event(먹이 · 부화 · 진화 · 졸업) 가 있으면 패널이 반응을 한다 */
    push(extra = {}) {
      host.panel.emit('update', { ...this.snapshot(), ...extra })
    }

    persona() {
      const { state } = this
      const who = this.onStage()
      const today = this.summary ? Number(this.summary.today.tokens) || 0 : 0
      return JSON.stringify({
        name: who.name,
        species: who.species ?? null,
        stage: who.species ? who.stage + 1 : 0,
        nature: who.nature ?? null,
        todayTokens: today,
        mood: mood(today),
        graduated: state.graduated.length,
        ...(who.mate && { raising: state.species ? G.displayName(state, state.species, this.stage()) : G.EGG_NAME }),
        ...P.voice(who.species, who.stage, who.nature),
      })
    }

    say(args) {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (!text || text.length > SAY_MAX) throw new Error(`text 는 1~${SAY_MAX}자 글이어야 합니다.`)
      if (args.action !== undefined && !P.ACTIONS.includes(args.action)) throw new Error(`action 은 ${P.ACTIONS.join(', ')} 중 하나여야 합니다.`)
      const who = this.onStage()
      this.said = { text, ...(args.action && { action: args.action }), at: Date.now(), by: { species: who.species ?? null, stage: who.stage, name: who.name } }
      this.push({ said: this.said })
      return '패널의 빛톨이 말했습니다.'
    }
  }
