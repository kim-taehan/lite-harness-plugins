// 서비스(service/index.mjs) — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 MCP 서버를 띄우는 것, 패널이 service.call 로 묻는 것은 앱에서 확인한다(여기서 못 본다). 실제 DB 가 필요한 확인도 마찬가지.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import createService, { BUNDLED_STANDARD, RELAY } from '../service/index.mjs'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as {
  permissions: string[]
  settings: { key: string; type: string }[]
  service: { main: string; api: number }
  settingsCheck?: string
  mcp?: unknown
  skills?: unknown
}
const DIR = '/work/a'
type Reply = { ok: true; value: unknown } | { ok: false; code: string }

function start(calls: Record<string, (params: unknown, options: { directory?: string }) => unknown> = {}) {
  const fake = createFakeHost({ id: 'sql-tuning', scope: 'project', events: ['project.filesChanged'], calls })
  fake.enableProject(DIR)
  fake.mount(createService as never)
  const call = (name: string, params?: unknown) => fake.call(name, params, { directory: DIR }) as Promise<Reply>
  return { fake, call }
}

describe('manifest ↔ 서비스', () => {
  it('mcp · skills 선언은 없고 service 선언과 권한이 짝이다', () => {
    expect(manifest.mcp).toBeUndefined()
    expect(manifest.skills).toBeUndefined()
    expect(manifest.permissions).toContain('service')
    expect(manifest.permissions).not.toContain('secrets') // 비밀 칸 저장 · ${secret:} 해석에는 권한이 필요 없고, secrets.* 호출은 쓰지 않는다
    expect([...manifest.permissions].sort()).toEqual(['project', 'projectWrite', 'service'])
    expect(manifest.service).toMatchObject({ main: 'service.mjs', api: 1 })
  })

  it('[연결 확인] 도구 이름(settingsCheck)은 묶은 서버가 가진 도구와 같다', () => {
    expect(manifest.settingsCheck).toBe('server_status')
    const status = readFileSync(path.join(here, 'server/status.ts'), 'utf8')
    expect(status).toContain("name: 'server_status'")
  })

  it('패널은 비밀 값을 읽지 않는다 — 비밀은 secret 칸 + ${secret:} 로 서버에만 간다', () => {
    const panel = readFileSync(path.join(here, 'index.html'), 'utf8')
    expect(panel).not.toMatch(/secrets\./)
  })

  it('MCP 서버 env 의 자리표시는 설정 칸과 맞고 비밀번호는 secret 로만 간다', () => {
    const { fake } = start()
    const [server] = fake.mcpServers()
    const keys = new Set(manifest.settings.map((s) => s.key))
    const secrets = new Set(manifest.settings.filter((s) => s.type === 'secret').map((s) => s.key))
    for (const value of Object.values(server!.env ?? {})) {
      const match = /^\$\{(storage|secret):(\w+)\}$/.exec(value)
      if (!match) continue
      expect(keys.has(match[2]!), `${value} 는 설정 칸에 없습니다`).toBe(true)
      expect(match[1] === 'secret', `${value}: 비밀 칸은 secret 자리표시로만`).toBe(secrets.has(match[2]!))
    }
    expect(server!.env?.['SQL_TUNING_PASSWORD']).toBe('${secret:password}')
    expect(JSON.stringify(server)).not.toMatch(/storage:password/)
  })
})

