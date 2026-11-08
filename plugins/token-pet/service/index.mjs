// 빛톨 키우기 서비스 (0.3.0) — 앱 안에서 도는 코드. 패널을 닫아 둬도 토큰이 먹이로 쌓이고, AI 도구(persona · say)도 여기서 올린다.
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
      // 말 걸기 — 서비스는 AI 를 직접 부르지 못해서 새 대화를 "빛톨아, " 로 채워 연다. 대답은 스킬 + persona · say 도구가 한다
      this.expose('talk', (_params, { directory }) => host.call('chat.compose', { text: '빛톨아, ', send: false }, { directory }))

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
      const stage = this.stage()
      const today = this.summary ? Number(this.summary.today.tokens) || 0 : 0
      return JSON.stringify({
        name: state.species ? G.NAMES[state.species][stage] : G.EGG_NAME,
        species: state.species ?? null,
        stage: state.species ? stage + 1 : 0,
        nature: state.nature ?? null,
        todayTokens: today,
        mood: mood(today),
        graduated: state.graduated.length,
        ...P.voice(state.species, stage, state.nature),
      })
    }

    say(args) {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (!text || text.length > SAY_MAX) throw new Error(`text 는 1~${SAY_MAX}자 글이어야 합니다.`)
      if (args.action !== undefined && !P.ACTIONS.includes(args.action)) throw new Error(`action 은 ${P.ACTIONS.join(', ')} 중 하나여야 합니다.`)
      this.said = { text, ...(args.action && { action: args.action }), at: Date.now() }
      this.push({ said: this.said })
      return '패널의 빛톨이 말했습니다.'
    }
  }
