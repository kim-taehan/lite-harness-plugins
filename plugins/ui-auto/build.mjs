// UI-AUTO 묶기 — `node plugins/ui-auto/build.mjs [--dir]` → build/ui-auto.zip
// --dir: zip 대신 같은 내용을 build/ui-auto/ 폴더로 낸다 — 앱의 개발 모드에서 이 폴더를 연결해 바로 확인한다
// 1) @playwright/mcp · playwright-core 를 npm 레지스트리에서 고정 버전으로 받아 박아 둔 sha512 와 댄다(chrome-browser 와 같은 값 · 같은 build/cache). zip 맨 위 node_modules/ 에 싣는다 —
//    서버 번들(server/ui-auto.mjs)의 playwright-core(로그인 · PDF)도 Node 가 위로 찾아 같은 사본을 쓴다
// 2) MCP 서버(server/index.ts)를 MCP SDK · yaml 째 server/ui-auto.mjs 한 파일로, 서비스(service/index.mjs)를 service.mjs 한 파일로 묶는다
// 3) plugin.json · index.html(패널) · skills/ · assets/(배지 스크립트 · 증적 빈 틀 · Pretendard 글꼴과 라이선스)를 싣고, 패널용 fonts.css 를 만든다
// 버전을 올릴 때: 0.0.x 라 도구 이름 · 인자가 바뀔 수 있다 — 스킬의 도구 이름과 server/replay.ts 의 결과 읽기(Found N match · Page URL)를 다시 댄다
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const PACKAGES = [
  { pkg: '@playwright/mcp', version: '0.0.83', integrity: 'sha512-oNcl+Ae2/IAjhfPeP46BfIkSakfmprY+aOtkv5MjrQ4lPav4/yNtPhL0iq8SlIM90oApWgBDUxaNKvktazUKOg==', needs: ['cli.js'], prune: [] },
  { pkg: 'playwright-core', version: '1.64.0-alpha-1790635538000', integrity: 'sha512-pNwaXirhXMRLaRQs4NQ18EpTdtDoFwyPH9FOaaDC7YXG4hpwE2xmwCic/1srbuExVQC7zT9LJSJpDBAru+Vo9A==', needs: ['lib/coreBundle.js', 'lib/utilsBundle.js'], prune: ['types', 'bin', 'lib/vite'] },
]

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), 'ui-auto-'))
const out = path.join(root, 'build', process.argv.includes('--dir') ? 'ui-auto' : 'ui-auto.zip')
const cache = path.join(root, 'build', 'cache')
const sha512 = (body) => `sha512-${createHash('sha512').update(body).digest('base64')}`

for (const { pkg, version, integrity, needs, prune } of PACKAGES) {
  const file = `${pkg.split('/').at(-1)}-${version}.tgz`
  const cached = path.join(cache, file)
  let body = existsSync(cached) ? readFileSync(cached) : undefined
  if (!body || sha512(body) !== integrity) {
    const url = `https://registry.npmjs.org/${pkg}/-/${file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} 내려받기 실패 (HTTP ${res.status})`)
    body = Buffer.from(await res.arrayBuffer())
    const digest = sha512(body)
    if (digest !== integrity) throw new Error(`${pkg} 무결성 불일치\n  기대: ${integrity}\n  실제: ${digest}`)
    mkdirSync(cache, { recursive: true })
    writeFileSync(cached, body)
  }
  const dest = path.join(stage, 'node_modules', pkg)
  mkdirSync(dest, { recursive: true })
  const archive = path.join(stage, 'pkg.tgz')
  writeFileSync(archive, body)
  execFileSync('tar', ['-xf', archive, '-C', dest, '--strip-components', '1'])
  rmSync(archive)
  for (const dir of prune) rmSync(path.join(dest, dir), { recursive: true, force: true })
  for (const need of needs) if (!existsSync(path.join(dest, need))) throw new Error(`${pkg}: ${need} 이 없습니다`)
  console.log(`  · ${pkg}@${version} (${(body.length / 1e6).toFixed(1)}MB tgz)`)
}

await build({
  entryPoints: [path.join(here, 'server/index.ts')],
  outfile: path.join(stage, 'server/ui-auto.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['playwright-core'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
})
await build({
  entryPoints: [path.join(here, 'service/index.mjs')],
  outfile: path.join(stage, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
for (const name of ['plugin.json', 'index.html', 'skills', 'assets']) cpSync(path.join(here, name), path.join(stage, name), { recursive: true })
// 패널 글꼴 — 앱은 패널이 적은 같은 zip 의 stylesheet 를 읽어 넣는다(바깥 글꼴은 CSP 가 막는다). woff2 를 data: 로 품은 fonts.css 하나(2.8MB, 한도 4MB)
const font = readFileSync(path.join(here, 'assets/fonts/PretendardVariable.woff2')).toString('base64')
writeFileSync(path.join(stage, 'fonts.css'), `/* Pretendard Variable — SIL OFL 1.1, assets/fonts/Pretendard-LICENSE.txt */\n@font-face{font-family:"Pretendard Variable";font-weight:45 920;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${font}) format("woff2")}\n`)
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (process.argv.includes('--dir')) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qrX', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log(`✓ ${path.relative(root, out)}`)
