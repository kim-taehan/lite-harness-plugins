// 서비스(service/index.mjs) — 앱 없이 SDK 의 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 MCP 서버를 띄우는 것, 패널이 service.call 로 묻는 것은 앱에서 확인한다(여기서 못 본다). 실제 DB 가 필요한 확인도 마찬가지.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import createService, { BUNDLED_STANDARD, LEGACY_REPORTS_FOLDER, REPORTS_COLLECTION, REPORTS_FOLDER, RELAY } from '../service/index.mjs'
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

/** 소식 핸들러는 비동기(reindex 뒤 패널에 알림)라 가짜 host 의 emit 이 기다려 주지 않는다 — 메모리 일이 끝날 때까지 잠깐 둔다 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

describe('manifest ↔ 서비스', () => {
  it('mcp · skills 선언은 없고 service 선언과 권한이 짝이다', () => {
    expect(manifest.mcp).toBeUndefined()
    expect(manifest.skills).toBeUndefined()
    expect(manifest.permissions).toContain('service')
    expect(manifest.permissions).not.toContain('secrets') // 비밀 칸 저장 · ${secret:} 해석에는 권한이 필요 없고, secrets.* 호출은 쓰지 않는다
    expect([...manifest.permissions].sort()).toEqual(['project', 'projectWrite', 'service'])
    expect(manifest.service).toMatchObject({ main: 'service.mjs', api: 2 })
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

  it('결과서 폴더(새 · 옛 위치)의 파일이 바뀌면 그 프로젝트 패널에 reports 소식을 보내고, 다른 파일 소식은 거른다', async () => {
    const { fake } = start()
    await fake.emit('project.filesChanged', { directory: DIR, paths: ['src/Main.java', 'pom.xml'] })
    expect(fake.pushes().filter((p) => p.event === 'service.reports')).toHaveLength(0)
    await fake.emit('project.filesChanged', { directory: DIR, paths: ['.litecode/plugins/sql-tuning/reports/20261110-090333/meta.json'] })
    await fake.emit('project.filesChanged', { directory: DIR, paths: [], truncated: true })
    await settle()
    expect(fake.pushes().filter((p) => p.event === 'service.reports')).toHaveLength(2)
  })

  it('deleteReport — 패널 전용 서버 도구 delete_report 를 mcp.call 로 부르고 오류 코드를 값에 실어 돌려준다', async () => {
    const seen: unknown[] = []
    const { fake, call } = start({
      'mcp.call': (params) => {
        seen.push(params)
        const id = (params as { args: { id: string } }).args.id
        return id === '20200101-000000' ? { isError: true, text: 'not-found: report 20200101-000000 does not exist.' } : { text: `Deleted report ${id}` }
      },
    })
    expect(fake.mcpServers()[0]).toMatchObject({ panelTools: ['delete_report'] })
    expect(await call('deleteReport', { id: '20261110-090333' })).toEqual({ ok: true, value: 'Deleted report 20261110-090333' })
    expect(seen[0]).toEqual({ tool: 'delete_report', args: { id: '20261110-090333' } })
    expect(await call('deleteReport', { id: '20200101-000000' })).toEqual({ ok: false, code: 'not-found' })
    expect(await call('deleteReport', {})).toEqual({ ok: false, code: 'bad-id' })
  })

  it('패널이 부르는 메서드를 낸다', () => {
    expect(start().fake.names().sort()).toEqual([...Object.keys(RELAY), 'bundledFile', 'deleteReport', 'reports'].sort())
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

// ── 결과서 색인(host.db reports) — 파일이 정본, 색인은 다시 만든다 ───────────────────────────────────────────
const NEW = REPORTS_FOLDER
const OLD = LEGACY_REPORTS_FOLDER
const metaText = (id: string, target = 'OrderMapper.sel', verdict: 'ok' | 'hold' = 'ok') =>
  JSON.stringify({ v: 1, id, at: '2026-11-10T00:03:33.000Z', target, db: 'oracle', verdict, compare: { sets: 3, same: 3, partial: 0 }, index_proposed: false, file: 'index.html' })

/** 메모리 프로젝트 폴더 — 경로 → 글. project.listDir · readFile · fileInfo 를 흉내 낸다 */
function memoryProject(files: Record<string, string>, options: { truncate?: string[]; unreadable?: string[] } = {}) {
  const reads: string[] = []
  const calls = {
    'project.listDir': (params: unknown) => {
      const dir = (params as { path: string }).path
      if (options.unreadable?.includes(dir)) throw Object.assign(new Error('x'), { code: 'io-failed' })
      const names = new Set<string>()
      for (const file of Object.keys(files)) if (file.startsWith(`${dir}/`)) names.add(file.slice(dir.length + 1).split('/')[0]!)
      if (names.size === 0) throw Object.assign(new Error('x'), { code: 'file-unreadable' })
      return { entries: [...names].map((name) => ({ name, dir: !files[`${dir}/${name}`] })), truncated: options.truncate?.includes(dir) === true }
    },
    'project.readFile': (params: unknown) => {
      const file = (params as { path: string }).path
      reads.push(file)
      if (!(file in files)) throw Object.assign(new Error('x'), { code: 'file-unreadable' })
      return files[file]
    },
    'project.fileInfo': (params: unknown) => {
      const dir = (params as { path: string }).path
      return Object.keys(files).some((file) => file.startsWith(`${dir}/`)) ? { size: 1 } : null
    },
  }
  return { files, reads, calls }
}
const ids = async (fake: ReturnType<typeof start>['fake']) => ((await fake.host.db!.list(REPORTS_COLLECTION, {}, { directory: DIR })).docs as { id: string; doc: Record<string, unknown> }[])

