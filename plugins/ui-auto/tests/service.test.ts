// UI-AUTO 서비스 — 앱 없이 SDK 의 가짜 host 로 본다. 서버 쪽 동작은 tools · replay 시험이 본다
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { PANEL_TOOLS } from '../server/index.ts'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
const DIR = '/work/shop'
type McpCall = { tool: string; args: Record<string, unknown> }
let bundle: (host: unknown) => never
beforeAll(async () => {
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
})

function start(tools: Record<string, (args: Record<string, unknown>) => { text: string; isError?: boolean }>, extra: Record<string, (params: unknown) => unknown> = {}) {
  const calls: McpCall[] = []
  const fake = createFakeHost({
    id: 'ui-auto',
    scope: 'project',
    calls: {
      'mcp.call': async (params) => {
        const { tool, args } = params as McpCall
        calls.push({ tool, args })
        return tools[tool] ? tools[tool]!(args) : { text: `모르는 도구: ${tool}`, isError: true }
      },
      'project.openFile': () => true,
      'chat.compose': () => true,
      'panel.open': () => true,
      'panel.fullscreen': () => true,
      ...extra,
    },
  })
  fake.enableProject(DIR)
  fake.mount(bundle as never)
  return { fake, calls }
}

describe('service', () => {
  it('서버를 올린다 — 설정은 ${storage:}, 비밀번호는 ${secret:} 로 env 에만, 세션은 ${projectDataDir}', () => {
    const { fake } = start({})
    const [server, ...rest] = fake.mcpServers()
    expect(rest).toEqual([])
    expect(server).toMatchObject({ command: 'server/ui-auto.mjs', panelTools: PANEL_TOOLS })
    expect(server?.env).toMatchObject({ UI_AUTO_BASE_URL: '${storage:baseUrl}', UI_AUTO_PASSWORD: '${secret:password}', UI_AUTO_STATE_DIR: '${projectDataDir}' })
    expect(JSON.stringify(server?.args ?? [])).not.toContain('secret')
  })

  it('스킬 여섯 — 폴더 · SKILL.md name 이 같다', () => {
    const { fake } = start({})
    const names = fake.skills().map((skill) => skill.name)
    expect(names).toEqual(['ui-auto', 'ui-auto-evidence', 'ui-auto-run', 'ui-auto-tc', 'ui-auto-ask', 'ui-auto-guide'])
    for (const name of names) {
      const text = readFileSync(path.join(here, 'skills', name, 'SKILL.md'), 'utf8')
      expect(new RegExp(`^name: ${name}$`, 'm').test(text), name).toBe(true)
      // 스킬이 쓰는 도구 이름은 앱이 붙이는 이름 그대로
      expect(text).not.toMatch(/npm run|\.testData|AGENTS\.md|evidence-manage/)
    }
    expect(existsSync(path.join(here, 'assets/skeleton/lessons-learned.md'))).toBe(true)
  })

  it('/ui-auto 도구 — 패널을 연다', async () => {
    const { fake } = start({})
    expect(fake.tools().map((tool) => tool.name)).toEqual(['ui-auto_panel'])
    expect(await fake.callTool('ui-auto_panel', {}, { directory: DIR })).toBe('UI-AUTO 패널을 열었습니다.')
    expect(fake.calls.some((call) => call.method === 'panel.open')).toBe(true)
  })

  it('목록 · 상세 · 보고서 · 삭제 — 서버 도구로 넘기고 JSON 을 풀어 준다', async () => {
    const { fake, calls } = start({ list: () => ({ text: '{"pages":[]}' }), detail: () => ({ text: '{"id":"a"}' }), report: () => ({ text: '{"id":"r"}' }), delete: () => ({ text: '{"retired":"a"}' }) })
    expect(await fake.call('list', {}, { directory: DIR })).toEqual({ pages: [] })
    expect(await fake.call('detail', { tc: 'a' }, { directory: DIR })).toEqual({ id: 'a' })
    expect(await fake.call('report', { id: 'r' }, { directory: DIR })).toEqual({ id: 'r' })
    expect(await fake.call('delete', { tc: 'a', script: true, extra: 1 }, { directory: DIR })).toEqual({ retired: 'a' })
    expect(calls.at(-1)).toEqual({ tool: 'delete', args: { tc: 'a', script: true } })
  })

  it('수행 — 시작을 알리고 진행을 밀어 보낸다', async () => {
    let polls = 0
    const { fake, calls } = start({ replay: () => ({ text: '{"started":true}' }), progress: () => ({ text: JSON.stringify({ running: ++polls < 2, cases: [] }) }) })
    expect(await fake.call('run', { tcs: ['a', 'b'] }, { directory: DIR })).toEqual({ started: true })
    expect(calls[0]).toEqual({ tool: 'replay', args: { tcs: ['a', 'b'] } })
    await new Promise((resolve) => setTimeout(resolve, 1600))
    expect(fake.pushes().map((push) => push.event)).toContain('service.progress')
  })

  it('PDF 저장 — 서버가 만든 PDF 를 project.exportFile 로, 실패는 값으로', async () => {
    const saved: unknown[] = []
    const ok = start({ pdf: () => ({ text: '{"path":".litecode/plugins/ui-auto/out/reports/r.pdf","name":"테스트보고서-r.pdf"}' }) }, { 'project.exportFile': (params) => (saved.push(params), { saved: true, name: 'x.pdf' }) })
    expect(await ok.fake.call('exportPdf', { kind: 'report', id: 'r' }, { directory: DIR })).toEqual({ saved: true, name: 'x.pdf' })
    expect(saved).toEqual([{ path: '.litecode/plugins/ui-auto/out/reports/r.pdf', name: '테스트보고서-r.pdf' }])
    const bad = start({ pdf: () => ({ text: 'Chrome 없음', isError: true }) })
    expect(await bad.fake.call('exportPdf', { kind: 'guide', id: 'g' }, { directory: DIR })).toMatchObject({ saved: false, code: 'pdf-failed' })
  })
})

describe('manifest', () => {
  it('설정 칸 — 앱의 설치 검사 한도(칸 32개 · 라벨 80자 · 아는 필드만)', () => {
    const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as { settings: Record<string, unknown>[] }
    expect(manifest.settings.length).toBeLessThanOrEqual(32)
    for (const setting of manifest.settings) {
      expect(String(setting['label']).length, String(setting['key'])).toBeLessThanOrEqual(80)
      expect(Object.keys(setting).filter((key) => !['key', 'label', 'type', 'options', 'required', 'multiple'].includes(key))).toEqual([])
    }
  })
})
