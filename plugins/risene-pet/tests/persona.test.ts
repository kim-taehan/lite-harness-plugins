// 리센느 페르소나(persona.js) — 대사 · 유행어 · 동작이 계약대로인지 본다. 앱 없이 전역(globalThis.RISENE_PET_PERSONA)을 읽는다.
// 서비스가 flame 같은 새 동작을 받아 주는지는 가짜 host 로 한 번 본다(서비스 전체 시험은 service.test.ts).
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')

type Catchphrase = { text: string; usage: string; slot?: boolean; action?: string }
type Character = { name: string; member: string; catchphrases: Catchphrase[]; stages: unknown[] }
type Voice = { characterName: string | null; voice: string | null; stageTone: string | null; examples: string[]; actions: string[]; catchphrases?: Catchphrase[]; signatureNote?: string; anger?: string[] }
type Persona = {
  ACTIONS: string[]
  CHARACTERS: Record<string, Character>
  react: (id: string, stage: number, avoid?: string, rnd?: () => number) => { text: string; more: string[]; action: string }
  voice: (id: string, stage: number) => Voice
  RULES: string[]
  MEMBER_VOICE: Record<string, string>
  MEMBER_VOICE_VIDEO: Record<string, string>
}
let P: Persona

const IDS = ['met', 'mei', 'woni-a', 'woni-b']
const WONI_IDS = ['woni-a', 'woni-b']
const STAGES = [0, 1, 2]
const SHARED_MAY = ['○○은 그립감이 좋다', '저는 햇살이니깐요', '정말 나쁜 어른의 표본이시네요']
const SHARED_WONI = ['오이쉬에', '밥은 줍니까?', '뭐고 살림 차리자는 거가']
const texts = (id: string) => (P.voice(id, 0).catchphrases ?? []).map((c) => c.text)

beforeAll(async () => {
  await import(path.join(here, 'persona.js'))
  P = (globalThis as unknown as { RISENE_PET_PERSONA: Persona }).RISENE_PET_PERSONA
})

