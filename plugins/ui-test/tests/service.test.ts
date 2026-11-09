// UI 테스트 서비스 — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 서비스는 서버(MCP)를 host.mcp.register 로 올리고 도구를 mcp.call 로 부르는 껍데기라 서버 쪽 동작은 runner.test.ts 가 본다. 여기서는 중계 · 진행 밀어 보내기 · 감시 정리를 본다.
// 앱이 서비스를 올리고 패널이 service.call · service.progress 로 주고받는 것, 진짜 서버를 띄우는 것은 앱에서 확인한다(여기서 못 본다).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
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
function start(tools: Record<string, (args: Record<string, unknown>) => { text: string; isError?: boolean } | Promise<{ text: string; isError?: boolean }>>) {
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
  fake.mount(bundle)
  return { fake, calls }
}

const progress = (running: boolean, done = 0) => ({ text: JSON.stringify({ running, suite: 's', runId: 'r1', done }) })

describe('service', () => {
  it('실행기 서버를 올린다 — 설정 값은 ${storage:}, 비밀번호는 ${secret:} 로 env 에만, 인자에는 비밀이 없다', () => {
    const { fake } = start({})
    const [server, ...rest] = fake.mcpServers()
    expect(rest).toEqual([])
    expect(server).toMatchObject({ command: 'server/ui-test.mjs', idleMs: 1_800_000, timeoutMs: 1_800_000, panelTools: ['progress', 'stop', 'shot'] })
    expect(server?.env).toMatchObject({ UI_TEST_BASE_URL: '${storage:baseUrl}', UI_TEST_PASSWORD: '${secret:password}', UI_TEST_DATA_DIR: '${dataDir}' })
    expect(JSON.stringify(server?.args ?? [])).not.toContain('secret')
  })

  it('스킬 폴더를 올린다 — 이름은 SKILL.md 의 name 과 같고 manifest 에는 skills 선언이 없다', () => {
    const { fake } = start({})
    expect(fake.skills()).toEqual([{ name: 'ui-test', dir: 'skills/ui-test' }])
    const skill = readFileSync(path.join(here, 'skills/ui-test/SKILL.md'), 'utf8')
    expect(/^name:\s*ui-test\s*$/m.test(skill)).toBe(true)
    expect(existsSync(path.join(here, 'skills/ui-test/references'))).toBe(true)
    const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.skills).toBeUndefined()
    // 서버(mcp) · 스킬을 서비스가 올리므로 manifest 에 tools · mcp · lsp 선언과 권한이 없다. 비밀번호는 secret 설정 칸 + 서버 env 라 secrets 권한도 필요 없다
    for (const field of ['tools', 'mcp', 'lsp']) expect(manifest[field]).toBeUndefined()
    expect(manifest.permissions).toEqual(['service', 'project', 'chat'])
  })

  it('패널이 부를 메서드를 올린다', () => {
    const { fake } = start({})
    expect(fake.names().sort()).toEqual(['ask', 'guide', 'list', 'openFile', 'prefs', 'progress', 'run', 'shot', 'stop'])
  })

  it('list · shot · stop 은 서버 도구의 글을 그대로 돌려준다 (list 는 json 으로)', async () => {
    const { fake, calls } = start({ list: () => ({ text: '{"suites":[]}' }), shot: () => ({ text: 'data:image/png;base64,AAA' }), stop: () => ({ text: 'ok' }) })
    expect(await fake.call('list', undefined, { directory: DIR })).toBe('{"suites":[]}')
    expect(await fake.call('shot', { suite: 's', run: 'r1', name: 'a.png' }, { directory: DIR })).toBe('data:image/png;base64,AAA')
    expect(await fake.call('stop', undefined, { directory: DIR })).toBe('ok')
    expect(calls).toEqual([
      { tool: 'list', args: { json: true } },
      { tool: 'shot', args: { suite: 's', run: 'r1', name: 'a.png' } },
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
    expect(await fake.call('run', { suite: 's', headed: true }, { directory: DIR })).toEqual({ started: true })
    await vi.advanceTimersByTimeAsync(400) // 첫 읽기
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000) // 세 번째 — running false
    await vi.advanceTimersByTimeAsync(5000) // 더 읽지 않는다
    const pushes = fake.pushes().filter((p) => p.event === 'service.progress')
    expect(pushes.map((p) => (p.data as { running: boolean }).running)).toEqual([true, true, false])
    expect(pushes.every((p) => p.directory === DIR)).toBe(true)
    expect(calls.filter((c) => c.tool === 'progress')).toHaveLength(3)
    release()
  })

  it('run 이 실패하면 runError 소식으로 알린다', async () => {
    vi.useFakeTimers()
    const { fake } = start({ run: () => ({ text: '브라우저를 못 찾습니다', isError: true }), progress: () => progress(false) })
    await fake.call('run', { suite: 's' }, { directory: DIR })
    await vi.advanceTimersByTimeAsync(0)
    const error = fake.pushes().find((p) => p.event === 'service.runError')
    expect(error?.data).toEqual({ message: '브라우저를 못 찾습니다' })
  })

  it('프로젝트 없이 run 을 부르면 거절한다', async () => {
    const { fake } = start({})
    await expect(fake.call('run', { suite: 's' }, {})).rejects.toThrow()
  })

  it('패널을 다시 열었을 때 수행 중이면 progress 가 감시를 이어 간다', async () => {
    vi.useFakeTimers()
    let ticks = 0
    const { fake } = start({ progress: () => progress(++ticks < 3, ticks) })
    const text = await fake.call('progress', undefined, { directory: DIR })
    expect(JSON.parse(text as string).running).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.pushes().filter((p) => p.event === 'service.progress').length).toBeGreaterThanOrEqual(1)
  })

  it('openFile · ask 는 앱 기능을 그 프로젝트로 부른다', async () => {
    const { fake } = start({})
    await fake.call('openFile', { path: 'ui-tests/_reports/a/index.html' }, { directory: DIR })
    await fake.call('ask', { text: '보강해 줘' }, { directory: DIR })
    expect(fake.calls).toEqual([
      { method: 'project.openFile', params: { path: 'ui-tests/_reports/a/index.html' }, directory: DIR },
      { method: 'chat.compose', params: { text: '보강해 줘', send: true }, directory: DIR },
    ])
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

  it('guide — 서버의 guide 도구 결과를 그대로 돌려준다', async () => {
    const { fake, calls } = start({ guide: () => ({ text: '가이드: ui-tests/_reports/s/r1/guide.html' }) })
    expect(await fake.call('guide', { suite: 's', run: 'r1' }, { directory: DIR })).toBe('가이드: ui-tests/_reports/s/r1/guide.html')
    expect(calls).toEqual([{ tool: 'guide', args: { suite: 's', run: 'r1' } }])
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