describe('service', () => {
  it('묶은 MCP 서버를 등록한다 — 10분 쉬면 내린다', () => {
    const { fake } = start()
    expect(fake.mcpServers()).toHaveLength(1)
    expect(fake.mcpServers()[0]).toMatchObject({ command: 'server/sql-tuning.mjs', idleMs: 600000 })
  })

  it('결과서 폴더(sql-tuning-reports)의 파일이 바뀌면 그 프로젝트 패널에 reports 소식을 보내고, 다른 파일 소식은 거른다', async () => {
    const { fake } = start()
    await fake.emit('project.filesChanged', { directory: DIR, paths: ['src/Main.java', 'pom.xml'] })
    expect(fake.pushes().filter((p) => p.event === 'service.reports')).toHaveLength(0)
    await fake.emit('project.filesChanged', { directory: DIR, paths: ['sql-tuning-reports/20261110-090333/meta.json'] })
    await fake.emit('project.filesChanged', { directory: DIR, paths: [], truncated: true })
    expect(fake.pushes().filter((p) => p.event === 'service.reports')).toHaveLength(2)
  })

  it('패널이 부르는 메서드를 낸다', () => {
    expect(start().fake.names().sort()).toEqual([...Object.keys(RELAY), 'bundledFile'].sort())
  })

  it('스킬 폴더를 서비스가 올린다 — 이름이 SKILL.md frontmatter 와 같고 SKILL.md · references 가 있다', () => {
    const { fake } = start()
    expect(fake.skills()).toEqual([{ name: 'sql-tuning', dir: 'skills/sql-tuning' }])
    const folder = path.join(here, 'skills/sql-tuning')
    expect(/^name: sql-tuning$/m.test(readFileSync(path.join(folder, 'SKILL.md'), 'utf8'))).toBe(true)
    for (const file of ['references/oracle.md', 'references/postgresql.md']) expect(() => readFileSync(path.join(folder, file), 'utf8')).not.toThrow()
  })

  it('스킬 본문은 도구 이름의 접두어를 직접 적지 않는다 — 기본 attach 라 앱이 litecode_sql-tuning_ 을 붙인다', () => {
    const skill = readFileSync(path.join(here, 'skills/sql-tuning/SKILL.md'), 'utf8')
    expect(skill).not.toMatch(/litecode_sql-tuning_|sql-tuning_[a-z_]+`/)
    expect(skill).toContain('sql-tuning')
  })

  it('플러그인 기본 표준은 host.skills.readFile 로 읽는다 — 없으면 null, 얹은 글이 있으면 그 글', async () => {
    const { fake, call } = start()
    expect(await call('bundledFile', { skill: 'sql-tuning', path: 'references/sql-standard.md' })).toEqual({ ok: true, value: null })
    await fake.host.skills.writeFile('sql-tuning', BUNDLED_STANDARD, 'SQL-1 규칙', { directory: DIR })
    expect(await call('bundledFile')).toEqual({ ok: true, value: { text: 'SQL-1 규칙' } })
    expect(fake.calls.some((c) => c.method === 'skills.readFile')).toBe(false)
  })

  it('각 메서드가 같은 앱 호출로 중계하고 부른 프로젝트 폴더를 넘긴다', async () => {
    const seen: { method: string; params: unknown; directory?: string }[] = []
    const calls = Object.fromEntries(
      Object.values(RELAY).map((method) => [method, (params: unknown, options: { directory?: string }) => (seen.push({ method, params, directory: options.directory }), { ran: method })]),
    )
    const { call } = start(calls)
    for (const [name, method] of Object.entries(RELAY)) expect(await call(name, { path: 'x.md' })).toEqual({ ok: true, value: { ran: method } })
    expect(seen.map((s) => s.method)).toEqual(Object.values(RELAY))
    expect(seen.every((s) => s.directory === DIR && JSON.stringify(s.params) === '{"path":"x.md"}')).toBe(true)
  })

  it('앱 호출이 실패하면 오류 코드를 값에 실어 돌려준다 — 패널이 코드로 안내를 고른다', async () => {
    const { call } = start({
      'project.writeFile': () => {
        throw Object.assign(new Error('x'), { code: 'path-unsafe' })
      },
      'project.removeFile': () => {
        throw new Error('코드 없는 오류')
      },
    })
    expect(await call('writeFile', { path: '.litecode/sql-standard.md', text: 'a' })).toEqual({ ok: false, code: 'path-unsafe' })
    expect(await call('removeFile', { path: '.litecode/sql-standard.md' })).toEqual({ ok: false, code: 'io-failed' })
  })

  it('값이 없으면 null 로 돌려준다(파일이 없을 때 등)', async () => {
    const { call } = start({ 'project.readFile': () => undefined })
    expect(await call('readFile', { path: 'x' })).toEqual({ ok: true, value: null })
  })

  it('프로젝트 폴더를 모르면 앱 호출이 거절되고 그 코드를 돌려준다', async () => {
    const { fake } = start({ 'project.info': () => ({}) })
    expect(await fake.call('projectInfo', undefined, {})).toEqual({ ok: false, code: 'not-on' })
  })
})
