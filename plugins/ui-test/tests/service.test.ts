// UI 테스트 서비스 — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 서비스는 서버(MCP)를 host.mcp.register 로 올리고 도구를 mcp.call 로 부르는 껍데기라 서버 쪽 동작은 workspace.test.ts 가 본다. 여기서는 중계 · 진행 밀어 보내기 · 감시 정리를 본다.
// 서비스 번들은 기록 저장소(host.db) 클라이언트를 가져오지 않는다 — 서버만 쓴다.
// 앱이 서비스를 올리고 패널이 service.call · service.progress 로 주고받는 것, 진짜 서버를 띄우는 것은 앱에서 확인한다(여기서 못 본다).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { PANEL_TOOLS, TOOL_NAMES } from '../server/tools.ts'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
const DIR = '/work/shop'

type McpCall = { tool: string; args: Record<string, unknown> }
let bundle: (host: unknown) => never
beforeAll(async () => {
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
})
afterEach(() => vi.useRealTimers())

/** 서버 도구를 흉내 낸다 — tools[이름](args) 가 { text } 또는 { text, isError } 를 돌려준다 */
function start(tools: Record<string, (args: Record<string, unknown>) => { text: string; isError?: boolean } | Promise<{ text: string; isError?: boolean }>>, exportFile?: (params: { path: string; name: string }) => unknown) {
  const calls: McpCall[] = []
  const store = new Map<string, unknown>()
  const fake = createFakeHost({
    id: 'ui-test',
    scope: 'project',
    calls: {
      'mcp.call': async (params) => {
        const { tool, args } = params as McpCall
        calls.push({ tool, args })
        const handler = tools[tool]
        return handler ? handler(args) : { text: `모르는 도구: ${tool}`, isError: true }
      },
      'storage.get': (params) => store.get((params as { key: string }).key) ?? null,
      'storage.set': (params) => void store.set((params as { key: string }).key, (params as { value: unknown }).value),
      'project.openFile': () => true,
      'chat.compose': () => true,
    },
  })
  fake.enableProject(DIR)
  // project.exportFile 은 시험이 저장 창 결과(저장 · 취소 · 오류)를 정하려고 그 호출만 가로챈다
  const exported: { path: string; name: string }[] = []
  fake.mount((host: { call: (method: string, params: unknown, options?: unknown) => Promise<unknown> }) =>
    bundle(exportFile ? { ...host, call: async (method: string, params: unknown, options?: unknown) => (method === 'project.exportFile' ? (exported.push(params as { path: string; name: string }), exportFile(params as { path: string; name: string })) : host.call(method, params, options)) } : host),
  )
  return { fake, calls, exported }
}

const progress = (running: boolean, done = 0) => ({ text: JSON.stringify({ running, title: 's', runId: 'r1', done }) })

