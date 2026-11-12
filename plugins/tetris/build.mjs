// 테트리스 묶기 — `node plugins/tetris/build.mjs [--dir]` → build/tetris.zip
// --dir: zip 대신 같은 내용을 build/tetris/ 폴더로 낸다 — 앱의 개발 모드(설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결])에서 이 폴더를 연결해 바로 확인한다
// 서비스(service/index.mjs)를 service.mjs 한 파일로 묶는다(번들은 한 파일이어야 하고 cordis 를 가져오지 않는다). zip 에는 plugin.json · index.html · service.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), 'tetris-'))
await build({
  entryPoints: [path.join(here, 'service/index.mjs')],
  outfile: path.join(stage, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
for (const name of ['plugin.json', 'index.html']) cpSync(path.join(here, name), path.join(stage, name), { recursive: true })
const out = path.join(root, 'build', process.argv.includes('--dir') ? 'tetris' : 'tetris.zip')
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (process.argv.includes('--dir')) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qry', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log(`✓ ${path.relative(root, out)}`)