describe('react · voice', () => {
  it('캐릭터 4개 × 단계 1~3 모두 voice 가 비지 않고 react 가 빈 말풍선 없이 { text, more, action } 을 돌려준다', () => {
    for (const id of IDS)
      for (const stage of STAGES) {
        const v = P.voice(id, stage)
        expect(v.characterName, id).toBeTruthy()
        expect(v.voice, id).toBeTruthy()
        expect(v.stageTone, `${id}:${stage}`).toBeTruthy()
        expect(v.examples.length).toBeGreaterThan(0)
        for (let i = 0; i < 40; i++) {
          const r = P.react(id, stage, undefined, Math.random)
          expect(r.text.trim(), `${id}:${stage}`).not.toBe('')
          expect(r.more.every((m) => typeof m === 'string' && m.trim() !== '')).toBe(true)
          expect(P.ACTIONS).toContain(r.action)
        }
      }
  })

  it('바로 전에 한 말은 다시 고르지 않는다', () => {
    for (const id of IDS)
      for (const stage of STAGES) {
        let last = ''
        for (let i = 0; i < 100; i++) {
          const { text } = P.react(id, stage, last)
          expect(text).not.toBe(last)
          last = text
        }
      }
  })

  it('모르는 캐릭터는 빈 말 · nod 로 조용히 넘어간다', () => {
    expect(P.react('nobody', 0)).toEqual({ text: '', more: [], action: 'nod' })
    expect(P.voice('nobody', 0).characterName).toBeNull()
  })

  it('원이 계열은 한 줄 대사라 more 가 비어 있다', () => {
    for (const id of WONI_IDS) for (const stage of STAGES) expect(P.react(id, stage).more).toEqual([])
  })

  it('메이 멤버(매트 · 디렉터)는 말풍선이 2마디다 — more 길이 1, 한 마디 길이는 단계마다 길어진다(약 150~200 · 200~250 · 230~300자)', () => {
    const range = [[150, 200], [200, 250], [230, 300]] as const
    for (const id of ['met', 'mei'])
    for (const stage of STAGES)
      for (let i = 0; i < 60; i++) {
        const r = P.react(id, stage)
        expect(r.more.length).toBe(1)
        for (const bubble of [r.text, ...r.more]) {
          expect(bubble.length, `${stage}: ${bubble}`).toBeGreaterThanOrEqual(range[stage]![0])
          expect(bubble.length, `${stage}: ${bubble}`).toBeLessThanOrEqual(range[stage]![1])
        }
      }
    for (const id of ['met', 'mei']) for (const stage of STAGES) expect((P.CHARACTERS[id]!.stages as { lines: unknown[] }[])[stage]!.lines.length).toBeGreaterThanOrEqual(6)
  })

  it('메이 대사에는 "중략" 과 일본 문자가 없고 해요체 중심이며, anger 는 5단계다', () => {
    for (const id of ['met', 'mei']) {
      const all = STAGES.flatMap((s) => (P.CHARACTERS[id]!.stages as { lines: (string | string[])[] }[])[s]!.lines.flat())
      const text = all.join('\n')
      expect(text, id).not.toContain('중략')
      expect(text, id).not.toMatch(/[\u3040-\u30ff\u31f0-\u31ff]/)
    }
    const anger = P.voice('mei', 0).anger!
    expect(anger).toEqual(['어? 진짜요?', '그건 조금 아닌 것 같은데요?', '아니, 그건 너무하신 거 아니에요?', '정말 너무하시네요.', '아니 진짜... 정말 나쁜 어른의 표본이시네요.'])
    expect(P.voice('met', 0).anger).toEqual(anger) // 화난 반응은 멤버 단위 — 매트도 같은 5단계를 쓴다
  })

  it('RULES[0] 은 길이를 멤버 · 캐릭터 규정에 맡긴다 — 원이 · 메이가 각각 적혀 있다', () => {
    expect(P.RULES[0]).toContain('멤버 공통 말투')
    expect(P.RULES[0]).toContain('원이 = 2~3 단어')
    expect(P.RULES[0]).toContain('메이(매트 · 디렉터)')
  })

  it('영상 근거 말투는 MEMBER_VOICE_VIDEO.may 한 곳에 있고 메이 두 캐릭터의 voice() 에 들어간다', () => {
    const video = P.MEMBER_VOICE_VIDEO.may!
    expect(video.length).toBeGreaterThan(0)
    for (const id of ['met', 'mei']) {
      expect(P.voice(id, 0).voice, id).toContain(video)
      expect(P.CHARACTERS[id]!.voice, id).not.toContain('저 잘하죠')
    }
    expect(video).toContain('저 잘하죠')
    expect(video).toContain('헐 대박')
    expect(video).toContain('상황 말')
    expect(video).toContain('부정형')
    expect(P.voice('woni-a', 0).voice).not.toContain('헐 대박') // 원이는 건드리지 않는다
  })

  it('그립감 유행어의 usage 에 상황 말과 부정형 변형이 적혀 있고 목록은 늘어나지 않으며, 중대장 유행어도 상황 말을 쓴다', () => {
    for (const id of ['met', 'mei']) {
      const list = P.voice(id, 0).catchphrases!
      const grip = list.find((c) => c.text === '○○은 그립감이 좋다')!
      expect(grip.usage, id).toContain('상황 말')
      expect(grip.usage, id).toContain('부정형')
    }
    expect(P.voice('mei', 0).catchphrases!.find((c) => c.text.includes('중대장'))!.usage).toContain('상황 말')
    expect(texts('met')).toEqual(SHARED_MAY)
    expect(texts('mei')).toEqual([...SHARED_MAY, '메이 중대장은 ○○에게 실망했다'])
  })

  it('메이 풀마다 상황 말 그립감 줄(부정형은 한 풀에 한 줄까지)과 감탄 리액션 줄이 있다', () => {
    for (const id of ['met', 'mei'])
      for (const stage of STAGES) {
        const all = (P.CHARACTERS[id]!.stages as { lines: string[][] }[])[stage]!.lines.map((l) => l.join(' '))
        const grip = all.filter((l) => l.includes('그립감이'))
        expect(grip.length, `${id} ${stage}`).toBe(1)
        expect(grip[0], `${id} ${stage}`).toMatch(/(기회|오늘|이 상황)[은는]? 그립감이/)
        expect(all.filter((l) => /그립감이 (너무 )?안 좋다/.test(l)).length, `${id} ${stage}`).toBeLessThanOrEqual(1)
        expect(all.filter((l) => /헐 대박|진짜요\?|어머|와,/.test(l)).length, `${id} ${stage}`).toBeGreaterThanOrEqual(2)
        // 반말이 기본 · 말 많음을 스스로 말하는 말은 없다
        for (const l of all) expect(l, l).not.toMatch(/말이 (너무 )?많|수다가 (너무 )?(길|많)/)
      }
  })

  it('메이는 해요체가 기본이고 반말이 한두 마디 섞인다 — 말투 문구에 함께 있고 "반말이 기본 아님" 은 남지 않으며, 각 캐릭터 단계마다 반말 섞임 줄이 1줄 이상이다', () => {
    const mixed = /(^|[ ,!?.])야[ ,!]|당연하지|했잖아(?!요)|잖아(?!요)|인데\?/
    for (const id of ['met', 'mei']) {
      const v = P.voice(id, 0)
      expect(v.voice, id).toContain('해요체')
      expect(v.voice, id).toContain('반말이 한두 마디 섞인다')
      expect(v.voice, id).not.toContain('반말이 기본이 아니다')
      expect(P.MEMBER_VOICE_VIDEO.may!).toContain('반말이 한두 마디 튀어나온다')
      for (const stage of STAGES) {
        const all = (P.CHARACTERS[id]!.stages as { lines: string[][] }[])[stage]!.lines.map((l) => l.join(' '))
        expect(all.filter((l) => mixed.test(l)).length, `${id} ${stage}`).toBeGreaterThanOrEqual(1)
        // 반말만 이어서 말하지는 않는다 — 해요체 어미가 대사마다 있다
        for (const l of all) expect(l, l).toMatch(/(요|죠)[.?!]/)
      }
    }
  })

  it('RULES 에는 멤버끼리 놀리고 티격태격하는 장난 허용 문구와 기존 두 금지 문구(본인의 말처럼 쓰지 않는다 · 사생활 · 확인 안 된 일화를 지어내지 않는다)가 모두 있다', () => {
    const rule = P.RULES.find((r) => r.includes('실존 멤버 본인의 말처럼 쓰지 않는다'))!
    expect(rule).toBeTruthy()
    expect(rule).toContain('멤버의 사생활 · 확인 안 된 일화를 지어내지 않는다')
    expect(rule).toContain('멤버끼리 서로 언급하고 놀리거나 티격태격하는')
    expect(rule).toContain('원이 언니 없이도 할 수 있어요')
    expect(rule).toContain('괜찮다')
  })

  it('"정말 나쁜 어른의 표본이시네요" 는 메이 두 캐릭터의 단계마다 1줄 있고 한 줄에 한 번만 나오며, 원이 풀에는 없다', () => {
    const WORST = '정말 나쁜 어른의 표본이시네요'
    for (const id of ['met', 'mei']) {
      const usage = P.voice(id, 0).catchphrases!.find((c) => c.text === WORST)!.usage
      expect(usage, id).toContain('자주')
      expect(usage, id).toContain('anger 마지막 단계')
      expect(usage, id).toContain('욕설이 아니라')
      expect(P.voice(id, 0).signatureNote, id).toContain('자주 쓴다')
      expect(P.voice(id, 0).anger!.at(-1), id).toContain(WORST)
      for (const stage of STAGES) {
        const all = (P.CHARACTERS[id]!.stages as { lines: string[][] }[])[stage]!.lines.map((l) => l.join(' '))
        const hit = all.filter((l) => l.includes(WORST))
        expect(hit.length, `${id} ${stage}`).toBe(1)
        expect(hit[0]!.split(WORST).length - 1, `${id} ${stage}`).toBe(1)
        expect(all.length, `${id} ${stage}`).toBe(6)
      }
    }
    for (const id of WONI_IDS) for (const stage of STAGES) expect((P.CHARACTERS[id]!.stages as { lines: string[] }[])[stage]!.lines.join(' ')).not.toContain(WORST)
    // 다른 유행어(그립감 · 햇살)는 풀마다 한 줄씩 그대로
    for (const id of ['met', 'mei']) for (const stage of STAGES) {
      const all = (P.CHARACTERS[id]!.stages as { lines: string[][] }[])[stage]!.lines.map((l) => l.join(' '))
      expect(all.filter((l) => l.includes('햇살이니깐요')).length, `${id} ${stage}`).toBe(1)
    }
  })

  it('메이 3단계 풀에는 고민 공감 대사가 정확히 1줄 있고, 풀 전체에 말투 자기언급 대사가 없다', () => {
    for (const id of ['met', 'mei']) {
      const stages = P.CHARACTERS[id]!.stages as { lines: string[][] }[]
      const third = stages[2]!.lines.map((l) => l.join(' '))
      const empathy = third.filter((l) => /힘든 일 있어요/.test(l))
      expect(empathy.length, id).toBe(1)
      expect(empathy[0], id).toContain('들어 줄게요')
      expect(empathy[0], id).toMatch(/(요|죠)[.?!]/)
      for (const stage of [0, 1]) expect(stages[stage]!.lines.map((l) => l.join(' ')).filter((l) => /힘든 일|고민을 (털어|말)/.test(l)).length, `${id} ${stage}`).toBe(0)
      for (const l of stages.flatMap((st) => st.lines).map((x) => x.join(' '))) expect(l, l).not.toMatch(/방금 반말|반말이|말투|입이 먼저|제 입이/)
    }
  })

  it('메이의 말투는 멤버 단위다 — 매트 · 디렉터의 voice() 가 모두 MEMBER_VOICE.may 로 시작하고, 캐릭터 voice 에는 말투 규칙이 중복되어 있지 않다', () => {
    const memberVoice = P.MEMBER_VOICE.may!
    expect(memberVoice).toContain('말이 매우 길고')
    expect(memberVoice).toContain('해요체가 기본')
    expect(memberVoice).toContain('반말이 한두 마디 섞인다')
    expect(memberVoice).not.toContain('반말이 기본이 아니다')
    for (const id of ['met', 'mei']) {
      for (const stage of STAGES) expect(P.voice(id, stage).voice!.startsWith(memberVoice), id).toBe(true)
      const own = P.CHARACTERS[id]!.voice!
      expect(own, id).not.toMatch(/해요체|존댓말|수다|말풍선|조잘|반말|조용|임시/)
      expect(own.length, id).toBeLessThan(memberVoice.length / 3)
    }
    expect(P.voice('met', 0).voice).toContain('등껍질')
  })

})

