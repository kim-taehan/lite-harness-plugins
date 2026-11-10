// UI 테스트 MCP 서버 입구 (#1248) — stdio. 앱이 plugin.json 의 mcp 선언대로 띄운다(작업 폴더 = 프로젝트, 앱 실행 파일을 Node 로).
// 같은 파일이 CI 명령도 된다: `node ui-test.mjs run [<시나리오>…] [--failed] [--screen <라우트>] [--request <요청 id>] [--each] [--headed|--headless]` — env 는 UI_TEST_BASE_URL · UI_TEST_BROWSER ·
// UI_TEST_USER · UI_TEST_PASSWORD · UI_TEST_DIR. 앱 밖이면 기록 저장소(host.db)가 없어 실행 · 결과서만 되고 기록 · 비교는 건너뛴다(--screen · --request · --failed 는 기록이 있어야 한다). 실패가 있으면 종료 코드 1

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { configFromEnv, scrub, type Config } from './config.ts'
import { createDbClient } from './db.ts'
import { driverFor } from './driver.ts'
import { Workspace } from './runner.ts'
import { createTools, runSummary, serverFileOf, TOOL_NAMES, type Tool } from './tools.ts'

function load(): { config?: Config; error?: string } {
  try {
    return { config: configFromEnv(process.env, realpathSync(process.cwd())) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** `--screen /a` 처럼 값이 붙는 옵션을 뽑고 나머지(시나리오 이름)를 돌려준다 */
export function parseCliArgs(args: string[]): { scenarios: string[]; screen?: string; request?: string; failed: boolean; each: boolean; headed: boolean } {
  const rest: string[] = []
  let screen: string | undefined
  let request: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--screen') screen = args[++index]
    else if (arg === '--request') request = args[++index]
    else if (!arg.startsWith('--')) rest.push(arg)
  }
  return { scenarios: rest, ...(screen && { screen }), ...(request && { request }), failed: args.includes('--failed'), each: args.includes('--each'), headed: args.includes('--headed') }
}

async function cli(args: string[]): Promise<number> {
  const { config, error } = load()
  if (!config) throw new Error(error)
  const parsed = parseCliArgs(args)
  const workspace = new Workspace(config, undefined, createDbClient())
  const outcome = await workspace.run({ ...(parsed.scenarios.length && { scenarios: parsed.scenarios }), ...(parsed.screen && { screen: parsed.screen }), ...(parsed.request && { request: parsed.request }), ...(parsed.failed && { failed: true }), ...(parsed.each && { report: 'each' as const }), headed: parsed.headed })
  console.log(scrub(runSummary(outcome, workspace), [config.password]))
  return outcome.run.cases.every((item) => item.status === 'passed') ? 0 : 1
}

async function serve(): Promise<void> {
  const { config, error } = load()
  const serverFile = serverFileOf(process.argv[1])
  // 프로젝트 없이 도구 목록만 물을 때는 DB 환경변수가 없어 undefined — 도구가 db-unavailable 로 답한다
  const workspace = config ? new Workspace(config, undefined, createDbClient()) : undefined
  const tools: Tool[] = config && workspace
    ? createTools({ workspace, checkDriver: () => driverFor('web', config), serverFile })
    : TOOL_NAMES.map((name) => ({ name, description: 'UI test plugin (settings are invalid).', inputSchema: { type: 'object', properties: {} }, run: async () => ({ text: `설정이 틀렸습니다 — ${error}`, isError: true }) }))
  const server = new Server({ name: 'ui-test', version: '0.7.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name)
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true }
    try {
      const result = await tool.run((request.params.arguments ?? {}) as Record<string, unknown>, extra.signal)
      return { content: [{ type: 'text', text: result.text }], ...(result.isError && { isError: true }) }
    } catch (caught) {
      return { content: [{ type: 'text', text: scrub(caught instanceof Error ? caught.message : String(caught), [config?.password ?? '']) }], isError: true }
    }
  })
  // 앱이 서버를 내리면(표준입력 닫힘 · 종료 신호) 도는 수행을 "중단됨" 으로 마무리하고(부분 결과서 · 이력) 끝낸다
  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    void (workspace?.interrupt('플러그인 서버가 내려감') ?? Promise.resolve(false)).finally(() => process.exit(0))
  }
  process.stdin.on('close', close)
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
  await server.connect(new StdioServerTransport())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2)
  const work = command === 'run' ? cli(rest).then((code) => process.exit(code)) : serve()
  work.catch((error: unknown) => {
    console.error(scrub(error instanceof Error ? error.message : String(error), [process.env['UI_TEST_PASSWORD'] ?? '']))
    process.exit(2)
  })
}
