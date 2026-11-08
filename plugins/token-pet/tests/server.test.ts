// 빛톨 키우기 MCP 서버(server.mjs)와 페르소나(persona.js) — 서버는 앱처럼 Node 로 띄워 stdio JSON-RPC 로 부른다
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const here = path.resolve(import.meta.dirname, '..')

type Persona = {
  ACTIONS: string[]
  react: (species: string | null, stage: number, nature: string | null, avoid?: string, rnd?: () => number) => { text: string; action: string }
  voice: (species: string | null, stage: number, nature: string | null) => { voice: string; actions: string[]; rules: string[] }
}
let P: Persona
beforeAll(async () => {
  await import(path.join(here, 'persona.js'))
  P = (globalThis as unknown as { TOKEN_PET_PERSONA: Persona }).TOKEN_PET_PERSONA
})

const open: { child: ChildProcessWithoutNullStreams; dir: string }[] = []
afterEach(() => {
  for (const { child, dir } of open.splice(0)) {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 서버 하나를 띄워 요청 → 답을 주고받는 함수를 돌려준다. dir 을 주면 그 자료 폴더를 같이 쓴다(서버 둘 = 프로젝트 둘) */
function server(dir = mkdtempSync(path.join(tmpdir(), 'token-pet-'))) {
  const child = spawn(process.execPath, [path.join(here, 'server.mjs'), dir], { stdio: ['pipe', 'pipe', 'pipe'] })
  open.push({ child, dir })
  const waiting = new Map<number, (value: Record<string, unknown>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as { id: number }
    waiting.get(message.id)?.(message)
  })
  let next = 0
  const rpc = (method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const { result } = (await rpc('tools/call', { name, arguments: args })) as { result: { content: { text: string }[]; isError?: boolean } }
    return { text: result.content[0].text, isError: result.isError === true }
  }
  return { rpc, tool, dir }
}

describe('server.mjs', () => {
  it('initialize 와 도구 4개', async () => {
    const s = server()
    const init = (await s.rpc('initialize', { protocolVersion: '2025-06-18' })) as { result: { serverInfo: { name: string } } }
    expect(init.result.serverInfo.name).toBe('token-pet')
    const list = (await s.rpc('tools/list')) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toEqual(['persona', 'say', 'sync', 'last_said'])
  })

  it('동기화 전 persona 는 패널을 열라고 안내한다 (실패 아님)', async () => {
    const result = await server().tool('persona')
    expect(result.isError).toBe(false)
    expect(result.text).toContain('패널에서 빛톨 키우기를 한 번 열어 주세요')
  })

  it('sync 한 빛톨을 persona 가 알려 준다 — 양은 "매에~", 거북은 충청도', async () => {
    const s = server()
    await s.tool('sync', { pet: { species: 'sheep', stage: 1, nature: '느긋한', name: '뭉게양', todayTokens: 6_000_000, graduated: 2 } })
    const sheep = JSON.parse((await s.tool('persona')).text)
    expect(sheep).toMatchObject({ name: '뭉게양', species: 'sheep', stage: 2, nature: '느긋한', mood: '배부름', graduated: 2 })
    expect(sheep.voice).toContain('매에~')
    await s.tool('sync', { pet: { species: 'turtle', stage: 0, nature: '차분한', name: '온돌북', todayTokens: 0 } })
    const turtle = JSON.parse((await s.tool('persona')).text)
    expect(turtle.voice).toContain('충청도')
    expect(turtle.mood).toBe('배고픔')
  })

  it('say 가 남긴 말을 last_said 가 돌려준다 — 다른 프로젝트의 서버도 같은 자료 폴더라 같이 본다', async () => {
    const a = server()
    expect(JSON.parse((await a.tool('last_said')).text)).toBeNull()
    expect((await a.tool('say', { text: '따뜻해서 좋구먼유~', action: 'nod' })).isError).toBe(false)
    const b = server(mkdtempSync(path.join(tmpdir(), 'token-pet-'))) // 다른 폴더면 따로
    expect(JSON.parse((await b.tool('last_said')).text)).toBeNull()
    const said = JSON.parse((await server(a.dir).tool('last_said')).text)
    expect(said).toMatchObject({ text: '따뜻해서 좋구먼유~', action: 'nod' })
    expect(typeof said.at).toBe('number')
  })

  it('say 는 모르는 action · 빈 글 · 너무 긴 글을 거절한다', async () => {
    const s = server()
    expect((await s.tool('say', { text: '안녕', action: 'fly' })).isError).toBe(true)
    expect((await s.tool('say', { text: '   ' })).isError).toBe(true)
    expect((await s.tool('say', { text: 'x'.repeat(201) })).isError).toBe(true)
    expect(JSON.parse((await s.tool('last_said')).text)).toBeNull()
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

  it('행동은 정해 둔 것 중 하나, 알은 소리만', () => {
    for (let i = 0; i < 50; i++) expect(P.ACTIONS).toContain(P.react('turtle', 2, '수줍은').action)
    expect(P.voice(null, 0, null).voice).toContain('말을 못 한다')
  })
})
