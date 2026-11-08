// .claude/rules/plugin.md 중 코드로 판정되는 규칙 — 머지 전 npm test 로 막는다 (규칙 번호는 plugin.md).
// 앱이 아는 필드·권한·id 모양은 desktop 이 정본이다: src/services/extensions/manifest.ts 의 KNOWN, shared/extensions.ts 의
// EXTENSION_PERMISSIONS · EXTENSION_ID. desktop 이 바뀌면 여기를 같이 고친다 (/convention-review 가 옆에 desktop 이 있으면 대조한다).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

const KNOWN_FIELDS = ['id', 'name', 'description', 'version', 'entry', 'details', 'litecode', 'permissions', 'type', 'locale', 'grammars', 'skills', 'agents', 'fileActions', 'tools', 'mcp', 'lsp', 'service', 'settings', 'settingsCheck', 'settingsPer', 'placement', 'scope']
const PERMISSIONS = ['network', 'secrets', 'project', 'projectWrite', 'chat', 'tools', 'mcp', 'usage', 'lsp', 'service']
// 선언과 권한이 짝인 필드 — desktop shared/extensions.ts 의 PLUGIN_DECLARATIONS 중 permission 이 있는 것 (<필드>-mismatch)
const PAIRED = ['tools', 'mcp', 'lsp', 'service']
// 서비스 선언의 허용 목록 — 정본은 desktop shared/extensions/serviceApi.ts, 사본은 sdk/litecode-service.d.ts (23번). 유니온은 사본에서 읽는다
const sdkTypes = readFileSync(path.join(import.meta.dirname, '..', 'sdk', 'litecode-service.d.ts'), 'utf8')
const unionOf = (name: string): string[] => [...(new RegExp(`export type ${name} = ([^\\n]+)`).exec(sdkTypes)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]!)
const SERVICE_EVENTS = unionOf('ServiceEventName')
const SERVICE_INJECT = unionOf('ServiceInjectKey')
const SERVICE_API_LATEST = Number(/SERVICE_API_LATEST: (\d+)/.exec(sdkTypes)?.[1])
// 소식마다 필요한 권한(패널 소식과 같은 표) — 새 소식이 생기면 sdk 와 이 표를 같이 고친다(아래 테스트가 어긋남을 잡는다)
const EVENT_PERMISSION: Record<string, string> = { 'chat.turnEnded': 'chat', 'project.filesChanged': 'project', 'usage.changed': 'usage' }
/** 프로젝트를 모르는 소식 — scope "app" 서비스만 받는다 */
const APP_ONLY_EVENTS = ['usage.changed']
const ID = /^[a-z0-9-]{3,40}$/
const VERSION = /^\d+\.\d+\.\d+$/

const root = path.resolve(import.meta.dirname, '..')
const pluginsDir = path.join(root, 'plugins')

type Manifest = { id?: string; version?: string; type?: string; scope?: unknown; permissions?: string[]; mcp?: { args?: string[]; attach?: unknown }; entry?: string } & Record<string, unknown>