describe('원이 대사의 유행어', () => {
  const lineTexts = (id: string, stage: number) => (P.CHARACTERS[id]!.stages as { lines: string[] }[])[stage]!.lines
  const hits = (line: string) => SHARED_WONI.filter((t) => line.includes(t))

  it('원이 대사 풀의 70% 이상이 유행어를 포함하고, 단계마다 7줄 중 5줄 이상이다', () => {
    for (const id of WONI_IDS) {
      const all = STAGES.flatMap((s) => lineTexts(id, s))
      expect(all.filter((l) => hits(l).length > 0).length / all.length, id).toBeGreaterThanOrEqual(0.7)
      for (const stage of STAGES) expect(lineTexts(id, stage).filter((l) => hits(l).length > 0).length, `${id} ${stage}`).toBeGreaterThanOrEqual(5)
    }
  })

  it('유행어가 고루 있고(단계마다 오이쉬에 · 밥은 줍니까? 2줄 이상, 살림은 캐릭터 풀에 1줄 이상) 한 줄에 둘은 없다', () => {
    for (const id of WONI_IDS)
      for (const stage of STAGES) {
        const lines = lineTexts(id, stage)
        const count = (t: string) => lines.filter((l) => l.includes(t)).length
        expect(count('오이쉬에'), `${id} ${stage}`).toBeGreaterThanOrEqual(2)
        expect(count('밥은 줍니까?'), `${id} ${stage}`).toBeGreaterThanOrEqual(2)
        for (const l of lines) expect(hits(l).length, l).toBeLessThanOrEqual(1)
      }
    // 살림 유행어는 길어서(4 어절) 2~3 어절 규정의 유일한 예외이므로 캐릭터마다 한 줄만 둔다
    for (const id of WONI_IDS) expect(STAGES.flatMap((s) => lineTexts(id, s)).filter((l) => l.includes('뭐고 살림 차리자는 거가')).length, id).toBe(1)
  })

  it('"오이쉬에" 는 기호가 다른 표기(오이쉬에!! 등)가 대사 풀에 두 줄 이상 섞여 있고, 한 줄에 같은 유행어가 두 번 나오지 않는다', () => {
    for (const id of WONI_IDS) {
      const all = STAGES.flatMap((s) => lineTexts(id, s))
      expect(all.filter((l) => l.includes('오이쉬에!!')).length, id).toBeGreaterThanOrEqual(2)
      expect(new Set(all.flatMap((l) => l.match(/오이쉬에[!~]*/g) ?? [])).size, id).toBeGreaterThanOrEqual(2)
      for (const l of all) expect((l.match(/오이쉬에/g) ?? []).length, l).toBeLessThanOrEqual(1)
    }
  })

  it('원이 풀에는 "~라" 어미 줄과 거제 일상 자랑 줄이 단계마다 1줄 이상 있고, 단답 · 유행어 5줄은 유지된다', () => {
    const lineTexts2 = (id: string, stage: number) => (P.CHARACTERS[id]!.stages as { lines: string[] }[])[stage]!.lines
    const words = (l: string) => l.trim().split(/\s+/).length
    for (const id of WONI_IDS)
      for (const stage of STAGES) {
        const lines = lineTexts2(id, stage)
        expect(lines.filter((l) => /[가-힣]라[.!?]?$/.test(l)).length, `${id} ${stage} ~라`).toBeGreaterThanOrEqual(1)
        expect(lines.filter((l) => /거제|바다|버스|다 안다/.test(l)).length, `${id} ${stage} 거제 자랑`).toBeGreaterThanOrEqual(1)
        expect(lines.filter((l) => hits(l).length > 0).length, `${id} ${stage}`).toBeGreaterThanOrEqual(5)
        expect(lines.filter((l) => words(l) >= 2 && words(l) <= 3).length, `${id} ${stage}`).toBeGreaterThanOrEqual(6)
        for (const l of lines) expect(l, l).not.toMatch(/[씨시]발|병신|새끼|꺼져|죽어|바보|멍청/)
      }
    // 말버릇 · 소재는 새 유행어가 아니다
    for (const id of WONI_IDS) expect(texts(id).some((t) => /라$|바다|버스/.test(t))).toBe(false)
    for (const id of WONI_IDS) {
      expect(P.voice(id, 0).voice, id).toContain('~라')
      expect(P.voice(id, 0).signatureNote, id).toContain('~라')
    }
  })

  it('원이는 2~3 단어로만 말한다 — 대사 풀의 90% 이상이 2~3 어절이고 최대 20자(긴 유행어 줄 하나만 예외)', () => {
    const words = (l: string) => l.trim().split(/\s+/).length
    for (const id of WONI_IDS) {
      const all = STAGES.flatMap((s) => lineTexts(id, s))
      expect(all.filter((l) => words(l) >= 2 && words(l) <= 3).length / all.length, id).toBeGreaterThanOrEqual(0.9)
      // 예외는 4 어절 유행어 줄 하나뿐 — 나머지는 모두 2~3 어절 · 20자 이하
      const rest = all.filter((l) => !l.includes('뭐고 살림 차리자는 거가'))
      for (const l of rest) {
        expect(words(l), l).toBeGreaterThanOrEqual(2)
        expect(words(l), l).toBeLessThanOrEqual(3)
        expect(l.length, l).toBeLessThanOrEqual(20)
      }
    }
  })

  it('원이의 멤버 공통 말투 · signatureNote · RULES 에 2~3 단어 규칙이 있다', () => {
    for (const id of WONI_IDS) {
      expect(P.voice(id, 0).voice).toContain('2~3 단어로만 답한다')
      expect(P.voice(id, 0).signatureNote).toContain('2~3 단어로만 답한다')
    }
    expect(P.RULES[0]).toContain('2~3 단어')
  })

  it('원이는 질문에 꼭 대답하지 않아도 되고, 성격은 무뚝뚝 · 퉁명 · 직설 · 츤데레가 아니다', () => {
    for (const id of WONI_IDS) {
      const v = P.voice(id, 1)
      expect(v.voice, id).toContain('대답하지 않아도')
      expect(v.signatureNote, id).toContain('꼭 답하지 않아도')
      expect(v.voice, id).toContain('차갑거나 퉁명스럽지 않다')
      expect([v.voice, v.stageTone, v.signatureNote].join(' ').replace('성격은 무뚝뚝하지 않다', '').replace('차갑거나 퉁명스럽지 않다', ''), id).not.toMatch(/무뚝뚝|퉁명|직설|츤데레/)
    }
  })

  it('원이의 signatureNote 는 유행어를 자주 쓰라고 하고(연속 같은 말 금지), RULES 의 길이는 40자 안팎이다', () => {
    for (const id of WONI_IDS) {
      const note = P.voice(id, 0).signatureNote!
      expect(note).toContain('자주 쓴다')
      expect(note).toContain('연속으로 같은 유행어는 쓰지 않는다')
    }
    expect(P.RULES[0]).toContain('40자 안팎')
  })
})

