// Tiếng Việt 언어 팩 묶기 — `node plugins/vi-pack/build.mjs [--dir]` → build/vi-pack.zip
// --dir: zip 대신 같은 내용을 build/vi-pack/ 폴더로 낸다 — 앱의 개발 모드에서 이 폴더를 연결해 바로 확인한다
// 서비스(service/index.mjs)를 번역(locale.json) 째 service.mjs 한 파일로 묶는다. zip 에는 plugin.json · service.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), 'vi-pack-'))
await build({
  entryPoints: [path.join(here, 'service/index.mjs')],
  outfile: path.join(stage, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
cpSync(path.join(here, 'plugin.json'), path.join(stage, 'plugin.json'))
const out = path.join(root, 'build', process.argv.includes('--dir') ? 'vi-pack' : 'vi-pack.zip')
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (process.argv.includes('--dir')) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qry', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log(`✓ ${path.relative(root, out)}`)
