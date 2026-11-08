// 빛톨 키우기 MCP 서버 (0.2.0) — 의존성 없이 stdio 로 줄마다 JSON-RPC 하나를 주고받는다.
// 앱이 이 파일을 앱 실행 파일(Node)로 띄운다(ELECTRON_RUN_AS_NODE=1). 인자: <dataDir> — 플러그인 자료 폴더.
// 서버는 프로젝트마다 하나씩 뜨므로 빛톨 상태는 메모리가 아니라 dataDir 의 파일에 둔다:
//   state.json      — 패널이 sync 로 맞춰 둔 지금 빛톨
//   last-said.json  — AI 가 say 로 남긴 마지막 말 (패널이 last_said 로 읽어 말풍선으로 보인다)
// AI 용 도구: persona · say. 패널 전용(manifest mcp.panelTools): sync · last_said. stdout 은 MCP 통신 자리라 로그는 stderr 로.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

await import(new URL('./persona.js', import.meta.url))
const P = globalThis.TOKEN_PET_PERSONA

const dataDir = process.argv[2] || path.join(import.meta.dirname, '.data')
mkdirSync(dataDir, { recursive: true })
const STATE = path.join(dataDir, 'state.json')
const SAID = path.join(dataDir, 'last-said.json')
const TEXT_MAX = 200

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value))

const TOOLS = [
  {
    name: 'persona',
    description:
      "Get the user's current pet (빛톨) from the token-pet panel: its name, species, stage, nature, today's food and mood, and the speaking rules for its voice. Call this before answering as the pet.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'say',
    description: 'Show the line you just answered as the pet in its speech bubble on the token-pet panel, with one matching action.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: TEXT_MAX, description: "The pet's line, exactly as you answered." },
        action: { type: 'string', enum: P.ACTIONS, description: 'How the pet moves while saying it.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'sync',
    description: 'Panel only: store the current pet state.',
    inputSchema: { type: 'object', properties: { pet: { type: 'object' } }, required: ['pet'] },
  },
  {
    name: 'last_said',
    description: 'Panel only: the last line the pet said through say.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const ok = (text) => ({ content: [{ type: 'text', text }] })
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })

function mood(pet) {
  const today = Number(pet.todayTokens) || 0
  if (today >= 5_000_000) return '배부름'
  if (today >= 500_000) return '기분 좋음'
  return '배고픔'
}

const handlers = {
  persona() {
    const pet = readJson(STATE)
    if (!pet) return ok('아직 빛톨을 모릅니다. 패널에서 빛톨 키우기를 한 번 열어 주세요.')
    const stage = Number.isInteger(pet.stage) ? pet.stage : 0
    return ok(
      JSON.stringify({
        name: pet.name ?? null,
        species: pet.species ?? null,
        stage: pet.species ? stage + 1 : 0,
        nature: pet.nature ?? null,
        todayTokens: Number(pet.todayTokens) || 0,
        mood: mood(pet),
        graduated: Number(pet.graduated) || 0,
        ...P.voice(pet.species, stage, pet.nature),
      }),
    )
  },
  say(args) {
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (!text || text.length > TEXT_MAX) return fail(`text 는 1~${TEXT_MAX}자 글이어야 합니다.`)
    if (args.action !== undefined && !P.ACTIONS.includes(args.action)) return fail(`action 은 ${P.ACTIONS.join(', ')} 중 하나여야 합니다.`)
    writeJson(SAID, { text, ...(args.action && { action: args.action }), at: Date.now() })
    return ok('패널의 빛톨이 말했습니다.')
  },
  sync(args) {
    if (typeof args.pet !== 'object' || args.pet === null || Array.isArray(args.pet)) return fail('pet 은 객체여야 합니다.')
    writeJson(STATE, args.pet)
    return ok('ok')
  },
  last_said() {
    return ok(JSON.stringify(readJson(SAID)))
  },
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}
function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function handle(message) {
  const { id, method, params } = message
  if (id === undefined) return // 알림(notifications/initialized 등)
  if (method === 'initialize') {
    return respond(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'token-pet', version: '0.2.0' } })
  }
  if (method === 'ping') return respond(id, {})
  if (method === 'tools/list') return respond(id, { tools: TOOLS })
  if (method === 'tools/call') {
    const handler = handlers[params?.name]
    if (!handler) return respond(id, fail(`모르는 도구: ${params?.name}`))
    try {
      return respond(id, handler(params.arguments ?? {}))
    } catch (error) {
      console.error('[token-pet]', error)
      return respond(id, fail(error instanceof Error ? error.message : String(error)))
    }
  }
  respondError(id, -32601, `Method not found: ${method}`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return respondError(null, -32700, 'Parse error')
  }
  handle(message)
})
