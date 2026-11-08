import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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

describe('java-lsp 오프라인 설정 (lsp-options.json — desktop #1262 머지 뒤 manifest 의 lsp 에 그대로 옮긴다)', () => {
  const options = JSON.parse(fs.readFileSync(path.join(here, '..', 'lsp-options.json'), 'utf8'))
  for (const [name, java] of [['initializationOptions.settings', options.initializationOptions.settings.java], ['settings', options.settings.java]] as const) {
    it(`${name}: Maven 오프라인 · Gradle 가져오기 끔 · 내려받기 끔 · 프로젝트 폴더에 메타데이터 안 씀`, () => {
      expect(java.import.maven.offline.enabled).toBe(true)
      expect(java.import.gradle.enabled).toBe(false)
      expect(java.import.gradle.offline.enabled).toBe(true)
      expect(java.import.gradle.wrapper.enabled).toBe(false)
      expect(java.maven.downloadSources).toBe(false)
      expect(java.eclipse.downloadSources).toBe(false)
      expect(java.import.generatesMetadataFilesAtProjectRoot).toBe(false)
    })
  }
  it('두 자리의 java 설정이 같고, initializationOptions 는 64KB 이하(desktop #1262 상한)', () => {
    expect(options.settings.java).toEqual(options.initializationOptions.settings.java)
    expect(Buffer.byteLength(JSON.stringify(options.initializationOptions))).toBeLessThanOrEqual(64 * 1024)
  })
})