describe('reindex — 결과서 폴더 ↔ host.db 색인', () => {
  const A = '20261109-143205'
  const B = '20261110-090333'
  const C = '20261110-090333-2'

  it('패널이 열릴 때 없는 줄을 meta.json 으로 채운다 — 새 위치는 legacy false, 옛 위치는 legacy true, meta 없는 옛 결과서는 hasMeta false', async () => {
    const project = memoryProject({
      [`${NEW}/${B}/index.html`]: 'h',
      [`${NEW}/${B}/meta.json`]: metaText(B, 'New'),
      [`${OLD}/${A}/index.html`]: 'h',
      [`${OLD}/${A}/meta.json`]: metaText(A, 'Old'),
      [`${OLD}/20260101-010101/index.html`]: 'h',
      [`${NEW}/notes.txt`]: 'x',
    })
    const { fake, call } = start(project.calls)
    const reply = (await call('reports', { reindex: true })) as { ok: true; value: { rows: { id: string; doc: Record<string, unknown> }[]; total: number } }
    expect(reply.value.rows.map((row) => row.id)).toEqual([B, A, '20260101-010101']) // 최신 먼저
    expect(reply.value.total).toBe(3)
    const docs = Object.fromEntries((await ids(fake)).map((row) => [row.id, row.doc]))
    expect(docs[B]).toMatchObject({ v: 1, target: 'New', verdict: 'ok', legacy: false, hasMeta: true })
    expect(docs[A]).toMatchObject({ target: 'Old', legacy: true, hasMeta: true })
    expect(docs['20260101-010101']).toEqual({ legacy: true, hasMeta: false })
  })

  it('같은 것은 쓰기 0번 · 읽기 0번 — 두 번째 훑기는 db 를 쓰지 않는다', async () => {
    const project = memoryProject({ [`${NEW}/${B}/index.html`]: 'h', [`${NEW}/${B}/meta.json`]: metaText(B) })
    const { fake, call } = start(project.calls)
    await call('reports', { reindex: true })
    const readsBefore = project.reads.length
    const writes = () => fake.calls.filter((c) => /^db\.(set|delete|batch)$/.test(c.method)).length
    const before = writes()
    await call('reports', { reindex: true })
    expect(writes()).toBe(before)
    expect(project.reads.length).toBe(readsBefore)
  })

  it('폴더가 사라진 줄은 지운다 · DB 가 비어도 폴더로 복구한다', async () => {
    const project = memoryProject({ [`${NEW}/${B}/index.html`]: 'h', [`${NEW}/${B}/meta.json`]: metaText(B), [`${NEW}/${C}/index.html`]: 'h', [`${NEW}/${C}/meta.json`]: metaText(C) })
    const { fake, call } = start(project.calls)
    await call('reports', { reindex: true })
    delete project.files[`${NEW}/${C}/index.html`]
    delete project.files[`${NEW}/${C}/meta.json`]
    await call('reports', { reindex: true })
    expect((await ids(fake)).map((row) => row.id)).toEqual([B])
    await fake.host.db!.delete(REPORTS_COLLECTION, B, { directory: DIR }) // 색인이 깨져 비었다
    expect(((await call('reports', { reindex: true })) as { value: { rows: unknown[] } }).value.rows).toHaveLength(1)
  })

  it('폴더를 못 읽었거나 잘렸으면 그 위치의 색인 줄은 지우지 않는다', async () => {
    const project = memoryProject({ [`${OLD}/${A}/index.html`]: 'h', [`${OLD}/${A}/meta.json`]: metaText(A) }, { unreadable: [OLD] })
    const { fake, call } = start(project.calls)
    await fake.host.db!.set(REPORTS_COLLECTION, A, { legacy: true, hasMeta: false }, { directory: DIR })
    await call('reports', { reindex: true })
    expect((await ids(fake)).map((row) => row.id)).toEqual([A]) // 못 읽음 → 그대로
    const cut = memoryProject({ [`${OLD}/${B}/index.html`]: 'h' }, { truncate: [OLD] })
    const second = start(cut.calls)
    await second.fake.host.db!.set(REPORTS_COLLECTION, A, { legacy: true, hasMeta: false }, { directory: DIR })
    const reply = (await second.call('reports', { reindex: true })) as { value: { truncated: boolean } }
    expect(reply.value.truncated).toBe(true)
    expect((await ids(second.fake)).map((row) => row.id)).toEqual([A, B]) // 잘림 → 못 본 A 를 지우지 않는다
  })

  it('meta 가 나중에 생기면(쓰는 중에 읽은 경우) 다음 훑기가 바로잡는다', async () => {
    const project = memoryProject({ [`${NEW}/${B}/index.html`]: 'h' })
    const { fake, call } = start(project.calls)
    await call('reports', { reindex: true })
    expect((await ids(fake))[0]!.doc).toEqual({ legacy: false, hasMeta: false })
    project.files[`${NEW}/${B}/meta.json`] = metaText(B, 'Late')
    await call('reports', { reindex: true })
    expect((await ids(fake))[0]!.doc).toMatchObject({ target: 'Late', hasMeta: true })
  })

  it('읽는 것은 최신 limit 건만 · reindex 가 아니면 폴더를 훑지 않는다', async () => {
    const files: Record<string, string> = {}
    for (let day = 1; day <= 40; day++) {
      const id = `202611${String(day).padStart(2, '0')}-090000`
      files[`${NEW}/${id}/index.html`] = 'h'
      files[`${NEW}/${id}/meta.json`] = metaText(id)
    }
    const project = memoryProject(files)
    const { fake, call } = start(project.calls)
    const first = (await call('reports', { reindex: true, limit: 30 })) as { value: { rows: { id: string }[]; total: number } }
    expect(first.value.rows).toHaveLength(30)
    expect(first.value.rows[0]!.id).toBe('20261140-090000')
    expect(first.value.total).toBe(40)
    const listings = fake.calls.filter((c) => c.method === 'project.listDir').length
    await call('reports', { limit: 30 })
    expect(fake.calls.filter((c) => c.method === 'project.listDir').length).toBe(listings)
  })

  it('결과서 폴더 소식이 오면 색인을 맞춘 뒤 패널에 알린다 — 다른 파일 소식은 훑지 않는다', async () => {
    const project = memoryProject({ [`${NEW}/${B}/index.html`]: 'h', [`${NEW}/${B}/meta.json`]: metaText(B) })
    const { fake } = start(project.calls)
    await fake.emit('project.filesChanged', { directory: DIR, paths: ['src/Main.java'] })
    expect(fake.calls.filter((c) => c.method === 'project.listDir')).toHaveLength(0)
    await fake.emit('project.filesChanged', { directory: DIR, paths: [`${NEW}/${B}/meta.json`] })
    await fake.emit('project.filesChanged', { directory: DIR, paths: [`${OLD}/${A}/index.html`] })
    await settle()
    expect((await ids(fake)).map((row) => row.id)).toEqual([B])
    expect(fake.pushes().filter((p) => p.event === 'service.reports')).toHaveLength(2)
  })

  it('deleteReport — 서버가 폴더를 지운 뒤 색인 줄도 지운다(서버가 못 지웠어도 not-found 면 줄을 정리)', async () => {
    const { fake, call } = start({ 'mcp.call': (params) => ((params as { args: { id: string } }).args.id === A ? { isError: true, text: 'not-found: x' } : { text: 'Deleted' }) })
    await fake.host.db!.set(REPORTS_COLLECTION, A, { legacy: true, hasMeta: false }, { directory: DIR })
    await fake.host.db!.set(REPORTS_COLLECTION, B, { legacy: false, hasMeta: false }, { directory: DIR })
    expect(await call('deleteReport', { id: B })).toMatchObject({ ok: true })
    expect((await ids(fake)).map((row) => row.id)).toEqual([A])
    expect(await call('deleteReport', { id: A })).toEqual({ ok: false, code: 'not-found' })
    expect(await ids(fake)).toEqual([])
  })
})