describe('유행어', () => {
  it('멤버 기본 3개가 같은 멤버의 모든 캐릭터에 있고, 추가분은 해당 캐릭터부터 이어진다', () => {
    expect(texts('met')).toEqual(SHARED_MAY)
    expect(texts('mei')).toEqual([...SHARED_MAY, '메이 중대장은 ○○에게 실망했다'])
    expect(texts('woni-a')).toEqual(SHARED_WONI)
    expect(texts('woni-b')).toEqual([...SHARED_WONI, '파아~'])
  })

  it('파이리원이의 "파아~" 는 flame 동작을 쓴다', () => {
    expect(P.voice('woni-b', 0).catchphrases?.find((c) => c.text === '파아~')?.action).toBe('flame')
    expect(P.ACTIONS).toContain('flame')
  })

  it('추가분은 누적된다 — 같은 멤버의 3번째 캐릭터에도 앞선 추가분이 따라온다 (다른 멤버에게는 새지 않는다)', () => {
    const base = P.CHARACTERS['woni-a']!
    const extra = (member: string, text: string): Character => ({ ...base, member, catchphrases: [{ text, usage: '임시' }] })
    P.CHARACTERS['tmp-may'] = extra('may', '임시 메이 말')
    P.CHARACTERS['tmp-woni'] = extra('woni', '임시 원이 말')
    P.CHARACTERS['tmp-other'] = extra('other', '임시 다른 멤버 말') // 기본 유행어가 없는 다른 멤버
    try {
      // 메이: 기본 3 + mei 의 추가분 + 자기 추가분
      expect(texts('tmp-may')).toEqual([...SHARED_MAY, '메이 중대장은 ○○에게 실망했다', '임시 메이 말'])
      // 원이: 기본 3 + woni-b 의 추가분 + 자기 추가분
      expect(texts('tmp-woni')).toEqual([...SHARED_WONI, '파아~', '임시 원이 말'])
      // 다른 멤버에게는 원이의 추가분이 새지 않고, 뒤 캐릭터의 추가분이 앞 캐릭터로 거슬러 가지도 않는다
      expect(texts('tmp-other')).toEqual(['임시 다른 멤버 말'])
      expect(texts('mei')).toEqual([...SHARED_MAY, '메이 중대장은 ○○에게 실망했다'])
      expect(texts('woni-a')).toEqual(SHARED_WONI)
      expect(texts('woni-b')).toEqual([...SHARED_WONI, '파아~'])
    } finally {
      delete P.CHARACTERS['tmp-may']
      delete P.CHARACTERS['tmp-woni']
      delete P.CHARACTERS['tmp-other']
    }
    expect(Object.keys(P.CHARACTERS)).toEqual(IDS)
  })

  it('voice().catchphrases 와 signatureNote 가 일치한다 — 목록의 말이 모두 안내에 있고 다른 멤버의 말은 없다', () => {
    for (const id of IDS) {
      const v = P.voice(id, 0)
      expect(v.signatureNote, id).toBeTruthy()
      for (const c of v.catchphrases!) {
        expect(v.signatureNote).toContain(`"${c.text}"`)
        expect(v.signatureNote).toContain(c.usage)
      }
      // 안내 문장의 따옴표 항목 수 = 목록 길이
      expect((v.signatureNote!.match(/"[^"]+"\(/g) ?? []).length).toBe(v.catchphrases!.length)
    }
    expect(P.voice('woni-a', 0).signatureNote).not.toContain('파아~') // 파이리원이 고유 추가분은 앞 캐릭터에 없다
    expect(P.voice('woni-a', 0).signatureNote).not.toContain('햇살')
    expect(P.voice('met', 0).signatureNote).not.toContain('오이쉬에')
    expect(P.voice('met', 0).signatureNote).not.toContain('중대장') // 디렉터 고유 추가분은 앞 캐릭터(매트)에 없다
    // 메이는 원이처럼 자주 쓰지 않고 상황에 맞을 때만 쓴다
    expect(P.voice('mei', 0).signatureNote).toContain('상황에 맞을 때만') // 나머지 유행어는 상황에 맞을 때만
    expect(P.voice('mei', 0).signatureNote).toContain('세 번 중 한 번') // 나쁜 어른 유행어만 자주
  })

  it('단계가 달라도 유행어 목록은 같다', () => {
    for (const id of IDS) expect(P.voice(id, 0).catchphrases).toEqual(P.voice(id, 2).catchphrases)
  })
})

describe('서비스의 say', () => {
  it('flame 동작을 받아 주고, 모르는 동작은 거절한다', async () => {
    // 서비스를 persona.js 째 묶어 가짜 host 에 올린다(service.test.ts 와 같은 방식)
    const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
    const bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default as (host: unknown) => never
    const saved = { v: 2, baseline: { tokens: 0, cacheRead: 0 }, active: 'woni', progress: {}, graduated: [{ id: 'woni-a', at: 1 }], names: {}, news: [], startedAt: 1 }
    const fake = createFakeHost({
      id: 'risene-pet',
      scope: 'app',
      events: ['usage.changed'],
      calls: { 'storage.get': () => saved, 'storage.set': () => true, 'usage.summary': () => ({ total: { tokens: 0, cacheRead: 0 }, today: { tokens: 0, turns: 0 } }) },
    })
    fake.mount(bundle)
    await fake.call('state')
    await fake.callTool('risene-pet_say', { text: '파아~', action: 'flame' }, { directory: '/work/a' })
    expect((fake.pushes().at(-1)?.data as { said: { action: string; by: { id: string } } }).said).toMatchObject({ action: 'flame', by: { id: 'woni-b' } })
    await expect(fake.callTool('risene-pet_say', { text: 'x', action: 'fly' }, { directory: '/work/a' })).rejects.toThrow()
  })
})
