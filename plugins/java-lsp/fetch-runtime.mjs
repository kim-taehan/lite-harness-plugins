#!/usr/bin/env node
// Java 언어 서버 플러그인(plugins/java-lsp)에 동봉할 Java 런타임 + Eclipse JDT LS 를 받아 `build/vendor/java-lsp/<타깃>/` 에 놓는다.
// 플러그인 zip 의 `runtime/` · `jdtls/` 가 이 폴더다 — server/jdtls.mjs 가 이 자리를 쓴다.
//
// **망 밖(개발 머신 · CI)에서만 돈다.** 폐쇄망 PC 의 앱은 내려받지 않는다 — 실행 중 바깥 요청 0 (표준 7번).
// 받은 것은 레포에 넣지 않는다(`.gitignore` 의 `build/`). 버전과 sha256 을 여기 박아 둔다(받는 쪽에서 읽은 값으로 대조하면 바뀌어도 모른다):
// - Eclipse JDT LS 1.63.0 milestone — sha256 은 download.eclipse.org 의 .sha256. 플랫폼 공통 한 벌이고, 타깃에 맞는 config_* 만 남긴다.
//   **Java 25 가 필요하다** (번들이 osgi.ee JavaSE 25 를 요구 — 21 로는 org.eclipse.core.filesystem 이 안 풀려 뜨지 않는다)
// - Java 런타임: Eclipse Temurin 25.0.5+8 — sha256 은 Adoptium 릴리스(github.com/adoptium/temurin25-binaries)의 .sha256.txt.
//   JDK 24 부터 JDK 에 jmods 가 없어 따로 받는다: 이 판의 JDK(jlink 를 돌린다) + 타깃의 jmods 로 Temurin JRE 의 모듈 **전부**를
//   압축(--compress=zip-6 · --strip-debug)해 만든다. JRE 를 그대로 담으면 lib/modules 하나가 앱의 플러그인 상한(파일 하나 50MB)을 넘는다.
//   모듈을 빼지 않는 이유: JDT LS 는 따로 설정하지 않으면 자기를 띄운 런타임을 프로젝트의 JDK 로도 써서, 빼면 사용자 코드에 가짜 오류가 난다.
//   **mac-x64 · win-x64 런타임은 미검증**(이 판의 jlink 에 그 타깃 jmods 를 준다)
//
//   node plugins/java-lsp/fetch-runtime.mjs                  이 판의 타깃
//   node plugins/java-lsp/fetch-runtime.mjs mac-x64 win-x64  지정한 타깃 · --all 전부
//
// 놓는 자리 (타깃마다):
//   runtime/   jlink 런타임 (bin/java)
//   jdtls/     JDT LS (plugins/ · features/ · 그 타깃의 config_*)

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const JDK_VERSION = '25.0.5+8'
const JDK_BASE = 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8'
const JDTLS = {
  version: '1.63.0',
  url: 'https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz',
  asset: 'jdt-language-server-1.63.0-202610191322.tar.gz',
  sha256: 'b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4',
}

/** Temurin 25 JRE 의 모듈(`java --list-modules`, 25.0.5+8) */
const MODULES = [
  'java.base,java.compiler,java.datatransfer,java.desktop,java.instrument,java.logging,java.management,java.management.rmi,java.naming,java.net.http',
  'java.prefs,java.rmi,java.scripting,java.se,java.security.jgss,java.security.sasl,java.smartcardio,java.sql,java.sql.rowset,java.transaction.xa',
  'java.xml,java.xml.crypto,jdk.accessibility,jdk.charsets,jdk.crypto.cryptoki,jdk.dynalink,jdk.graal.compiler,jdk.graal.compiler.management',
  'jdk.httpserver,jdk.incubator.vector,jdk.internal.vm.ci,jdk.jdwp.agent,jdk.jfr,jdk.jsobject,jdk.localedata,jdk.management,jdk.management.agent',
  'jdk.management.jfr,jdk.naming.dns,jdk.naming.rmi,jdk.net,jdk.nio.mapmode,jdk.sctp,jdk.security.auth,jdk.security.jgss,jdk.unsupported',
  'jdk.xml.dom,jdk.zipfs',
].join(',')

