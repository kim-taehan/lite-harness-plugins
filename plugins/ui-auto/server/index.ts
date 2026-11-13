// UI-AUTO MCP 서버 입구 — stdio. 서비스가 host.mcp.register 로 올리고 앱이 앱의 Node 로 띄운다(작업 폴더 = 프로젝트).
// AI 에 보이는 도구: 동봉한 Playwright MCP 의 browser_* (중계) + begin(작업 시작 정보) + format · guide · capture(동작 위치를 표시한 단계 캡처) + login(세션 새로 받기).
// 패널만 부르는 도구(서비스의 panelTools): list · detail · replay · progress · stop · view · pdf · shot · report · guide_read · delete. [연결 확인]: check.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { cp, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, login } from './auth.ts'
import { Browser, CONVERSATION_META, markedShot, OTHER_CONVERSATION, type Mark, type ToolInfo, type ToolResult } from './browser.ts'
import { configFromEnv, EVIDENCE_DIR, FRESH_DAYS, guardWrite, loginReady, loginState, scrub, stamp, type Config } from './config.ts'
import { Evidence, failStep } from './evidence.ts'
import { table, updateRow } from './markdown.ts'
import { statusesOf, touchMap } from './record.ts'
import { renderDoc, renderPdf, writeAtomic, type DocKind } from './render.ts'
import { Replayer } from './replay.ts'
import { writeGuide } from './guide.ts'

export const PANEL_TOOLS = ['list', 'detail', 'replay', 'progress', 'stop', 'view', 'pdf', 'shot', 'report', 'guide_read', 'delete']

interface OwnTool extends ToolInfo {
  /** conversation: 부른 대화 id(앱이 `_meta` 에 실었을 때) — 브라우저를 쓰는 도구가 대화끼리 잠그는 데 쓴다 */
  run(args: Record<string, unknown>, conversation?: string): Promise<ToolResult>
}

const text = (value: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: value }], ...(isError && { isError: true }) })
const json = (value: unknown): ToolResult => text(JSON.stringify(value))
/** capture 도구가 쓰는 자리 — 증적 폴더의 captures/<page_id>/ 아래 png 만 */
const CAPTURE_FILE = new RegExp(`^${EVIDENCE_DIR.replaceAll('.', '\\.')}/captures/[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_.-]*\\.png$`)
/** 패널로 보내는 캡처 한 장의 상한 */
const SHOT_MAX = 6_000_000

/** 다음 번호 — `<접두><YYYYMMDD>-NNN`, 폴더들의 파일 이름과 이 서버가 이미 나눠 준 것보다 하나 크게 */
export class Ids {
  private given = new Set<string>()
  constructor(private readonly evidence: Evidence) {}

  async next(prefix: string, folders: string[], date = stamp().compact): Promise<string> {
    const head = `${prefix}${date}-`
    let max = 0
    const names = (await Promise.all(folders.map((folder) => readdir(this.evidence.file(folder)).catch(() => [] as string[])))).flat()
    for (const name of [...names, ...this.given]) {
      if (!name.startsWith(head)) continue
      const number = Number(/^(\d{3})/.exec(name.slice(head.length))?.[1])
      if (number > max) max = number
    }
    const id = `${head}${String(max + 1).padStart(3, '0')}`
    this.given.add(id)
    return id
  }
}

/** format 도구가 돌려주는 형식 — ui-auto-evidence 스킬의 절 제목(앞부분) */
const FORMAT_HEADINGS = { system_map: '### system_map.md', page: '### Page doc', run_log: '### Run log', report: '### Report', script: '### TC script', route: '### Navigation script', lessons: '## 7. Lessons learned' } as const
export const FORMAT_KINDS = Object.keys(FORMAT_HEADINGS) as (keyof typeof FORMAT_HEADINGS)[]

