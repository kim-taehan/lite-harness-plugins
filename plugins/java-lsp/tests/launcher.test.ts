import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'
// @ts-expect-error — 플러그인 실행기는 .mjs (타입 없음)
import { javaArgs, locate, parseArgs, seedGradleVersions, splitJavaOpts } from '../server/jdtls.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)

describe('java-lsp 실행기 (server/jdtls.mjs)', () => {
  it('-data 를 읽고, 값이 없거나 옵션이면 undefined', () => {
    expect(parseArgs(['-data', '/ws'])).toEqual({ data: '/ws' })
    expect(parseArgs(['-data'])).toEqual({ data: undefined })
    expect(parseArgs(['-data', '-x'])).toEqual({ data: undefined })
    expect(parseArgs([])).toEqual({ data: undefined })
  })

  it('JAVA_OPTS 는 공백으로 나누고, 비면 -Xmx1g', () => {
    expect(splitJavaOpts('-Xmx2g  -XX:+UseG1GC')).toEqual(['-Xmx2g', '-XX:+UseG1GC'])
    expect(splitJavaOpts(undefined)).toEqual(['-Xmx1g'])
    expect(splitJavaOpts('   ')).toEqual(['-Xmx1g'])
  })

  it('java 인자 — 공유 설정은 읽기 전용, 쓰는 설정은 작업 공간 아래, -data 는 맨 끝', () => {
    const args = javaArgs({ launcher: '/ext/jdtls/plugins/launcher.jar', sharedConfig: '/ext/jdtls/config_mac_arm', data: '/ws', javaOpts: '-Xmx512m' })
    expect(args[0]).toBe('-Xmx512m')
    expect(args).toContain('-Declipse.application=org.eclipse.jdt.ls.core.id1')
    expect(args).toContain('-Dosgi.sharedConfiguration.area=/ext/jdtls/config_mac_arm')
    expect(args).toContain('-Dosgi.sharedConfiguration.area.readOnly=true')
    expect(args.slice(args.indexOf('-jar'), args.indexOf('-jar') + 2)).toEqual(['-jar', '/ext/jdtls/plugins/launcher.jar'])
    expect(args.slice(args.indexOf('-configuration'), args.indexOf('-configuration') + 2)).toEqual(['-configuration', path.join('/ws', '.jdtls-config')])
    expect(args.slice(-2)).toEqual(['-data', '/ws'])
  })

  it('jdtls 폴더에서 Equinox 실행기와 config_* 를 찾고, 없으면 알아듣는 오류', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdtls-'))
    expect(() => locate(dir)).toThrow()
    fs.mkdirSync(path.join(dir, 'plugins'))
    fs.mkdirSync(path.join(dir, 'config_win'))
    fs.writeFileSync(path.join(dir, 'plugins', 'org.eclipse.equinox.launcher_1.7.100.v2026.jar'), '')
    expect(locate(dir)).toEqual({ launcher: path.join(dir, 'plugins', 'org.eclipse.equinox.launcher_1.7.100.v2026.jar'), sharedConfig: path.join(dir, 'config_win') })
  })

  it('Gradle 버전 목록 캐시 — 없으면 빈 목록, 있으면 내용은 두고 날짜만 지금으로', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'))
    const file = seedGradleVersions(ws, new Date('2026-01-01T00:00:00Z'))
    expect(fs.readFileSync(file, 'utf8').trim()).toBe('[]')
    fs.writeFileSync(file, '[{"version":"9.0"}]')
    const now = new Date('2026-11-08T00:00:00Z')
    seedGradleVersions(ws, now)
    expect(fs.readFileSync(file, 'utf8')).toBe('[{"version":"9.0"}]')
    expect(fs.statSync(file).mtimeMs).toBe(now.getTime())
  })
})

// 서비스(service/index.mjs)가 host.lsp.register 로 올리는 선언 — 묶은 service.mjs 와 같은 묶음을 가짜 host(sdk/)에 올려 본다
type Server = { languageId: string; extensions: string[]; command: string; args: string[]; env: Record<string, string>; initializationOptions: { settings: { java: Java } }; settings: { java: Java }; idleMs: number }
type Java = { import: { maven: { offline: { enabled: boolean }; enabled: boolean }; gradle: { enabled: boolean; offline: { enabled: boolean }; wrapper: { enabled: boolean } }; generatesMetadataFilesAtProjectRoot: boolean }; maven: { downloadSources: boolean }; eclipse: { downloadSources: boolean } }

async function register() {
  const out = await build({ entryPoints: [path.join(here, '..', 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
  const fake = createFakeHost({ id: 'java-lsp', scope: 'project' })
  const registered: Server[] = []
  const lsp = fake.host.lsp
  const original = lsp.register.bind(lsp)
  lsp.register = (server) => {
    registered.push(server as unknown as Server)
    return original(server)
  }
  fake.mount(bundle)
  return { fake, registered }
}

describe('java-lsp 서비스 (service/index.mjs — host.lsp.register)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'plugin.json'), 'utf8')) as Record<string, unknown>
  it('manifest: service 선언 · service 권한만 · lsp 선언과 lsp 권한 없음 · project 범위', () => {
    expect(manifest.service).toEqual({ main: 'service.mjs', api: 1 })
    expect(manifest.permissions).toEqual(['service'])
    expect(manifest.lsp).toBeUndefined()
    expect(manifest.scope).toBe('project')
  })
  it('올라오면 java · server/jdtls.mjs · -data ${lspWorkspaceDir} 서버 하나를 올린다', async () => {
    const { fake, registered } = await register()
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ languageId: 'java', extensions: ['java'], command: 'server/jdtls.mjs', args: ['-data', '${lspWorkspaceDir}'], env: { JAVA_OPTS: '-Xmx1g' }, idleMs: 600_000 })
    expect(fake.lspServers().map((server) => server.languageId)).toEqual(['java'])
  })
  it('서비스를 내리면 등록한 언어 서버가 걷힌다', async () => {
    const { fake } = await register()
    await fake.dispose()
    expect(fake.lspServers()).toEqual([])
  })
  it('실행 파일은 플러그인 폴더 안에 있다(zip 에 들어가는 server/)', () => {
    expect(fs.existsSync(path.join(here, '..', 'server', 'jdtls.mjs'))).toBe(true)
  })
  it.each(['initializationOptions.settings', 'settings'])('%s: Maven 오프라인 · Gradle 가져오기 끔 · 내려받기 끔 · 프로젝트 폴더에 메타데이터 안 씀', async (where) => {
    const { registered } = await register()
    const server = registered[0]!
    const java = where === 'settings' ? server.settings.java : server.initializationOptions.settings.java
    expect(java.import.maven.offline.enabled).toBe(true)
    expect(java.import.gradle.enabled).toBe(false)
    expect(java.import.gradle.offline.enabled).toBe(true)
    expect(java.import.gradle.wrapper.enabled).toBe(false)
    expect(java.maven.downloadSources).toBe(false)
    expect(java.eclipse.downloadSources).toBe(false)
    expect(java.import.generatesMetadataFilesAtProjectRoot).toBe(false)
  })
  it('두 자리의 java 설정이 같고, initializationOptions 는 64KB 이하(desktop #1262 상한)', async () => {
    const { registered } = await register()
    const server = registered[0]!
    expect(server.settings.java).toEqual(server.initializationOptions.settings.java)
    expect(Buffer.byteLength(JSON.stringify(server.initializationOptions))).toBeLessThanOrEqual(64 * 1024)
  })
})