describe('service', () => {
  it('실행기 서버를 올린다 — 설정 값은 ${storage:}, 비밀번호는 ${secret:} 로 env 에만, 인자에는 비밀이 없다', () => {
    const { fake } = start({})
    const [server, ...rest] = fake.mcpServers()
    expect(rest).toEqual([])
    expect(server).toMatchObject({ command: 'server/ui-test.mjs', idleMs: 1_800_000, timeoutMs: 1_800_000, panelTools: PANEL_TOOLS })
    expect(server?.env).toMatchObject({ UI_TEST_BASE_URL: '${storage:baseUrl}', UI_TEST_PASSWORD: '${secret:password}', UI_TEST_DATA_DIR: '${dataDir}' })
    expect(JSON.stringify(server?.args ?? [])).not.toContain('secret')
  })

  it('스킬 폴더를 올린다 — 이름은 SKILL.md 의 name 과 같고 manifest 에는 skills 선언이 없다', () => {
    const { fake } = start({})
    expect(fake.skills()).toEqual([{ name: 'ui-test', dir: 'skills/ui-test' }, { name: 'ui-test-run', dir: 'skills/ui-test-run' }])
    const skill = readFileSync(path.join(here, 'skills/ui-test/SKILL.md'), 'utf8')
    expect(/^name:\s*ui-test\s*$/m.test(skill)).toBe(true)
    expect(existsSync(path.join(here, 'skills/ui-test/references'))).toBe(true)
    const run = readFileSync(path.join(here, 'skills/ui-test-run/SKILL.md'), 'utf8')
    expect(/^name:\s*ui-test-run\s*$/m.test(run)).toBe(true)
    expect(existsSync(path.join(here, 'skills/ui-test-run/references/history.md'))).toBe(true)
    // _prompt.md 유무는 AI 가 짐작하지 않고 서버가 알려 준 값(list 의 prompt.exists · 요청 글의 (있음|없음))을 따른다
    expect(skill).toContain('prompt.exists')
    expect(skill).toContain('프로젝트 프롬프트: <path> (있음|없음)')
    expect(run).toContain('prompt.exists')
    expect(run).toContain('프로젝트 프롬프트: … (있음)')
    // 가이드는 요청 글의 산출물 줄을 따른다 — 정해져 있으면 묻지 않는다(설정을 AI 가 짐작하지 않는다)
    expect(run).toContain('산출물: 결과서 + 화면 가이드')
    expect(run).toContain('산출물: 결과서만')
    expect(run).toContain('lastGuide')
    const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.skills).toBeUndefined()
    // 서버(mcp) · 스킬을 서비스가 올리므로 manifest 에 tools · mcp · lsp 선언과 권한이 없다. 비밀번호는 secret 설정 칸 + 서버 env 라 secrets 권한도 필요 없다
    for (const field of ['tools', 'mcp', 'lsp']) expect(manifest[field]).toBeUndefined()
    expect(manifest.permissions).toEqual(['service', 'project', 'chat'])
  })

  it('패널이 부를 메서드를 올린다', () => {
    const { fake } = start({})
    expect(fake.names().sort()).toEqual(['ask', 'delete', 'detail', 'exportPdf', 'guide', 'list', 'openFile', 'prefs', 'progress', 'reindex', 'run', 'shot', 'stop'])
  })

  it('list · detail · delete · reindex 는 서버 도구의 JSON 을 풀어서, shot · stop 은 글 그대로 돌려준다 — 허용한 인자만 넘긴다', async () => {
    const { fake, calls } = start({
      list: () => ({ text: '{"scenarios":[],"cursor":"c2"}' }),
      detail: () => ({ text: '{"id":"a-01"}' }),
      delete: () => ({ text: '{"scenarios":["a-01"],"files":[],"runs":0}' }),
      reindex: () => ({ text: '{"added":1,"updated":0,"removed":0}' }),
      shot: () => ({ text: 'data:image/png;base64,AAA' }),
      stop: () => ({ text: 'ok' }),
    })
    expect(await fake.call('list', { screen: '/login', cursor: 'c1', evil: 1 }, { directory: DIR })).toEqual({ scenarios: [], cursor: 'c2' })
    expect(await fake.call('detail', { id: 'a-01' }, { directory: DIR })).toEqual({ id: 'a-01' })
    expect(await fake.call('delete', { scenarios: ['a-01'], failed: true }, { directory: DIR })).toEqual({ scenarios: ['a-01'], files: [], runs: 0 })
    expect(await fake.call('reindex', undefined, { directory: DIR })).toEqual({ added: 1, updated: 0, removed: 0 })
    expect(await fake.call('shot', { run: 'r1', name: 'a.png', x: 1 }, { directory: DIR })).toBe('data:image/png;base64,AAA')
    expect(await fake.call('stop', undefined, { directory: DIR })).toBe('ok')
    expect(calls).toEqual([
      { tool: 'list', args: { json: true, screen: '/login', cursor: 'c1' } },
      { tool: 'detail', args: { id: 'a-01' } },
      { tool: 'delete', args: { scenarios: ['a-01'] } },
      { tool: 'reindex', args: {} },
      { tool: 'shot', args: { run: 'r1', name: 'a.png' } },
      { tool: 'stop', args: {} },
    ])
  })

  it('서버가 isError 로 답하면 패널에 오류로 간다', async () => {
    const { fake } = start({ stop: () => ({ text: '수행 중이 아닙니다', isError: true }) })
    await expect(fake.call('stop', undefined, { directory: DIR })).rejects.toThrow('수행 중이 아닙니다')
  })

  it('run 은 기다리지 않고 시작만 알리고, 진행을 읽어 패널로 밀어 보낸다 — 끝나면 감시를 멈춘다', async () => {
    vi.useFakeTimers()
    let ticks = 0
    let release: () => void = () => undefined
    const runDone = new Promise<void>((resolve) => (release = resolve))
    const { fake, calls } = start({
      run: async () => (await runDone, { text: 'done' }),
      progress: () => progress(++ticks < 3, ticks),
    })
    expect(await fake.call('run', { screen: '/login', report: 'each', headed: true, evil: 1 }, { directory: DIR })).toEqual({ started: true })
    await vi.advanceTimersByTimeAsync(400) // 첫 읽기
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000) // 세 번째 — running false
    await vi.advanceTimersByTimeAsync(5000) // 더 읽지 않는다
    const pushes = fake.pushes().filter((p) => p.event === 'service.progress')
    expect(pushes.map((p) => (p.data as { running: boolean }).running)).toEqual([true, true, false])
    expect(pushes.every((p) => p.directory === DIR)).toBe(true)
    expect(calls.filter((c) => c.tool === 'progress')).toHaveLength(3)
    expect(calls.find((c) => c.tool === 'run')?.args).toEqual({ screen: '/login', headed: true }) // report · evil 은 걸러진다
    release()
  })

  it('run 이 실패하면 runError 소식으로 알린다', async () => {
    vi.useFakeTimers()
    const { fake } = start({ run: () => ({ text: '브라우저를 못 찾습니다', isError: true }), progress: () => progress(false) })
    await fake.call('run', { scenarios: ['a-01'] }, { directory: DIR })
    await vi.advanceTimersByTimeAsync(0)
    const error = fake.pushes().find((p) => p.event === 'service.runError')
    expect(error?.data).toEqual({ message: '브라우저를 못 찾습니다' })
  })

  it('프로젝트 없이 run 을 부르면 거절한다', async () => {
    const { fake } = start({})
    await expect(fake.call('run', { scenarios: ['a-01'] }, {})).rejects.toThrow()
  })

  it('패널을 다시 열었을 때 수행 중이면 progress 가 감시를 이어 간다', async () => {
    vi.useFakeTimers()
    let ticks = 0
    const { fake } = start({ progress: () => progress(++ticks < 3, ticks) })
    const state = await fake.call('progress', undefined, { directory: DIR })
    expect((state as { running: boolean }).running).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.pushes().filter((p) => p.event === 'service.progress').length).toBeGreaterThanOrEqual(1)
  })

  it('openFile · ask 는 앱 기능을 그 프로젝트로 부른다', async () => {
    const { fake } = start({})
    await fake.call('openFile', { path: '.litecode/plugins/ui-test/reports/a/index.html' }, { directory: DIR })
    await fake.call('ask', { text: '보강해 줘' }, { directory: DIR })
    expect(fake.calls).toEqual([
      { method: 'project.openFile', params: { path: '.litecode/plugins/ui-test/reports/a/index.html' }, directory: DIR },
      { method: 'chat.compose', params: { text: '보강해 줘', send: true }, directory: DIR },
    ])
  })

  it('ask — send: false 면 입력창만 채운다(변경 요청)', async () => {
    const { fake } = start({})
    await fake.call('ask', { text: '3 번 시나리오를 바꿔 줘:', send: false }, { directory: DIR })
    expect(fake.calls).toEqual([{ method: 'chat.compose', params: { text: '3 번 시나리오를 바꿔 줘:', send: false }, directory: DIR }])
  })

  it('prefs — 기본값(headed)을 그 프로젝트의 저장 칸에 두고 읽는다', async () => {
    const { fake } = start({})
    expect(await fake.call('prefs', undefined, { directory: DIR })).toEqual({})
    expect(await fake.call('prefs', { set: { headed: false } }, { directory: DIR })).toEqual({ headed: false })
    expect(await fake.call('prefs', undefined, { directory: DIR })).toEqual({ headed: false })
    expect(fake.calls.filter((c) => c.method === 'storage.set')).toEqual([{ method: 'storage.set', params: { key: 'prefs', value: { headed: false } }, directory: DIR }])
  })

  it('prefs — 산출물(output)은 report | both 만, 바뀐 것이 없으면 쓰지 않는다', async () => {
    const { fake } = start({})
    expect(await fake.call('prefs', { set: { output: 'both' } }, { directory: DIR })).toEqual({ output: 'both' })
    expect(await fake.call('prefs', { set: { output: 'pdf' } }, { directory: DIR })).toEqual({ output: 'both' })
    expect(await fake.call('prefs', { set: { headed: false, output: 'report' } }, { directory: DIR })).toEqual({ output: 'report', headed: false })
    expect(await fake.call('prefs', { set: { output: 'report' } }, { directory: DIR })).toEqual({ output: 'report', headed: false })
    expect(fake.calls.filter((c) => c.method === 'storage.set')).toHaveLength(2)
  })

  it('prefs — 결과서 방식(report)은 기억하지 않는다 — 늘 시나리오마다 따로', async () => {
    const { fake } = start({})
    expect(await fake.call('prefs', { set: { report: 'each' } }, { directory: DIR })).toEqual({})
    expect(fake.calls.filter((c) => c.method === 'storage.set')).toHaveLength(0)
  })

  it('guide — 서버의 guide 도구에 json 으로 부르고 파일 목록을 돌려준다', async () => {
    const { fake, calls } = start({ guide: () => ({ text: '{"files":[".litecode/plugins/ui-test/reports/r1/guide.html"]}' }) })
    expect(await fake.call('guide', { run: 'r1', x: 1 }, { directory: DIR })).toEqual({ files: ['.litecode/plugins/ui-test/reports/r1/guide.html'] })
    expect(calls).toEqual([{ tool: 'guide', args: { run: 'r1', json: true } }])
  })

  it('exportPdf — 서버가 만든 PDF 를 project.exportFile 로 저장 창에 넘기고, 저장 · 취소 · 오류를 값으로 돌려준다', async () => {
    const made = { text: '{"path":".litecode/plugins/ui-test/reports/r1/index.pdf","name":"결과서 - 로그인.pdf"}' }
    const saved = start({ pdf: () => made }, () => ({ saved: true, name: '내 결과서.pdf' }))
    expect(await saved.fake.call('exportPdf', { run: 'r1', kind: 'report', scenario: 'a-01', evil: 1 }, { directory: DIR })).toEqual({ saved: true, name: '내 결과서.pdf' })
    expect(saved.calls).toEqual([{ tool: 'pdf', args: { run: 'r1', kind: 'report', scenario: 'a-01' } }])
    expect(saved.exported).toEqual([{ path: '.litecode/plugins/ui-test/reports/r1/index.pdf', name: '결과서 - 로그인.pdf' }])
    const cancelled = start({ pdf: () => made }, () => ({ saved: false }))
    expect(await cancelled.fake.call('exportPdf', { run: 'r1', kind: 'report' }, { directory: DIR })).toEqual({ saved: false })
    for (const code of ['busy', 'export-limit', 'permission-missing', 'too-big']) {
      const failing = start({ pdf: () => made }, () => Promise.reject(Object.assign(new Error(code), { code })))
      expect(await failing.fake.call('exportPdf', { run: 'r1', kind: 'guide' }, { directory: DIR })).toEqual({ saved: false, code })
    }
  })

  it('exportPdf — 서버가 PDF 를 못 만들면 pdf-failed(글 포함), 옛 앱(알 수 없는 호출)이면 unsupported — 던지지 않는다', async () => {
    const broken = start({ pdf: () => ({ text: '인쇄 실패', isError: true }) }, () => ({ saved: true }))
    expect(await broken.fake.call('exportPdf', { run: 'r1', kind: 'report' }, { directory: DIR })).toEqual({ saved: false, code: 'pdf-failed', message: '인쇄 실패' })
    expect(broken.exported).toEqual([])
    const old = start({ pdf: () => ({ text: '{"path":"a.pdf","name":"a.pdf"}' }) }, () => Promise.reject(Object.assign(new Error('method-unknown'), { code: 'method-unknown' }))) // 옛 앱 — 가짜 host 는 이제 exportFile 을 알아서 같은 오류를 직접 낸다
    expect(await old.fake.call('exportPdf', { run: 'r1', kind: 'report' }, { directory: DIR })).toEqual({ saved: false, code: 'unsupported' })
  })

  it('스킬의 도구 이름 · 용어가 서버 도구와 일치한다 — AI 도구는 litecode_ui-test_<도구>, 패널 전용은 스킬에 없고, 묶음 문구가 없다', () => {
    const skill = readFileSync(path.join(here, 'skills/ui-test/SKILL.md'), 'utf8')
    const all = ['list', 'run', 'report', 'guide', 'fingerprint', 'newRequest']
    for (const name of all) expect(skill, name).toContain(`litecode_ui-test_${name}`)
    for (const name of PANEL_TOOLS) expect(skill, name).not.toContain(`litecode_ui-test_${name}`)
    const run = readFileSync(path.join(here, 'skills/ui-test-run/SKILL.md'), 'utf8')
    for (const name of ['list', 'run', 'report', 'guide']) expect(run, name).toContain(`litecode_ui-test_${name}`)
    for (const name of PANEL_TOOLS) expect(run, name).not.toContain(`litecode_ui-test_${name}`)
    const text = [skill, run, ...['formats.md', 'prompt-format.md', 'step-api.md'].map((file) => readFileSync(path.join(here, 'skills/ui-test/references', file), 'utf8')), readFileSync(path.join(here, 'skills/ui-test-run/references/history.md'), 'utf8')].join('\n')
    expect(text).not.toMatch(/suite\.md|묶음|돌려 줘|돌릴까요|\bsuite\b/)
  })

  it('실행 스킬을 따로 둔다 — ui-test 는 만들기 · 보강, 실행은 ui-test-run 으로 넘기고, ui-test-run 에 절차 · 수행 기록 규칙이 있다', () => {
    const skill = readFileSync(path.join(here, 'skills/ui-test/SKILL.md'), 'utf8')
    const run = readFileSync(path.join(here, 'skills/ui-test-run/SKILL.md'), 'utf8')
    // 실행: ui-test 는 언제 · 어떻게 넘기는지만, 절차는 ui-test-run 에만
    for (const phrase of ['## Running', '**without asking**', 'load the **`ui-test-run`** skill', 'don\'t call `litecode_ui-test_run` first']) expect(skill, phrase).toContain(phrase)
    expect(skill).not.toContain('Reproduce it yourself')
    expect(skill).not.toContain('## Data problems')
    for (const phrase of ['Go straight through, ask nothing', '/ui-test-run 아래 시나리오를 실행하고 결과를 알려 주세요.', '다음 수행 때 지킬 것', 'Reproduce it yourself', 'Solve it another way', 'ask the user with the question tool, one thing at a time', 'The user does not answer', '해결(다른 방법)', '해결(사용자 답변)', '가이드로도 만들까요?', 'always written per scenario', 'references/failures.md', 'references/history.md']) expect(run, phrase).toContain(phrase)
    const history = readFileSync(path.join(here, 'skills/ui-test-run/references/history.md'), 'utf8')
    for (const phrase of ['## 다음 수행 때 지킬 것', 'Summarize', 'Remove what no longer matters', '- 정리:', 'about **1500 characters**', '- 해결(다른 방법):', '- 해결(사용자 답변):']) expect(history, phrase).toContain(phrase)
    const failures = readFileSync(path.join(here, 'skills/ui-test-run/references/failures.md'), 'utf8')
    for (const phrase of ['at most 2 fix-and-rerun tries', 'The app is probably wrong', '데이터 막힘', 'SELECT only', 'The environment']) expect(failures, phrase).toContain(phrase)
  })

  it('스킬 머리(frontmatter) — name 은 폴더 이름, description 은 한 줄·트리거 문구·"Do NOT use" 가 있고, 두 스킬이 서로를 정확한 이름으로 가리킨다', () => {
    const read = (name: string) => readFileSync(path.join(here, 'skills', name, 'SKILL.md'), 'utf8')
    const head = (text: string) => {
      const match = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text)
      expect(match, '머리는 --- name · description ---').not.toBeNull()
      return { name: match![1]!, description: match![2]! }
    }
    const make = head(read('ui-test'))
    const run = head(read('ui-test-run'))
    expect(make.name).toBe('ui-test')
    expect(run.name).toBe('ui-test-run')
    for (const { description } of [make, run]) {
      expect(description.length).toBeGreaterThan(200)
      expect(description).toContain('Use ')
      expect(description).toContain('Do NOT use')
      expect(description).toMatch(/[가-힣]/) // 한국어 트리거 문구
    }
    expect(make.description).toContain('that is the `ui-test-run` skill')
    expect(run.description).toContain('that is the `ui-test` skill')
    expect(run.description).toContain('/ui-test-run') // 패널 요청이 이 이름으로 시작한다
    expect(make.description).not.toContain('/ui-test-run')
    expect(read('ui-test')).toContain('`ui-test-run`')
    expect(read('ui-test-run')).toContain('`ui-test` skill')
  })

  it('스킬이 부르는 도구 이름은 모두 TOOL_NAMES 에 있고 패널 전용이 아니며, 적어 둔 references 파일이 있다', () => {
    const dirs = ['ui-test', 'ui-test-run']
    const files = dirs.flatMap((dir) => [path.join('skills', dir, 'SKILL.md'), ...readdirSync(path.join(here, 'skills', dir, 'references')).map((name) => path.join('skills', dir, 'references', name))])
    for (const file of files) {
      const text = readFileSync(path.join(here, file), 'utf8')
      for (const match of text.matchAll(/litecode_ui-test_([A-Za-z]+)/g)) {
        expect(TOOL_NAMES, `${file}: ${match[0]}`).toContain(match[1])
        expect(PANEL_TOOLS, `${file}: ${match[0]}`).not.toContain(match[1])
      }
    }
    for (const dir of dirs) {
      const text = readFileSync(path.join(here, 'skills', dir, 'SKILL.md'), 'utf8')
      for (const match of text.matchAll(/references\/([A-Za-z-]+\.md)/g)) expect(existsSync(path.join(here, 'skills', dir, 'references', match[1]!)), `${dir}: ${match[0]}`).toBe(true)
    }
  })

  it('서비스 번들은 기록 저장소 클라이언트(서버 전용)를 가져오지 않는다', () => {
    const source = readFileSync(path.join(here, 'service/index.mjs'), 'utf8')
    expect(source).not.toMatch(/litecode-db-client|createDbClient|LITECODE_DB|host\.db\./)
    const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as { service: { api: number }; version: string }
    expect(manifest.service.api).toBe(2)
    expect(manifest.version).toBe('0.7.1')
  })

  it('prefs — 모르는 값이나 틀린 형태는 저장하지 않는다', async () => {
    const { fake } = start({})
    await fake.call('prefs', { set: { headed: false } }, { directory: DIR })
    expect(await fake.call('prefs', { set: { headed: 'no', other: 1 } }, { directory: DIR })).toEqual({ headed: false })
    expect(fake.calls.filter((c) => c.method === 'storage.set')).toHaveLength(1)
  })

  it('서비스를 내리면 감시가 걷힌다', async () => {
    vi.useFakeTimers()
    const { fake, calls } = start({ progress: () => progress(true) })
    await fake.call('progress', undefined, { directory: DIR })
    await fake.dispose()
    const before = calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(before)
  })
})
