// 새 서비스 플러그인 뼈대 — `npm run new-plugin -- <id> [--name <이름>] [--scope app|project]`
// plugins/<id>/ 에 서비스 플러그인의 최소 구성을 만든다: plugin.json · service/index.mjs · build.mjs · index.html(패널) · tests/service.test.ts · README.md · changes.txt.
// 만든 플러그인은 바로 `npm test -- --project <id>` 와 저장소 표준 검사를 통과하고, `node plugins/<id>/build.mjs --dir` 로 묶어 앱 개발 모드(폴더 연결)에서 확인할 수 있다.
// categories.json 에는 새 id 를 `unlisted` 로 적는다 — 목록에 낼 준비가 되기 전에 release 가 올리지 않게. 낼 때 분류(game · dev-tool · locale)로 바꾼다(docs/guides/publish.md).
// 템플릿은 plugins/service-example · token-pet · ja-pack 의 모양이다(표준 17 · 20 · 22 · 23 · 24번).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ID = /^[a-z0-9-]{3,40}$/ // 표준 2번
const SCOPES = ['app', 'project']

/** id 에서 클래스 이름 — my-tool → MyTool (숫자로 시작하면 P 를 붙인다) */
function classNameOf(id) {
  const name = id.split('-').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
  return /^[0-9]/.test(name) ? `P${name}` : name
}

const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`__${key}__`, value), template)

const PLUGIN_JSON = (id, name, scope) =>
  `${JSON.stringify(
    {
      id,
      name,
      description: `${name} — 한 줄 설명을 고쳐 쓰세요`,
      version: '0.1.0',
      entry: 'index.html',
      scope,
      permissions: ['service'],
      service: { main: 'service.mjs', api: 1 },
    },
    null,
    2,
  )}\n`

const SERVICE = `// __NAME__ 서비스 — 앱 안에서 도는 코드. 패널을 닫아 둬도 살아 있다.
// cordis 를 가져오지 않는다: 앱이 넘겨 주는 host 로 만든다(표준 24번 — 직접 fetch · node:http 등 바깥 요청도 금지, 필요하면 host.fetch).
// 패널은 service.call 로 아래 expose 한 메서드를 부른다. 두 번째 인자 { directory? } 는 부른 프로젝트 폴더이고, 모르면 없다.
export default (host) =>
  class __CLASS__ extends host.Service {
    counts = new Map()

    constructor(ctx) {
      super(ctx)
      this.expose('hello', (_params, { directory } = {}) => ({ name: '__NAME__', count: this.counts.get(directory ?? '') ?? 0 }))
      this.expose('increment', (_params, { directory } = {}) => {
        const key = directory ?? ''
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
        return { count: this.counts.get(key) }
      })
    }
  }
`

const BUILD = `// __NAME__ 묶기 — \`node plugins/__ID__/build.mjs [--dir]\` → build/__ID__.zip
// --dir: zip 대신 같은 내용을 build/__ID__/ 폴더로 낸다 — 앱의 개발 모드(설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결])에서 이 폴더를 연결해 바로 확인한다
// 서비스(service/index.mjs)를 service.mjs 한 파일로 묶는다(번들은 한 파일이어야 하고 cordis 를 가져오지 않는다). zip 에는 plugin.json · index.html · service.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), '__ID__-'))
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
const out = path.join(root, 'build', process.argv.includes('--dir') ? '__ID__' : '__ID__.zip')
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (process.argv.includes('--dir')) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qry', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log(\`✓ \${path.relative(root, out)}\`)
`

const PANEL = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>__NAME__</title>
<style>
  :root { color-scheme: light dark; font: 14px system-ui, sans-serif }
  body { margin: 0; padding: 16px; display: grid; gap: 8px; justify-items: start }
  #count { font-size: 40px; font-weight: 700 }
  #msg { color: GrayText; min-height: 1.4em }
