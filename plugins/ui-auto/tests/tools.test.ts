// 서버 도구 — begin · list · detail · shot · report · delete · view 를 실제 증적으로 부른다(브라우저 없이)
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Browser, mcpArgs } from '../server/browser.ts'
import { table } from '../server/markdown.ts'
import { createTools, ensureEvidence, PANEL_TOOLS } from '../server/index.ts'
import { project } from './helper.ts'

function tools(withEvidence = true) {
  const config = project(withEvidence, { UI_AUTO_USER: 'qa', UI_AUTO_PASSWORD: 'secret-pw', UI_AUTO_LOGIN_PATH: '/ko/login' })
  const { own } = createTools(config, new Browser(config))
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await own.find((tool) => tool.name === name)!.run(args)
    return { text: result.content.map((part) => part.text).join(''), isError: result.isError === true }
  }
  return { config, run, names: own.map((tool) => tool.name) }
}

describe('server tools', () => {
  it('도구 이름 — 패널 전용은 서비스의 panelTools 와 같다', () => {
    const { names } = tools()
    expect(names).toEqual(['begin', 'format', 'guide', 'login', 'check', 'list', 'detail', 'replay', 'progress', 'stop', 'shot', 'report', 'guide_read', 'delete', 'view', 'pdf'])
    const service = readFileSync(path.resolve(import.meta.dirname, '../service/index.mjs'), 'utf8')
    expect(service).toContain(`const PANEL_TOOLS = ${JSON.stringify(PANEL_TOOLS).replaceAll('"', "'").replaceAll(',', ', ')}`)
  })

  it('begin — 빈 프로젝트면 증적 틀(lessons-learned.md 포함)을 만들고 run_id · 교훈 색인을 준다. 비밀번호는 없다', async () => {
    const { config, run } = tools(false)
    const { text } = await run('begin', { kind: 'guide' })
    expect(text).toMatch(/^run_id: \d{8}-001\nguide_id: guide-\d{8}-001\n/)
    expect(text).toContain('방금 빈 틀을 만들었음')
    expect(text).toContain('교훈 색인 (.litecode/ui-auto/lessons-learned.md): 해당 없음')
    expect(text).not.toContain('secret-pw')
    for (const file of ['system_map.md', 'lessons-learned.md', 'testdata.md', 'pages/_template.md']) expect(existsSync(path.join(config.evidenceDir, file))).toBe(true)
    expect((await run('begin', { kind: 'run' })).text).toMatch(/^run_id: \d{8}-002\n/)
  })

  it('ensureEvidence — 있는 파일은 덮지 않고 빠진 것만 채운다', async () => {
    const { config } = tools()
    const before = readFileSync(path.join(config.evidenceDir, 'system_map.md'), 'utf8')
    expect(await ensureEvidence(config)).toBe(false)
    expect(readFileSync(path.join(config.evidenceDir, 'system_map.md'), 'utf8')).toBe(before)
    expect(existsSync(path.join(config.evidenceDir, 'lessons-learned.md'))).toBe(true)
  })

  it('list · detail · report · shot', async () => {
    const { run } = tools()
    const list = JSON.parse((await run('list')).text)
    expect(list).toMatchObject({ ready: true, baseUrl: 'https://portal.example.test', login: { configured: true, saved: false }, busy: null })
    expect(list.pages).toHaveLength(3)
    expect(list.pages[1].tcs[0].runnable).toEqual({ ok: true })
    expect(list.flow.nodes).toHaveLength(3)
    expect(list.lessons).toEqual([])
    const detail = JSON.parse((await run('detail', { tc: 'process-management-analyze-TC-001' })).text)
    expect(detail.steps.length).toBeGreaterThan(3)
    const report = JSON.parse((await run('report', { id: '20261110-001' })).text)
    expect(report.steps[1].capture).toBe('captures/process-management-analyze/20261110-001-process-management-analyze-TC-001-step01.png')
    const shot = JSON.parse((await run('shot', { path: report.steps[1].capture })).text)
    expect(shot.url).toMatch(/^data:image\/png;base64,/)
    expect((await run('shot', { path: 'system_map.md' })).isError).toBe(true)
    await expect(run('shot', { path: 'captures/../../../etc/x.png' })).rejects.toThrow('증적 폴더 밖') // 서버 입구가 isError 로 바꾼다
  })

  it('delete — TC 를 폐기로, 원하면 스크립트 파일도. 번호는 남는다', async () => {
    const { config, run } = tools()
    const result = JSON.parse((await run('delete', { tc: 'process-management-analyze-TC-002', script: true })).text)
    expect(result).toEqual({ retired: 'process-management-analyze-TC-002', scriptRemoved: true })
    const doc = readFileSync(path.join(config.evidenceDir, 'pages/process-management-analyze.md'), 'utf8')
    expect(table(doc, '테스트 케이스')[1]).toMatchObject({ tc_id: 'process-management-analyze-TC-002', 상태: '폐기', 스크립트: '-', '스크립트 상태': '없음' })
    expect(existsSync(path.join(config.evidenceDir, 'scripts/process-management-analyze/process-management-analyze-TC-002.yaml'))).toBe(false)
    expect(readFileSync(path.join(config.evidenceDir, 'system_map.md'), 'utf8')).toContain('- 테스트 케이스: 2건 (성공 1, 폐기 1)')
    expect((await run('delete', { tc: 'nope' })).isError).toBe(true)
  })

  it('view — 보고서 md 를 한 파일 HTML 로(캡처는 data:)', async () => {
    const { config, run } = tools()
    const made = JSON.parse((await run('view', { kind: 'report', id: '20261110-001' })).text)
    expect(made.path).toBe('.litecode/plugins/ui-auto/out/reports/20261110-001.html')
    const html = readFileSync(path.join(config.project, made.path), 'utf8')
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('<script')
    await expect(run('view', { kind: 'report', id: '../x' })).rejects.toThrow('id 가 틀렸습니다')
  })

  it('Playwright MCP 인자 — opencode 하네스와 같은 옵션, 세션은 프로젝트 밖, 비밀은 없다', () => {
    const { config } = tools()
    const args = mcpArgs(config)
    expect(args.slice(1)).toEqual(['--browser', 'chrome', '--isolated', '--storage-state', config.stateFile, '--save-session', '--output-dir', path.join(config.pluginDir, 'mcp'), '--init-script', path.join(config.extensionDir, 'assets', 'browser-badge.js')])
    expect(config.stateFile.startsWith(config.evidenceDir)).toBe(false)
    expect(args.join(' ')).not.toContain('secret-pw')
  })
})

