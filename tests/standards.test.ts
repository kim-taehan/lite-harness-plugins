// .claude/rules/plugin.md 중 코드로 판정되는 규칙 — 머지 전 npm test 로 막는다 (규칙 번호는 plugin.md).
// 앱이 아는 필드·권한·id 모양은 desktop 이 정본이다: src/services/extensions/manifest.ts 의 KNOWN, shared/extensions.ts 의
// EXTENSION_PERMISSIONS · EXTENSION_ID. desktop 이 바뀌면 여기를 같이 고친다 (/convention-review 가 옆에 desktop 이 있으면 대조한다).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const KNOWN_FIELDS = ['id', 'name', 'description', 'version', 'entry', 'details', 'litecode', 'permissions', 'type', 'locale', 'grammars', 'skills', 'agents', 'fileActions', 'tools', 'mcp', 'lsp', 'service', 'settings', 'settingsCheck', 'settingsPer', 'placement', 'scope']
const PERMISSIONS = ['network', 'secrets', 'project', 'projectWrite', 'chat', 'tools', 'mcp', 'usage', 'lsp', 'service']
// 선언과 권한이 짝인 필드 — desktop shared/extensions.ts 의 PLUGIN_DECLARATIONS 중 permission 이 있는 것 (<필드>-mismatch)
const PAIRED = ['tools', 'mcp', 'lsp', 'service']
const ID = /^[a-z0-9-]{3,40}$/
const VERSION = /^\d+\.\d+\.\d+$/

const root = path.resolve(import.meta.dirname, '..')
const pluginsDir = path.join(root, 'plugins')

type Manifest = { id?: string; version?: string; type?: string; scope?: unknown; permissions?: string[]; mcp?: { args?: string[]; attach?: unknown }; entry?: string } & Record<string, unknown>

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

  it('17 · mcp 플러그인의 build.mjs 는 --dir 을 받는다', () => {
    const build = path.join(pluginsDir, folder, 'build.mjs')
    if (!manifest.mcp || !existsSync(build)) return
    expect(readFileSync(build, 'utf8'), 'build.mjs 가 --dir 을 받지 않습니다').toContain("'--dir'")
  })
})

it('9 · 루트 package.json 의존성은 버전 고정', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  const loose = Object.entries(all).filter(([, version]) => !/^(?:npm:[^@]+@|npm:@[^@]+@)?\d+\.\d+\.\d+$/.test(version))
  expect(loose).toEqual([])
})