</style>
</head>
<body>
<div id="title">__NAME__</div>
<div id="count">–</div>
<button id="inc">+1</button>
<div id="msg"></div>
<script>
// 패널은 화면만 맡는다 — 앱 기능과 상태는 서비스가 하고, 패널은 service.call 로 묻는다.
// 앱 통로: postMessage { litecode: 1, id, method, params } → 돌아오는 { litecode: 1, id, ok, result | error }
let next = 1
const pending = new Map()
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.litecode !== 1 || !pending.has(data.id)) return
  const done = pending.get(data.id)
  pending.delete(data.id)
  data.ok ? done.resolve(data.result) : done.reject(new Error(String(data.error)))
})
const call = (method, params) => new Promise((resolve, reject) => {
  const id = next++
  pending.set(id, { resolve, reject })
  parent.postMessage({ litecode: 1, id, method, params }, '*')
})
const serviceCall = (name, params) => call('service.call', { name, params })

const show = (result) => { document.getElementById('count').textContent = String(result.count); document.getElementById('msg').textContent = '' }
const fail = (error) => {
  // service-off: 서비스가 아직 안 떴다(켜 주세요) · not-on: 이 프로젝트에서 켜지 않았다 — docs/guides/troubleshooting.md
  document.getElementById('msg').textContent = '서비스에 묻지 못했습니다: ' + error.message
}
document.getElementById('inc').addEventListener('click', () => serviceCall('increment').then(show, fail))
serviceCall('hello').then(show, fail)
</script>
</body>
</html>
`

const TEST = `// __NAME__ 서비스 — 앱 없이 SDK 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 패널이 service.call 로 묻는 것은 앱(개발 모드)에서 확인한다 — 가짜 host 가 흉내 내지 못한다.
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
let bundle: (host: unknown) => never
beforeAll(async () => {
  // 서비스는 묶어서 시험한다 — zip 에 들어가는 service.mjs 와 같은 묶음
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0]!.text).toString('base64'))).default
})

function start() {
  const fake = createFakeHost({ id: '__ID__', scope: '__SCOPE__' })
  fake.enableProject('/work/a')
  fake.enableProject('/work/b')
  fake.mount(bundle)
  return fake
}

describe('__ID__ 서비스', () => {
  it('패널이 부를 메서드를 올린다', () => {
    expect(start().names().sort()).toEqual(['hello', 'increment'])
  })

  it('프로젝트별로 센다', async () => {
    const fake = start()
    await fake.call('increment', undefined, { directory: '/work/a' })
    await fake.call('increment', undefined, { directory: '/work/a' })
    await fake.call('increment', undefined, { directory: '/work/b' })
    expect(await fake.call('hello', undefined, { directory: '/work/a' })).toMatchObject({ count: 2 })
    expect(await fake.call('hello', undefined, { directory: '/work/b' })).toMatchObject({ count: 1 })
  })

  it('서비스를 내린 뒤에는 부를 수 없다', async () => {
    const fake = start()
    await fake.dispose()
    await expect(fake.call('hello')).rejects.toThrow()
  })
})
`

const README = `# __ID__ — __NAME__

__NAME__ — 무엇을 하는 플러그인인지 한두 줄로 고쳐 쓰세요(manifest 의 description 과 같은 뜻).

## 역할