// ── 서비스 소스 점검 (24번) — desktop shared/extensions/serviceBundleScan.ts 와 같은 글자 점검을 소스에 미리 한다 ──
const NETWORK_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dns', 'dns/promises', 'dgram', 'undici']
const MODULE_USE = new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*["'\`](?:node:)?(${NETWORK_MODULES.map((name) => name.replace('/', '\\/')).join('|')})["'\`]`, 'g')
const FETCH_CALL = /(?<![\w$.])fetch\s*\(/
const GLOBAL_FETCH = /\bglobalThis\s*(?:\.\s*fetch\b|\[\s*["'`]fetch["'`]\s*\])/
const WEBSOCKET = /\bnew\s+WebSocket\b|\bglobalThis\s*(?:\.\s*WebSocket\b|\[\s*["'`]WebSocket["'`]\s*\])/
const CORDIS_IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]cordis(?:\/[^"'`]*)?["'`]/
const SECRET_IN_ARGS = /\bargs\s*:\s*\[[^\]]*\$\{secret:/

/** 서비스 소스 글에서 24번이 막는 것 — 주석은 esbuild 로 걷어 낸 뒤 본다(설명 글의 `fetch(` 가 걸리지 않게) */
function forbiddenInService(source: string): string[] {
  const code = transformSync(source, { loader: 'js', format: 'esm' }).code
  const found: string[] = []
  if (CORDIS_IMPORT.test(code)) found.push('cordis')
  for (const match of code.matchAll(MODULE_USE)) found.push(`node:${match[1]}`)
  if (FETCH_CALL.test(code) || GLOBAL_FETCH.test(code)) found.push('fetch')
  if (WEBSOCKET.test(code)) found.push('WebSocket')
  if (SECRET_IN_ARGS.test(code)) found.push('secret-in-args')
  return found
}

/** 서비스 소스 파일 — `service/` 아래 + `service.main` + 그것들이 상대 경로로 가져오는 js(번들에 같이 들어간다) */
function serviceSourceFiles(folder: string, main: unknown): string[] {
  const dir = path.join(pluginsDir, folder)
  const queue: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(?:mjs|js|cjs)$/.test(entry.name)) queue.push(file)
    }
  }
  if (existsSync(path.join(dir, 'service'))) walk(path.join(dir, 'service'))
  if (typeof main === 'string' && existsSync(path.join(dir, main))) queue.push(path.join(dir, main))
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), match[1]!)
      if (/\.(?:mjs|js|cjs)$/.test(target) && target.startsWith(dir) && existsSync(target)) queue.push(target)
    }
  }
  return [...seen]
}

// 이미 배포된 id — 20번(scope 필수)은 새 플러그인에만. 이 브랜치의 catalog.json 은 새 플러그인을 release 한 PR 에서 이미 그 id 를
// 담으므로 기준으로 쓰지 않는다: main(origin/main)의 catalog + 목록에서 내린(unlisted) id. origin/main 을 못 읽으면 이 브랜치의 catalog
function publishedIds(): Set<string> {
  let catalog: string
  try {
    catalog = execFileSync('git', ['show', 'origin/main:catalog.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    catalog = readFileSync(path.join(root, 'catalog.json'), 'utf8')
  }
  const categories = JSON.parse(readFileSync(path.join(root, 'categories.json'), 'utf8')) as Record<string, string>
  return new Set([...(JSON.parse(catalog) as { extensions: { id: string }[] }).extensions.map((entry) => entry.id), ...Object.keys(categories).filter((id) => categories[id] === 'unlisted')])
}
const published = publishedIds()

const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const file = ['plugin.json', 'extension.json'].map((name) => path.join(pluginsDir, entry.name, name)).find((candidate) => existsSync(candidate))
    return { folder: entry.name, manifest: file ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : undefined }
  })

describe.each(plugins.map((plugin) => [plugin.folder, plugin] as const))('plugins/%s', (folder, { manifest }) => {
  it('manifest 가 있다', () => {
    expect(manifest, 'plugin.json 이 없습니다').toBeDefined()
  })
  if (!manifest) return

  it('1 · 폴더 이름 = id', () => {
    expect(manifest.id).toBe(folder)
  })

  it('2 · id 3~40자 소문자·숫자·- , version 주.부.수', () => {
    expect(manifest.id).toMatch(ID)
    expect(manifest.version).toMatch(VERSION)
  })

  it('3 · 앱이 아는 필드만', () => {
    expect(Object.keys(manifest).filter((field) => !KNOWN_FIELDS.includes(field))).toEqual([])
  })

  it('5 · 아는 권한만, tools · mcp · lsp 선언 ↔ 같은 이름 권한', () => {
    const permissions = manifest.permissions ?? []
    expect(permissions.filter((permission) => !PERMISSIONS.includes(permission))).toEqual([])
    for (const field of PAIRED) expect(permissions.includes(field), `${field} 선언과 ${field} 권한은 둘 다 있거나 둘 다 없어야 합니다`).toBe(manifest[field] !== undefined)
  })

  it('7 · 패널이 바깥 script · stylesheet 를 싣지 않는다', () => {
    const entry = typeof manifest.entry === 'string' ? path.join(pluginsDir, folder, manifest.entry) : undefined
    if (!entry || !entry.endsWith('.html') || !existsSync(entry)) return
    const html = readFileSync(entry, 'utf8')
    expect(html.match(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+/gi) ?? []).toEqual([])
  })

  it('8 · mcp.args 에 비밀 값을 넣지 않는다', () => {
    expect((manifest.mcp?.args ?? []).filter((arg) => arg.includes('${secret:'))).toEqual([])
  })

  it('20 · scope 는 app · project, 새 플러그인은 필수, 팩은 쓰지 않는다', () => {
    const pack = manifest.type === 'locale' || manifest.type === 'grammar'
    if (pack) return expect(manifest.scope, '언어 팩 · 문법 팩은 scope 를 적을 수 없습니다').toBeUndefined()
    if (manifest.scope !== undefined) expect(['app', 'project']).toContain(manifest.scope)
    if (!published.has(String(manifest.id))) expect(manifest.scope, '새 플러그인은 scope("app" · "project")를 적어야 합니다').toBeDefined()
  })

  it('18 · mcp.attach 는 litecode · server, server 면 id 가 litecode 가 아니다', () => {
    const attach = manifest.mcp?.attach
    if (attach === undefined) return
    expect(['litecode', 'server']).toContain(attach)
    if (attach === 'server') expect(manifest.id, 'litecode 는 server 로 붙일 수 없습니다(예약 이름)').not.toBe('litecode')
  })

  it('22 · README.md 에 역할 · 구성 · 개발 절', () => {
    const readme = path.join(pluginsDir, folder, 'README.md')
    expect(existsSync(readme), 'README.md 가 없습니다 (docs/README.md "플러그인마다 README.md")').toBe(true)
    const text = readFileSync(readme, 'utf8')
    expect(['역할', '구성', '개발'].filter((title) => !new RegExp(`^## ${title}\\s*$`, 'm').test(text)), '빠진 절').toEqual([])
  })

  it('23 · service 선언 — main(.mjs) · api · events · inject 가 허용 목록 안, scope 가 있다', () => {
    const service = manifest.service as { main?: unknown; api?: unknown; inject?: unknown; events?: unknown } | undefined
    if (service === undefined) return
    expect(Object.keys(service).filter((key) => !['main', 'api', 'inject', 'events'].includes(key)), '모르는 service 필드').toEqual([])
    const main = service.main
    expect(typeof main === 'string' && main.endsWith('.mjs') && !path.isAbsolute(main) && !main.split(/[\\/]/).includes('..'), 'service.main 은 플러그인 폴더 안 .mjs 한 파일').toBe(true)
    expect(Number.isInteger(service.api) && (service.api as number) >= 1 && (service.api as number) <= SERVICE_API_LATEST, `service.api 는 1~${SERVICE_API_LATEST} 정수`).toBe(true)
    const inject = (service.inject ?? []) as string[]
    const events = (service.events ?? []) as string[]
    expect(inject.filter((key) => !SERVICE_INJECT.includes(key)), 'inject 허용 목록 밖').toEqual([])
    expect(events.filter((name) => !SERVICE_EVENTS.includes(name)), 'events 허용 목록 밖').toEqual([])
    const permissions = manifest.permissions ?? []
    for (const name of events) expect(permissions, `${name} 소식은 ${EVENT_PERMISSION[name]} 권한이 필요합니다`).toContain(EVENT_PERMISSION[name])
    for (const name of events.filter((event) => APP_ONLY_EVENTS.includes(event))) expect(manifest.scope, `${name} 은 프로젝트를 몰라 scope "app" 만 받습니다`).toBe('app')
    expect(['app', 'project'], '서비스 플러그인은 scope 를 적는다').toContain(manifest.scope)
  })

  it('24 · 서비스 소스는 cordis · 직접 바깥 요청 · args 비밀이 없다', () => {
    const service = manifest.service as { main?: unknown } | undefined
    if (service === undefined) return
    const found = serviceSourceFiles(folder, service.main).flatMap((file) => forbiddenInService(readFileSync(file, 'utf8')).map((what) => `${path.relative(path.join(pluginsDir, folder), file)}: ${what}`))
    expect(found).toEqual([])
  })

  it('17 · mcp · service 플러그인의 build.mjs 는 --dir 을 받는다', () => {
    const build = path.join(pluginsDir, folder, 'build.mjs')
    if ((!manifest.mcp && !manifest.service) || !existsSync(build)) return
    expect(readFileSync(build, 'utf8'), 'build.mjs 가 --dir 을 받지 않습니다').toContain("'--dir'")
  })
})

it('9 · 루트 package.json 의존성은 버전 고정', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  const loose = Object.entries(all).filter(([, version]) => !/^(?:npm:[^@]+@|npm:@[^@]+@)?\d+\.\d+\.\d+$/.test(version))
  expect(loose).toEqual([])
})

describe('서비스 허용 목록과 점검기 (23 · 24번)', () => {
  it('sdk 에서 읽은 허용 목록이 비어 있지 않고 소식 권한 표와 같다', () => {
    expect(SERVICE_EVENTS.length).toBeGreaterThan(0)
    expect(SERVICE_INJECT.length).toBeGreaterThan(0)
    expect(SERVICE_API_LATEST).toBeGreaterThanOrEqual(1)
    expect(Object.keys(EVENT_PERMISSION).sort(), 'sdk 의 ServiceEventName 과 EVENT_PERMISSION 이 어긋납니다 — 같이 고친다').toEqual([...SERVICE_EVENTS].sort())
  })

  it('점검기가 직접 요청 · cordis · args 비밀을 잡고 host.fetch 와 주석은 통과시킨다', () => {
    expect(forbiddenInService("import { Service } from 'cordis'")).toEqual(['cordis'])
    expect(forbiddenInService("import http from 'node:http'\nconst net = require('net')")).toEqual(['node:http', 'node:net'])
    expect(forbiddenInService('const r = await fetch(url)')).toEqual(['fetch'])
    expect(forbiddenInService("const s = new WebSocket('ws://x')")).toEqual(['WebSocket'])
    expect(forbiddenInService("host.mcp.register({ command: 'a', args: ['${secret:k}'] })")).toEqual(['secret-in-args'])
    expect(forbiddenInService("const r = await host.fetch(url)\n// fetch(url) 은 쓰지 않는다\nconst d = process.cwd()")).toEqual([])
    expect(forbiddenInService("host.mcp.register({ command: 'a', env: { T: '${secret:k}' } })")).toEqual([])
  })
})