/** 스킬 md 에서 한 절 — 코드 블록 안의 제목은 절 경계로 보지 않는다. 다음 같은 단계 이상의 제목 앞까지 */
export function formatSection(skill: string, kind: string): string | undefined {
  const heading = (FORMAT_HEADINGS as Record<string, string>)[kind]
  if (!heading) return undefined
  const level = heading.indexOf(' ')
  const lines = skill.split('\n')
  let fence = false
  let start = -1
  for (const [index, line] of lines.entries()) {
    if (/^```/.test(line)) fence = !fence
    if (fence) continue
    const match = /^(#{2,3}) /.exec(line)
    if (start < 0) {
      if (line.startsWith(heading)) start = index
    } else if (match && match[1]!.length <= level) {
      return lines.slice(start, index).join('\n').trim()
    }
  }
  return start < 0 ? undefined : lines.slice(start).join('\n').trim()
}

/** 세션 파일에 쿠키가 있나 — 빈 세션(로그인 없이 쓰는 대상)은 저장된 것으로 보지 않는다 */
async function sessionSaved(file: string): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(file, 'utf8')) as { cookies?: unknown[] }
    return Array.isArray(state.cookies) && state.cookies.length > 0
  } catch {
    return false
  }
}

/** lessons-learned.md 의 색인 줄 — 같은 동작이 두 번 실패하면 AI 가 여기서 찾아 그 항목을 읽는다 */
export async function lessonsIndex(evidence: Evidence): Promise<string> {
  const rows = table((await evidence.read('lessons-learned.md')) ?? '', '색인').filter((row) => row['id'])
  return rows.length ? '\n' + rows.map((row) => `  ${row['id']} [${row['분류'] ?? ''}] ${row['한 줄 요약'] ?? ''} (${row['관련 page_id'] ?? ''})`).join('\n') : '해당 없음'
}

/** 증적 폴더가 없으면 빈 틀(system_map · 페이지 틀 · testdata · 하위 폴더)을 둔다 — 있는 파일은 건드리지 않는다 */
export async function ensureEvidence(config: Config): Promise<boolean> {
  const created = !existsSync(path.join(config.evidenceDir, 'system_map.md'))
  // 있는 파일은 덮지 않고 빠진 것만(나중 버전에 더한 lessons-learned.md 같은 것도) 채운다
  await guardWrite(config, config.evidenceDir)
  await cp(path.join(config.extensionDir, 'assets', 'skeleton'), config.evidenceDir, { recursive: true, force: false, errorOnExist: false })
  return created
}

export function createTools(config: Config, browser: Browser, evidence = new Evidence(config.evidenceDir, undefined, config.testdata)): { own: OwnTool[]; replayer: Replayer } {
  const ids = new Ids(evidence)
  const replayer = new Replayer(config, evidence, browser, () => ids.next('', ['logs', 'reports']))
  const kindOf = (value: unknown): DocKind => {
    if (value === 'report' || value === 'guide') return value
    throw new Error('kind 는 report | guide')
  }
  const own: OwnTool[] = [
    {
      name: 'begin',
      description:
        'Call this FIRST in every ui-auto task (test run, TC derivation, question, guide), before reading evidence or using a browser tool. Creates the evidence folder skeleton when missing and returns: run_id for this task (and guide_id when kind is "guide"), the current date-time, the base URL, the evidence folder, the freshness limit, the non-secret test data values of testdata.md, the login state, and a 브라우저 line when another conversation of this project is using the browser (then stop and tell the user). Never guess these values yourself.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['run', 'derive', 'query', 'guide'], description: 'What this task is' } }, required: ['kind'] },
      async run(args, conversation) {
        const created = await ensureEvidence(config)
        const now = stamp()
        const runId = await ids.next('', ['logs', 'reports'], now.compact)
        const guideId = args['kind'] === 'guide' ? await ids.next('guide-', ['guides'], now.compact) : undefined
        const data = await evidence.testdata()
        const names = Object.keys(data)
        const from = await evidence.testdataSources()
        return text(
          [
            `run_id: ${runId}`,
            ...(guideId ? [`guide_id: ${guideId}`] : []),
            `일시: ${now.minute}`,
            `오늘: ${now.date}`,
            `base URL: ${config.baseUrl || '(설정에 없음 — 사용자에게 묻기)'}`,
            `증적 폴더: ${EVIDENCE_DIR}/${created ? ' (방금 빈 틀을 만들었음)' : ''}`,
            `신선도 기준일: ${FRESH_DAYS}일`,
            `테스트 데이터: ${names.length ? names.map((name) => `${name}=${data[name]}${from.settings.includes(name) ? ' (플러그인 설정)' : ''}`).join(', ') : '해당 없음 — 필요한 입력값은 TC 내용으로 제안하고 사용자에게 한 번 묻는다'}`,
            `교훈 색인 (${EVIDENCE_DIR}/lessons-learned.md): ${await lessonsIndex(evidence)}`,
            `로그인: ${loginState(config.login)}${loginReady(config.login) ? ` · 세션 ${(await sessionSaved(config.stateFile)) ? '저장되어 있음' : '없음 — 브라우저를 열기 전에 login 도구'}` : ''}`,
            ...(browser.heldByOther(conversation) ? [`브라우저: ${OTHER_CONVERSATION}`] : []),
          ].join('\n'),
        )
      },
    },
    {
      name: 'format',
      description:
        'Returns one UI-AUTO evidence file format (the exact headings, columns and an example) from the ui-auto-evidence skill. Call it whenever you need a format again in the middle of a task, instead of searching for or reading the skill file. Never look for files outside the project.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: [...FORMAT_KINDS] } }, required: ['kind'] },
      async run(args) {
        const kind = String(args['kind'] ?? '')
        const found = formatSection(readFileSync(path.join(config.extensionDir, 'skills', 'ui-auto-evidence', 'SKILL.md'), 'utf8'), kind)
        return found ? text(found) : text(`kind 는 ${FORMAT_KINDS.join(' | ')}`, true)
      },
    },
    {
      name: 'guide',
      description:
        'Write the test guide of one TC (guides/guide-<tc_id>.md, a step-by-step document for people, different from the report) from its newest passed report. Call it right after you wrote the report of a passed run. Returns the guide path.',
      inputSchema: { type: 'object', properties: { tc: { type: 'string' } }, required: ['tc'] },
      async run(args) {
        const made = await writeGuide(config, evidence, String(args['tc'] ?? ''))
        return json(made)
      },
    },
    {
      name: 'capture',
      description:
        'Take a step capture of the target page. Call it right BEFORE each test step with step = the step number and targets = the target locator(s) and element name(s) that step will act on: it draws a red numbered box around them, saves the screenshot to file and removes the box. Call it once more without targets after the verify for the verdict screen. file: .litecode/ui-auto/captures/<page_id>/<run_id>-<tc_id>-step<NN>.png',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          step: { type: 'integer', minimum: 1 },
          targets: { type: 'array', items: { type: 'object', properties: { target: { type: 'string', description: 'Locator as in the script, for example getByRole(\'button\', { name: \'저장\' })' }, element: { type: 'string' } }, required: ['target'] } },
        },
        required: ['file'],
      },
      async run(args, conversation) {
        const file = String(args['file'] ?? '')
        if (!CAPTURE_FILE.test(file)) return text(`file 은 ${EVIDENCE_DIR}/captures/<page_id>/<이름>.png 이어야 합니다`, true)
        const marks: Mark[] = (Array.isArray(args['targets']) ? args['targets'] : []).flatMap((item: { target?: unknown; element?: unknown }) => (typeof item?.target === 'string' && item.target ? [{ target: item.target, ...(typeof item.element === 'string' && { element: item.element }) }] : []))
        const { result, marked } = await markedShot({ call: (name, input) => browser.relay(name, input, conversation) }, file, marks, typeof args['step'] === 'number' ? args['step'] : undefined)
        if (result.isError) return result
        return text(`캡처 ${file} — ${marks.length ? `동작 위치 ${marked}/${marks.length}곳 표시` : '표시 없음'}`)
      },
    },
    {
      name: 'login',
      description:
        'Log in to the system under test with the account in the plugin settings and save the session. You never see or type the password. Call it when a browser tool shows the login screen, or when begin says there is no saved session. It closes an open browser window, so call browser_navigate again afterwards.',
      inputSchema: { type: 'object', properties: {} },
      async run(_args, conversation) {
        if (browser.holder() === 'panel') return text('UI-AUTO 패널에서 TC 를 수행하는 중입니다. 끝난 뒤 다시 부르세요.', true)
        // 로그인은 열린 창을 닫는다 — 다른 대화가 쓰는 창을 닫지 않게
        if (browser.heldByOther(conversation)) return text(OTHER_CONVERSATION, true)
        if (!loginReady(config.login)) return text(`${await login(config)} 사용자에게 이 내용을 그대로 알리고 멈추세요.`, Boolean(config.login.user || config.login.password))
        const message = await login(config)
        await browser.closeWindow()
        return text(`${message}\n브라우저 창을 닫았습니다. browser_navigate 로 다시 여세요.`)
      },
    },
    {
      name: 'check',
      description: 'Settings check ([연결 확인]): opens the base URL with a headless browser and tries the login when it is set.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const result = await check(config)
        return text(result.text, !result.ok)
      },
    },
    {
      name: 'list',
      description: 'Panel only: pages with their TCs, recent reports, guides and state as JSON.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const ready = existsSync(path.join(config.evidenceDir, 'system_map.md'))
        if (ready) await ensureEvidence(config)
        const pages = await evidence.pages()
        for (const page of pages) {
          for (const tc of page.tcs) Object.assign(tc, { runnable: await evidence.runnable(tc) })
        }
        return json({
          ready,
          evidence: EVIDENCE_DIR,
          baseUrl: config.baseUrl,
          login: { configured: loginReady(config.login), saved: await sessionSaved(config.stateFile), state: loginState(config.login) },
          busy: browser.holder() ?? null,
          pages,
          flow: await evidence.flow(pages),
          lessons: table((await evidence.read('lessons-learned.md')) ?? '', '색인').filter((row) => row['id']),
          reports: await evidence.reports(),
          guides: await evidence.guides(),
        })
      },
    },
    {
      name: 'detail',
      description: 'Panel only: one TC with its 상세, 확인 사항 and 수행 이력 as JSON.',
      inputSchema: { type: 'object', properties: { tc: { type: 'string' } }, required: ['tc'] },
      async run(args) {
        const tc = await evidence.tc(String(args['tc'] ?? ''))
        if (!tc) return text(`TC 를 찾지 못했습니다: ${String(args['tc'])}`, true)
        return json({ ...tc, runnable: await evidence.runnable(tc) })
      },
    },
    {
      name: 'replay',
      description: 'Panel only: replay the scripts of the given TCs one by one without the LLM and record evidence. Returns at once; read progress.',
      inputSchema: { type: 'object', properties: { tcs: { type: 'array', items: { type: 'string' } } }, required: ['tcs'] },
      async run(args) {
        const tcs = Array.isArray(args['tcs']) ? args['tcs'].map(String).filter(Boolean) : []
        if (!tcs.length) return text('tcs 가 필요합니다', true)
        await ensureEvidence(config)
        const started = replayer.start(tcs)
        if (started.started) void started.done.catch(() => undefined)
        return json(started.started ? { started: true } : started)
      },
    },
    { name: 'progress', description: 'Panel only: progress of the panel replay as JSON.', inputSchema: { type: 'object', properties: {} }, run: async () => json(replayer.progress()) },
    { name: 'stop', description: 'Panel only: stop the panel replay after the current step.', inputSchema: { type: 'object', properties: {} }, run: async () => json({ stopped: replayer.stop() }) },
    {
      name: 'shot',
      description: 'Panel only: one capture image under the evidence folder as a data: URL.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(args) {
        const relative = String(args['path'] ?? '')
        const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(relative).toLowerCase()]
        if (!type || !relative.startsWith('captures/')) return text('captures/ 아래 이미지만 읽습니다', true)
        const bytes = await readFile(evidence.file(relative)).catch(() => undefined)
        if (!bytes) return text(`캡처가 없습니다: ${relative}`, true)
        if (bytes.length > SHOT_MAX) return text(`캡처가 너무 큽니다(${Math.round(bytes.length / 1e6)}MB): ${relative}`, true)
        return json({ path: relative, url: `data:${type};base64,${bytes.toString('base64')}` })
      },
    },
    {
      name: 'report',
      description: 'Panel only: one report md parsed for the panel (head, sections, steps with action/expected/actual/verdict), its failing step and the previous passed report of the same TC as JSON.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args) {
        const id = String(args['id'] ?? '')
        const view = await evidence.report(id)
        if (!view) return text(`보고서가 없습니다: ${id}`, true)
        const fail = failStep(view)
        const before = await evidence.previousPass(id)
        return json({ ...view, ...(fail && { failStep: fail }), ...(before && { previousPass: { id: before.id, at: before.head['일시'] ?? '', steps: before.steps.map((step) => ({ title: step.title, ...(step.capture && { capture: step.capture }) })) } }) })
      },
    },
    {
      name: 'guide_read',
      description: 'Panel only: one test guide md parsed for the panel (overview table, sections with text, images and steps) as JSON.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args) {
        const view = await evidence.guide(String(args['id'] ?? ''))
        return view ? json(view) : text(`가이드가 없습니다: ${String(args['id'])}`, true)
      },
    },
    {
      name: 'delete',
      description: 'Panel only: retire a TC — set its 상태 to 폐기 (tc numbers are never reused) and, when script is true, delete its script file.',
      inputSchema: { type: 'object', properties: { tc: { type: 'string' }, script: { type: 'boolean' } }, required: ['tc'] },
      async run(args) {
        if (browser.holder() === 'panel') return text('패널 수행 중에는 지울 수 없습니다', true)
        const id = String(args['tc'] ?? '')
        const page = (await evidence.pages()).find((candidate) => candidate.tcs.some((tc) => tc.id === id))
        const tc = page?.tcs.find((candidate) => candidate.id === id)
        if (!page || !tc) return text(`TC 를 찾지 못했습니다: ${id}`, true)
        const removeScript = args['script'] === true && tc.script !== undefined && /^scripts\/[^/]+\/[^/]+\.yaml$/.test(tc.script) && !tc.script.startsWith('scripts/routes/')
        const doc = (await evidence.read(page.doc)) ?? ''
        const next = updateRow(doc, '테스트 케이스', id, { 상태: '폐기', ...(removeScript && { 스크립트: '-', '스크립트 상태': '없음' }) })
        if (next === undefined) return text(`페이지 문서에서 ${id} 줄을 찾지 못했습니다`, true)
        await writeAtomic(config, evidence.file(page.doc), next)
        if (removeScript) {
          await guardWrite(config, evidence.file(tc.script!))
          await rm(evidence.file(tc.script!), { force: true })
        }
        const map = await evidence.read('system_map.md')
        if (map !== undefined) {
          const touched = touchMap(map, { page: page.id, edges: [], date: stamp().date, statuses: statusesOf(next), arrived: false })
          if (touched !== map) await writeAtomic(config, evidence.file('system_map.md'), touched)
        }
        return json({ retired: id, scriptRemoved: removeScript })
      },
    },
    {
      name: 'view',
      description: 'Panel only: render a report or guide md to one HTML file and return its project-relative path.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['report', 'guide'] }, id: { type: 'string' } }, required: ['kind', 'id'] },
      async run(args) {
        const { path: relative, title } = await renderDoc(config, evidence, kindOf(args['kind']), String(args['id'] ?? ''))
        return json({ path: relative, title })
      },
    },
    {
      name: 'pdf',
      description: 'Panel only: render a report or guide to PDF and return { path (project-relative), name }.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['report', 'guide'] }, id: { type: 'string' } }, required: ['kind', 'id'] },
      run: async (args) => json(await renderPdf(config, evidence, kindOf(args['kind']), String(args['id'] ?? ''))),
    },
  ]
  return { own, replayer }
}

async function serve(): Promise<void> {
  const extensionDir = path.resolve(path.dirname(process.argv[1]!), '..')
  const config = configFromEnv(process.env, realpathSync(process.cwd()), extensionDir)
  const browser = new Browser(config)
  const { own } = createTools(config, browser)
  const secrets = [config.login.password]
  const server = new Server({ name: 'ui-auto', version: readVersion(extensionDir) }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // 실패하면 던진다 — 앱은 도구 목록을 버전마다 한 번 기억하므로 browser_* 없이 기억되면 안 된다
    const relayed = await browser.tools()
    return { tools: [...relayed, ...own].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
  })
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const meta = request.params._meta?.[CONVERSATION_META]
    const conversation = typeof meta === 'string' && meta ? meta : undefined
    try {
      const tool = own.find((candidate) => candidate.name === name)
      const result = tool ? await tool.run(args, conversation) : name.startsWith('browser_') ? await browser.relay(name, args, conversation) : text(`Unknown tool: ${name}`, true)
      return { ...result, content: result.content.map((part) => (typeof part.text === 'string' ? { ...part, text: scrub(part.text, secrets) } : part)) }
    } catch (error) {
      return text(scrub(error instanceof Error ? error.message : String(error), secrets), true)
    }
  })
  let closing = false
  const close = (): void => {
    if (closing) return
    closing = true
    void browser.shutdown().finally(() => process.exit(0))
  }
  process.stdin.on('close', close)
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
  await server.connect(new StdioServerTransport())
}

function readVersion(dir: string): string {
  try {
    return String((JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as { version?: string }).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve().catch((error: unknown) => {
    console.error(scrub(error instanceof Error ? error.message : String(error), [process.env['UI_AUTO_PASSWORD'] ?? '']))
    process.exit(2)
  })
}