// 타깃 이름은 sonarqube fetch-runtime 과 같다. jdk 는 jlink 를 돌릴 JDK(이 판일 때만 받는다), jmods 는 jlink 재료, config 는 남길 JDT LS 설정 폴더
export const TARGETS = {
  'mac-arm64': {
    platform: 'darwin', arch: 'arm64', config: 'config_mac_arm', java: 'java',
    jdk: { asset: 'OpenJDK25U-jdk_aarch64_mac_hotspot_25.0.5_8.tar.gz', sha256: '36dc14d797aaff6d89aab302cd053fdba6207dfdcf772052fa7b023a94b0e857', home: 'Contents/Home' },
    jmods: { asset: 'OpenJDK25U-jmods_aarch64_mac_hotspot_25.0.5_8.tar.gz', sha256: '7a6f29625e7df123f33ad8b0d2253fc2d786bad74fe34c1f36346ee676abed53' },
  },
  'mac-x64': {
    platform: 'darwin', arch: 'x64', config: 'config_mac', java: 'java',
    jdk: { asset: 'OpenJDK25U-jdk_x64_mac_hotspot_25.0.5_8.tar.gz', sha256: '32cd4d2151c91aa00d0fc911edfd05245ed40fa6b1aa894d5f35c928cd67a59d', home: 'Contents/Home' },
    jmods: { asset: 'OpenJDK25U-jmods_x64_mac_hotspot_25.0.5_8.tar.gz', sha256: 'b185222962304e5541707e132e206d6eea916db40e76754c47013a346034c359' },
  },
  'win-x64': {
    platform: 'win32', arch: 'x64', config: 'config_win', java: 'java.exe',
    jdk: { asset: 'OpenJDK25U-jdk_x64_windows_hotspot_25.0.5_8.zip', sha256: '636bdc13dc649ddc7d5921c5c7d23cca6e44fd19d662b45cc9c02135a6c96c42', home: '' },
    jmods: { asset: 'OpenJDK25U-jmods_x64_windows_hotspot_25.0.5_8.zip', sha256: '09a8df20d57da0f4807e219798f0e76c0a24c70dc23595115f8cf26c53fd2727' },
  },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vendor = join(root, 'build', 'vendor', 'java-lsp')
const downloads = join(vendor, 'downloads')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** 받아서 sha256 을 대조한다. 이미 받아 둔 것이 맞으면 다시 받지 않는다 */
async function download(url, name, sha256) {
  const file = join(downloads, name)
  if (existsSync(file) && sha256Of(file) === sha256) return file
  mkdirSync(downloads, { recursive: true })
  const res = await fetch(url)
  if (!res.ok || res.body === null) fail(`${url} 내려받기 실패 (HTTP ${res.status})`)
  const partial = `${file}.partial`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial))
  const digest = sha256Of(partial)
  if (digest !== sha256) {
    rmSync(partial, { force: true })
    fail(`${name} 체크섬 불일치\n  기대: ${sha256}\n  실제: ${digest}`)
  }
  renameSync(partial, file)
  console.log(`  · 받음 ${name}`)
  return file
}

/** 압축을 dest 에 푼다(strip: 맨 위 폴더를 몇 단 벗길지). bsdtar 는 zip 도 푼다 */
function extract(archive, dest, strip) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  execFileSync('tar', ['-xf', archive, '-C', dest, ...(strip ? ['--strip-components', String(strip)] : [])])
}

/** 플러그인 zip 풀기는 심볼릭 링크를 거절한다(desktop unpack) — 실제 파일로 바꾼다 */
function dereference(dir) {
  for (const name of readdirSync(dir, { recursive: true })) {
    const file = join(dir, name)
    if (!lstatSync(file).isSymbolicLink()) continue
    const real = realpathSync(file)
    rmSync(file)
    copyFileSync(real, file)
  }
}

/** 이 판의 JDK — jlink 를 돌린다 */
async function hostJdk(host) {
  const { asset, sha256, home } = TARGETS[host].jdk
  const dest = join(vendor, 'jdk', host)
  if (!existsSync(join(dest, home, 'bin', 'jlink'))) extract(await download(`${JDK_BASE}/${asset}`, asset, sha256), dest, 1)
  return join(dest, home)
}

/** 그 타깃의 jmods 폴더 (압축 안의 jmods/ 위치는 찾아서) */
async function jmods(target) {
  const { asset, sha256 } = TARGETS[target].jmods
  const dest = join(vendor, 'jmods', target)
  const find = () => readdirSync(dest, { recursive: true }).map((name) => join(dest, name)).find((p) => p.endsWith('java.base.jmod'))
  if (!existsSync(dest) || !find()) extract(await download(`${JDK_BASE}/${asset}`, asset, sha256), dest, 0)
  const base = find()
  if (!base) fail(`${target}: jmods 안에 java.base.jmod 가 없습니다`)
  return dirname(base)
}

async function stage(target, jdk) {
  const t = TARGETS[target]
  const dir = join(vendor, target)
  console.log(`${target}: Temurin ${JDK_VERSION} (jlink) · JDT LS ${JDTLS.version}`)
  const runtime = join(dir, 'runtime')
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execFileSync(join(jdk, 'bin', 'jlink'), [
    '--module-path', await jmods(target),
    '--add-modules', MODULES,
    '--strip-debug', '--no-man-pages', '--no-header-files', '--compress=zip-6',
    '--output', runtime,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  dereference(runtime)
  // JDT LS — 그 타깃의 config_* 만, bin/(파이썬 실행기)은 쓰지 않는다(server/jdtls.mjs 가 띄운다)
  const jdtls = join(dir, 'jdtls')
  extract(await download(JDTLS.url, JDTLS.asset, JDTLS.sha256), jdtls, 0)
  for (const name of readdirSync(jdtls)) if ((name.startsWith('config_') && name !== t.config) || name === 'bin') rmSync(join(jdtls, name), { recursive: true, force: true })
  dereference(jdtls)
  if (t.platform !== process.platform || t.arch !== process.arch) return console.log('  · java -version 확인 건너뜀 (이 판에서 못 돈다)')
  const res = execFileSync(join(runtime, 'bin', t.java), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log(`  · runtime/bin/${t.java} ${res}`.trim())
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const args = process.argv.slice(2)
  const named = args.filter((a) => !a.startsWith('--'))
  const host = Object.entries(TARGETS).find(([, t]) => t.platform === process.platform && t.arch === process.arch)?.[0]
  if (!host) fail(`이 판(${process.platform}-${process.arch})용 타깃이 없습니다 — jlink 는 이 판의 JDK 로 돈다`)
  const targets = args.includes('--all') ? Object.keys(TARGETS) : named.length > 0 ? named : [host]
  for (const target of targets) if (TARGETS[target] === undefined) fail(`모르는 타깃: ${target} (있는 것: ${Object.keys(TARGETS).join(', ')})`)
  const jdk = await hostJdk(host)
  for (const target of targets) await stage(target, jdk)
  console.log(`✓ ${targets.length}개 준비됨 — build/vendor/java-lsp/<타깃>/{runtime,jdtls}`)
}
