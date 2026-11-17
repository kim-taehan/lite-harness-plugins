// 리센느 키우기 서비스 — 앱 안에서 도는 코드. 패널을 닫아 둬도 토큰이 먹이로 쌓이고, AI 도구(persona · say)도 여기서 올린다.
// 번들(build.mjs 가 이 파일과 game.js · persona.js 를 service.mjs 한 파일로 묶는다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다.
// 상태는 서비스가 들고(storage 'state' — storage 는 플러그인마다 따로라 다른 플러그인과 키가 겹치지 않는다),
// 패널은 service.call 로 읽고 service.update 소식으로 받는다.
import '../game.js'
import '../persona.js'

const G = globalThis.RISENE_PET_GAME
const P = globalThis.RISENE_PET_PERSONA
/** 사용량 소식을 놓쳐도 이 시간마다 한 번은 읽는다 */
const SAFETY_POLL_MS = 60_000
const NO_ONE = '키우는 멤버가 없습니다. 패널에서 멤버를 골라야 합니다.'

function mood(todayTokens) {
  if (todayTokens >= 5_000_000) return '배부름'
  if (todayTokens >= 500_000) return '기분 좋음'
  return '배고픔'
}

const idOf = (params) => (params && typeof params === 'object' ? params.id : undefined)
const reply = (event) => (event ? { event: event.type, id: event.id, ...(event.type === 'graduate' && { unlocked: event.unlocked }) } : {})

export default (host) =>
  class RisenePet extends host.Service {
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
      // 키울 멤버 고르기 — 이미 그 멤버면 그대로, 다른 멤버는 진행을 유지한 채 멈춘다
      this.expose('select', (params) => this.change(() => G.select(this.state, params && typeof params === 'object' ? params.member : undefined)))
      // 키우는 멤버 없애기 — 먹이는 사라진다
      this.expose('deselect', () => this.change(() => G.deselect(this.state)))
      // 도감에서 그 캐릭터를 열어 봤다 — "새로 만남" 표시를 지운다
      this.expose('seenDex', (params) =>
        this.change(() => {
          this.state.news = this.state.news.filter((item) => item !== idOf(params))
        }),
      )
      // 말 걸기 — 서비스는 AI 를 직접 부르지 못해서 새 대화를 "<이름>, " 로 채워 연다. 대답은 스킬 + persona · say 도구가 한다
      this.expose('talk', async (_params, { directory }) => {
        await this.loaded
        const id = G.activeCharacter(this.state)
        if (!id) throw new Error(NO_ONE)
        return host.call('chat.compose', { text: `${G.CHARACTERS[id].name}, `, send: false }, { directory })
      })

      // 전체 화면(대기실) — 서비스가 그 패널 탭에 열고 닫는다(패널이 보이는 탭일 때만 된다)
      this.expose('fullscreen', (params, { directory }) => host.call('panel.fullscreen', { on: params?.on === true }, { directory }))

      // 스킬 — 캐릭터 이름을 부르면 AI 가 persona 도구로 그 말투로만 답하게 하는 지침. 서비스가 켜진 프로젝트에서만 보인다
      host.skills.register({ name: 'risene-pet', path: 'skills/risene-pet/SKILL.md' })

      // AI 도구 — AI 에는 risene-pet_persona · risene-pet_say 로 보인다
      host.tools.register({
        name: 'persona',
        description:
          "Get the character the user is currently raising (리센느 키우기: the selected member's current character): its name, member, stage, today's food and mood, and the speaking rules for its voice. Call this before answering as the character.",
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async () => {
          await this.first
          return this.persona()
        },
      })
      host.tools.register({
        name: 'say',
        description: 'Show the line you just answered as the character in its speech bubble on the risene-pet panel, with one matching action.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: G.sayMaxAll(), description: `The character's line, exactly as you answered. Length limit by member: ${G.MEMBER_IDS.map((id) => `${G.MEMBERS[id].name} up to ${G.sayMaxOfMember(id)} characters`).join(', ')}.` },
            action: { type: 'string', enum: P.ACTIONS, description: 'How the character moves while saying it.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        run: async (args) => {
          await this.loaded
          return this.say(args)
        },
      })
    }

    async load() {
      try {
        const saved = await host.call('storage.get', { key: 'state' })
        if (saved) this.state = G.migrate(saved)
      } catch {
        /* 처음 */
      }
    }

    save() {
      host.call('storage.set', { key: 'state', value: this.state }).catch(() => {
        /* 다음에 다시 */
      })
    }

    /** 상태를 바꾸고(규칙 위반이면 던진다) 저장하고 패널에 알린다 */
    async change(mutate) {
      await this.loaded
      mutate()
      this.save()
      this.push()
      return this.snapshot()
    }

    /** 사용량을 읽어 늘어난 만큼 먹인다. 먹이를 먹었으면 패널에 일어난 일(event · id · 졸업이면 unlocked)을 알린다 */
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
      this.push(reply(event))
    }

    snapshot() {
      return { state: this.state, today: this.summary ? { tokens: this.summary.today.tokens, turns: this.summary.today.turns } : null, error: this.error, said: this.said }
    }

    /** 패널에 지금 모습을 밀어 보낸다 — extra.event(먹이 · 진화 · 졸업 — id 와 졸업이면 새로 열린 unlocked) 가 있으면 패널이 반응을 한다 */
    push(extra = {}) {
      host.panel.emit('update', { ...this.snapshot(), ...extra })
    }

    persona() {
      const { state } = this
      const id = G.activeCharacter(state)
      if (!id) return JSON.stringify({ onStage: false, message: NO_ONE })
      const today = this.summary ? Number(this.summary.today.tokens) || 0 : 0
      const { stage } = G.stageOf(state, id)
      return JSON.stringify({
        onStage: true,
        id,
        name: G.CHARACTERS[id].name,
        member: G.CHARACTERS[id].member,
        memberName: G.MEMBERS[G.CHARACTERS[id].member].name,
        stage: stage + 1,
        graduated: G.isGraduated(state, id),
        todayTokens: today,
        mood: mood(today),
        ...P.voice(id, stage),
      })
    }

    say(args) {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (!text) throw new Error('text 는 비어 있지 않은 글이어야 합니다.')
      if (args.action !== undefined && !P.ACTIONS.includes(args.action)) throw new Error(`action 은 ${P.ACTIONS.join(', ')} 중 하나여야 합니다.`)
      const id = G.activeCharacter(this.state)
      if (!id) throw new Error(NO_ONE)
      const max = G.sayMaxOf(this.state)
      if (text.length > max) throw new Error(`text 는 1~${max}자(현재 캐릭터 기준)여야 합니다.`)
      this.said = { text, ...(args.action && { action: args.action }), at: Date.now(), by: { id, stage: G.stageOf(this.state, id).stage, name: G.CHARACTERS[id].name } }
      this.push({ said: this.said })
      return '패널의 캐릭터가 말했습니다.'
    }
  }
