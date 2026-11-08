// 문법 팩 묶기 — 팩 폴더의 plugin.json · LICENSE · 서비스(service/index.mjs)와, grammars.json 이 선언한 wasm 을 node_modules 의 문법 패키지(package.json 의 별칭 code-grammar-*)에서 꺼내 붙인다.
// zip 에는 plugin.json · service.mjs · LICENSE · .wasm. 서비스는 grammars.json 째 service.mjs 한 파일로 묶는다(번들은 한 파일이어야 하고 cordis 를 가져오지 않는다).
// wasm 은 폴더에 두지 않는다. --dir 이면 zip 대신 같은 내용을 build/<id>/ 폴더로 낸다 — 앱의 개발 모드가 이 폴더를 연결한다.
// 팩을 더할 때: 폴더 하나(plugin.json · LICENSE · grammars.json · service/index.mjs · build.mjs) + package.json 의 별칭 하나 + categories.json 한 줄
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')

export async function packGrammar(folder, pkg, { dir = false } = {}) {
  const id = path.basename(folder)
  const grammars = JSON.parse(readFileSync(path.join(folder, 'grammars.json'), 'utf8'))
  const stage = mkdtempSync(path.join(tmpdir(), `${id}-`))
  await build({
    entryPoints: [path.join(folder, 'service/index.mjs')],
    outfile: path.join(stage, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  })
  for (const name of ['plugin.json', 'LICENSE']) cpSync(path.join(folder, name), path.join(stage, name))
  for (const grammar of grammars) {
    const wasm = path.join(root, 'node_modules', pkg, path.basename(grammar.wasm))
    if (!existsSync(wasm)) throw new Error(`${id}: ${wasm} 가 없습니다 — npm ci 를 먼저`)
    cpSync(wasm, path.join(stage, grammar.wasm))
  }
  const out = path.join(root, 'build', dir ? id : `${id}.zip`)
  mkdirSync(path.dirname(out), { recursive: true })
  rmSync(out, { recursive: true, force: true })
  if (dir) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
  else execFileSync('zip', ['-qry', out, '.'], { cwd: stage })
  rmSync(stage, { recursive: true, force: true })
  console.log(`✓ ${path.relative(root, out)}`)
}