- 하는 일: 사용자가 얻는 것을 적습니다. (뼈대: 패널의 [+1] 이 서비스에 묻고 숫자를 올립니다)
- 앱에 닿는 자리: 서비스(\`service\` — 앱 안에서 도는 코드)와 오른쪽 패널(\`entry\`).
- 범위: \`scope: "__SCOPE__"\` — 그렇게 고른 이유를 적습니다(docs/README.md "먼저 정할 것").
- 권한: \`service\` — 앱 안에서 도는 코드를 담습니다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜹니다). 쓰는 앱 기능이 늘면 권한마다 이유를 적습니다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| \`plugin.json\` | manifest — \`scope\` · \`permissions\` · \`service\`(\`main: "service.mjs"\`, \`api: 1\`) |
| \`service/index.mjs\` | 서비스 원본 — \`export default (host) => class extends host.Service\`, 패널이 \`service.call\` 로 부를 메서드를 \`expose\` 한다 |
| \`index.html\` | 패널 — 화면만. 서비스에 \`service.call\` 로 묻고 응답(\`result\`)을 그린다 |
| \`build.mjs\` | \`service/index.mjs\` 를 \`service.mjs\` 한 파일로 묶는다(\`--dir\` 지원) |
| \`tests/service.test.ts\` | SDK 가짜 host 로 서비스 로직을 본다 |
| \`changes.txt\` | 업데이트 창에 보일 바뀐 것 |

## 개발

- 묶기: \`node plugins/__ID__/build.mjs\` → \`build/__ID__.zip\`, \`--dir\` 이면 \`build/__ID__/\` 폴더(앱 개발 모드가 연결한다).
- 개발 모드: 앱 설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결] 로 \`build/__ID__/\` 를 연결해 고치며 확인한다. 고친 뒤 다시 묶는다.
- 테스트: \`npm test -- --project __ID__\` — 가짜 host 로 서비스 로직을 본다. 앱이 서비스를 올려 패널과 주고받는 것은 앱에서 확인한다.
- 배포: 아직 목록에 내지 않는다(\`categories.json\` 에 \`unlisted\`). 낼 때 분류를 적고 \`docs/guides/publish.md\` 의 절차(dev 에서는 release 하지 않고 \`release/<날짜>\` 브랜치에서 \`npm run release -- --changed\`)를 따른다.
`

/** 뼈대를 만든다 — root 는 저장소 루트(테스트는 임시 폴더). 만든 파일의 상대 경로 목록을 돌려준다. 잘못된 입력은 던진다 */
export function scaffold({ root, id, name = id, scope = 'project' }) {
  if (!ID.test(id ?? '')) throw new Error(`id 는 소문자·숫자·- 로 3~40자여야 합니다: ${id}`)
  if (!SCOPES.includes(scope)) throw new Error(`scope 는 ${SCOPES.join(' · ')} 중 하나여야 합니다: ${scope}`)
  const dir = path.join(root, 'plugins', id)
  if (existsSync(dir)) throw new Error(`plugins/${id} 가 이미 있습니다`)
  const values = { ID: id, NAME: name, CLASS: classNameOf(id), SCOPE: scope }
  const files = {
    'plugin.json': PLUGIN_JSON(id, name, scope),
    'service/index.mjs': fill(SERVICE, values),
    'build.mjs': fill(BUILD, values),
    'index.html': fill(PANEL, values),
    'tests/service.test.ts': fill(TEST, values),
    'README.md': fill(README, values),
    'changes.txt': '첫 버전\n',
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  const categoriesFile = path.join(root, 'categories.json')
  const categories = existsSync(categoriesFile) ? JSON.parse(readFileSync(categoriesFile, 'utf8')) : {}
  categories[id] = 'unlisted'
  const sorted = Object.fromEntries(Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(categoriesFile, `${JSON.stringify(sorted, null, 2)}\n`)
  return Object.keys(files).map((file) => `plugins/${id}/${file}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const id = args.find((arg, index) => !arg.startsWith('--') && !['--name', '--scope'].includes(args[index - 1]))
  if (!id) {
    console.error('쓰는 법: npm run new-plugin -- <id> [--name <이름>] [--scope app|project]')
    process.exit(1)
  }
  try {
    const root = path.resolve(import.meta.dirname, '..')
    const created = scaffold({ root, id, name: valueOf('--name') ?? id, scope: valueOf('--scope') ?? 'project' })
    console.log(created.map((file) => `✓ ${file}`).join('\n'))
    console.log(`\n다음: npm test -- --project ${id}  →  node plugins/${id}/build.mjs --dir  →  앱 개발 모드로 build/${id}/ 연결`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
