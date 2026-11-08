// Java 언어 서버 묶기 — `node plugins/java-lsp/build.mjs --platform darwin-arm64 [--dir]` → build/java-lsp-<platform>.zip
// --dir: zip 대신 같은 내용을 build/java-lsp-<platform>/ 폴더로 낸다 — 앱의 개발 모드에서 이 폴더를 연결해 바로 확인한다
// Java 런타임 + JDT LS(풀어서 약 120MB)는 fetch-runtime.mjs 가 망 밖에서 받아 build/vendor/ 에 둔다 (git 에는 넣지 않는다).
// 서비스(service/index.mjs)는 service.mjs 한 파일로 묶는다(esbuild, cordis 를 가져오지 않음).
// zip 에는 plugin.json · service.mjs · server/ · runtime/ · jdtls/. 앱의 플러그인 상한(zip 100MB · 항목 2000 · 합 200MB · 파일 하나 50MB)을 넘으면 멈춘다
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const TARGETS = { 'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64', 'win32-x64': 'win-x64' }
const FILES = ['plugin.json', 'server']
const MB = 1024 * 1024
const LIMITS = { zipBytes: 100 * MB, entries: 2000, totalBytes: 200 * MB, fileBytes: 50 * MB }

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const at = process.argv.indexOf('--platform')
const platform = at === -1 ? undefined : process.argv[at + 1]
const target = TARGETS[platform]
if (target === undefined) {
  console.error(`--platform 이 필요합니다 (${Object.keys(TARGETS).join(' · ')})`)
  process.exit(1)
}

execFileSync(process.execPath, [path.join(here, 'fetch-runtime.mjs'), target], { stdio: 'inherit' })
const vendor = path.join(root, 'build', 'vendor', 'java-lsp', target)
const stage = mkdtempSync(path.join(tmpdir(), 'java-lsp-'))
for (const name of FILES) cpSync(path.join(here, name), path.join(stage, name), { recursive: true })
await build({ entryPoints: [path.join(here, 'service/index.mjs')], outfile: path.join(stage, 'service.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' })
for (const name of ['runtime', 'jdtls']) cpSync(path.join(vendor, name), path.join(stage, name), { recursive: true })

// 앱이 설치 때 보는 상한 — 넘으면 설치가 거절되니 여기서 먼저 멈춘다
const entries = readdirSync(stage, { recursive: true }).map((name) => path.join(stage, name))
const files = entries.filter((file) => statSync(file).isFile())
const total = files.reduce((sum, file) => sum + statSync(file).size, 0)
const biggest = Math.max(...files.map((file) => statSync(file).size))
const over = [entries.length > LIMITS.entries && `항목 ${entries.length} > ${LIMITS.entries}`, total > LIMITS.totalBytes && `합 ${(total / MB).toFixed(0)}MB > 200MB`, biggest > LIMITS.fileBytes && `파일 하나 ${(biggest / MB).toFixed(0)}MB > 50MB`].filter(Boolean)

const dir = process.argv.includes('--dir')
const out = path.join(root, 'build', dir ? `java-lsp-${platform}` : `java-lsp-${platform}.zip`)
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (dir) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qry', '-9', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
if (!dir && statSync(out).size > LIMITS.zipBytes) over.push(`zip ${(statSync(out).size / MB).toFixed(0)}MB > 100MB`)
if (over.length > 0) {
  console.error(`✗ 앱의 플러그인 상한을 넘습니다: ${over.join(' · ')}`)
  process.exit(1)
}
console.log(`✓ ${path.relative(root, out)} — 항목 ${entries.length} · 풀어서 ${(total / MB).toFixed(0)}MB${dir ? '' : ` · zip ${(statSync(out).size / MB).toFixed(0)}MB`}`)