describe('설정의 기본값', () => {
  it('testdata — testdata.md 가 없거나 이름이 없으면 설정 칸 값을 쓰고, 파일 값이 이긴다. 계정 이름은 뺀다', async () => {
    const config = project(true, { UI_AUTO_TESTDATA: 'REQ_NAME=신규 요구사항, CUSTOMER=설정값, TEST_PASSWORD=x' })
    const { Evidence } = await import('../server/evidence.ts')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(config.evidenceDir, 'testdata.md'), '# 테스트 데이터\n예) `CUSTOMER=예시`\nCUSTOMER=파일값\n')
    const evidence = new Evidence(config.evidenceDir, undefined, config.testdata)
    expect(await evidence.testdata()).toEqual({ REQ_NAME: '신규 요구사항', CUSTOMER: '파일값' })
    expect(await evidence.testdataSources()).toEqual({ file: ['CUSTOMER'], settings: ['REQ_NAME'] })
    const { own } = createTools(config, new Browser(config), evidence)
    const begin = await own.find((tool) => tool.name === 'begin')!.run({ kind: 'run' })
    expect(begin.content[0]!.text).toContain('테스트 데이터: REQ_NAME=신규 요구사항 (플러그인 설정), CUSTOMER=파일값')
  })

  it('로그인 상태 — 경로는 없어도 되고, 빠진 칸을 말한다. 값은 보이지 않는다', async () => {
    const { loginState, loginReady } = await import('../server/config.ts')
    const base = { path: '', userField: '', passwordField: '', button: '' }
    expect(loginReady({ ...base, user: 'qa01', password: 'pw' })).toBe(true)
    expect(loginState({ ...base, user: 'qa01', password: 'pw' })).toBe('설정됨 (아이디 qa***, 비밀번호 있음, 로그인 화면 자동으로 찾음)')
    expect(loginState({ ...base, user: 'qa01', password: '' })).toBe('설정이 덜 됨 — 플러그인 설정의 테스트 계정 비밀번호 가 비어 있음')
    expect(loginState({ ...base, user: '', password: '' })).toBe('설정 없음 (로그인 없이 씀)')
  })
})

describe('format', () => {
  it('스킬의 형식 절만 돌려준다 — 코드 블록 안 제목에서 끊지 않는다', async () => {
    const { formatSection, FORMAT_KINDS } = await import('../server/index.ts')
    const skill = readFileSync(path.resolve(import.meta.dirname, '../skills/ui-auto-evidence/SKILL.md'), 'utf8')
    for (const kind of FORMAT_KINDS) expect(formatSection(skill, kind), kind).toBeTruthy()
    const report = formatSection(skill, 'report')!
    expect(report).toMatch(/^### Report/)
    expect(report).toContain('- 한 일:')
    expect(report).toContain('## 불일치·확인 사항')
    expect(report).not.toContain('### TC script')
    expect(formatSection(skill, 'script')).toContain('expect: { ok: true }')
    expect(formatSection(skill, 'lessons')).toContain('## 색인')
    expect(formatSection(skill, 'nope')).toBeUndefined()
    const { run } = tools()
    expect((await run('format', { kind: 'route' })).text).toMatch(/^### Navigation script/)
  })
})

describe('guide', () => {
  it('성공한 보고서로 TC 테스트 가이드를 쓴다 — 목적 · 사전 준비 · 들어가기 · 따라 하기 · 결과 확인 · 주의 · 참고', async () => {
    const { config, run } = tools()
    const made = JSON.parse((await run('guide', { tc: 'process-management-analyze-TC-001' })).text)
    expect(made).toEqual({ id: 'guide-process-management-analyze-TC-001', path: '.litecode/ui-auto/guides/guide-process-management-analyze-TC-001.md', run: '20261110-001' })
    const text = readFileSync(path.join(config.project, made.path), 'utf8')
    for (const heading of ['## 1. 목적', '## 2. 사전 준비', '## 3. 화면 들어가기', '## 4. 따라 하기', '## 5. 결과 확인', '## 6. 주의할 점', '## 7. 참고']) expect(text).toContain(heading)
    expect(text).toMatch(/^---\nguide_id: guide-process-management-analyze-TC-001\n/)
    expect(text).toContain('tcs: [process-management-analyze-TC-001]')
    expect(text).toContain('![1단계](../captures/process-management-analyze/20261110-001-process-management-analyze-TC-001-step01.png)')
    expect(text).not.toContain('secret-pw')
    const list = JSON.parse((await run('list')).text)
    expect(list.guides[0]).toMatchObject({ id: 'guide-process-management-analyze-TC-001', tcs: ['process-management-analyze-TC-001'] })
    expect(list.pages[1].tcs[0].title).toBe('요구사항명 요구사항 추가 테스트 입력 후 저장하기')
  })
})
