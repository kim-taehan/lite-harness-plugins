#!/usr/bin/env node
// Java 언어 서버 실행기 — 앱이 manifest 의 lsp 선언대로 이 파일을 앱의 Node 로 띄운다(ELECTRON_RUN_AS_NODE, desktop #1262).
// 동봉한 런타임(runtime/)으로 Eclipse JDT LS(jdtls/)를 stdio 모드로 띄우고, 표준 입출력을 그대로 잇는다. 시스템 Java 는 쓰지 않는다.
//
//   jdtls.mjs -data <작업 공간 폴더>
//     -data       JDT LS 의 작업 공간(프로젝트 메타데이터 · 색인). 앱이 ${lspWorkspaceDir}(폴더마다 · worktree 마다 따로)를 준다 —
//                 같은 폴더를 두 JDT LS 가 쓰면 잠금이 충돌한다
//   JAVA_OPTS   JVM 옵션(공백으로 나눔, 예: "-Xmx1g"). 없으면 -Xmx1g
//
// JDT LS 의 설정 폴더(config_*)는 플러그인 안의 것을 읽기 전용 공유 설정으로 쓰고, 쓰는 설정(OSGi 캐시)은 작업 공간 아래
// .jdtls-config 에 둔다 — 플러그인 폴더는 여러 프로젝트가 같이 쓰고 업데이트 때 바뀌므로 쓰지 않는다.
// 오프라인(Maven · Gradle) 설정은 여기서 하지 않는다 — 앱이 manifest(plugin.json 의 lsp[0]) 의 initializationOptions · settings 로 넘긴다.
// 한 가지만 여기서 막는다: Buildship 은 Gradle 가져오기를 꺼도 시작할 때 Gradle 버전 목록을 services.gradle.org 에서 받는다
// (작업 공간의 캐시가 없거나 하루 지났을 때). 띄우기 전에 그 캐시를 빈 목록으로 두고 날짜를 지금으로 바꿔, 바깥 요청이 나가지 않게 한다(표준 7번).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_JAVA_OPTS = '-Xmx1g'

/** `-data <폴더>` 를 읽는다 — 없으면 undefined */
export function parseArgs(argv) {
  const at = argv.indexOf('-data')
  const data = at === -1 ? undefined : argv[at + 1]
  return { data: data && !data.startsWith('-') ? data : undefined }
}

/** JAVA_OPTS 를 JVM 인자 목록으로 — 공백으로 나누고, 비면 기본값 */
export function splitJavaOpts(value) {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts : [DEFAULT_JAVA_OPTS]
}

/** jdtls/plugins 의 Equinox 실행기 jar 와 jdtls/config_* (타깃마다 하나만 남겨 묶는다) */
export function locate(jdtlsDir) {
  const jar = readdirSync(path.join(jdtlsDir, 'plugins')).find((name) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(name))
  const config = readdirSync(jdtlsDir).find((name) => name.startsWith('config_'))
  if (!jar || !config) throw new Error(`JDT LS 를 찾지 못했습니다 (${jdtlsDir}) — 플러그인을 다시 설치해 주세요`)
  return { launcher: path.join(jdtlsDir, 'plugins', jar), sharedConfig: path.join(jdtlsDir, config) }
}

/** java 에 넘길 인자 — JDT LS 공식 실행기(bin/jdtls)와 같은 옵션 */
export function javaArgs({ launcher, sharedConfig, data, javaOpts }) {
  return [
    ...splitJavaOpts(javaOpts),
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dosgi.checkConfiguration=true',
    `-Dosgi.sharedConfiguration.area=${sharedConfig}`,
    '-Dosgi.sharedConfiguration.area.readOnly=true',
    '-Dosgi.configuration.cascaded=true',
    '--add-modules=ALL-SYSTEM',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '-jar', launcher,
    '-configuration', path.join(data, '.jdtls-config'),
    '-data', data,
  ]
}

/** Buildship 의 Gradle 버전 목록 캐시 — 없으면 빈 목록으로 만들고, 늘 날짜를 지금으로 (캐시가 새것이면 받지 않는다) */
export function seedGradleVersions(data, now = new Date()) {
  const file = path.join(data, '.metadata', '.plugins', 'org.eclipse.buildship.core', 'gradle', 'versions.json')
  mkdirSync(path.dirname(file), { recursive: true })
  if (!existsSync(file)) writeFileSync(file, '[]\n')
  utimesSync(file, now, now)
  return file
}

function main() {
  const { data } = parseArgs(process.argv.slice(2))
  if (!data) {
    process.stderr.write('사용: jdtls.mjs -data <작업 공간 폴더>\n')
    process.exit(2)
  }
  const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const java = path.join(ext, 'runtime', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  let located
  try {
    located = locate(path.join(ext, 'jdtls'))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  mkdirSync(path.join(data, '.jdtls-config'), { recursive: true })
  seedGradleVersions(data)
  // stdin/stdout 은 LSP 통신 자리 — 그대로 잇는다. 로그는 stderr
  const child = spawn(java, javaArgs({ ...located, data, javaOpts: process.env.JAVA_OPTS }), { stdio: 'inherit', windowsHide: true })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
  child.on('error', (error) => {
    process.stderr.write(`Java 런타임을 띄우지 못했습니다: ${error.message}\n`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
