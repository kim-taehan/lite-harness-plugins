// 플러그인 발행 — `npm run release <id 또는 폴더> [--platform darwin-arm64] [--data <서버 데이터 폴더>] [--sign-key 개인키 --key-id 키id] [--dry-run]`
// zip 만 만들고 `litecode-deploy plugin publish` 로 넘긴다. 카탈로그 · sha256 · 순번 · 서명은 서버가 만든다.
// 폴더에 build.mjs 가 있으면 그것을 돌려 build/<폴더>[-<platform>].zip 을 받고(sonarqube 처럼 플랫폼 전용이면 --platform),
// 없으면 plugins/<폴더>/ 의 파일을 폴더 없이 묶어 build/<id>-<version>.zip 에 둔다. `--zip <파일>` 은 따로 묶은 zip 을 그대로 올린다.
// changes.txt · README.md · tests/ 는 zip 에 넣지 않는다 — changes.txt 는 --changes-file 로 서버에 간다 (분류는 categories.json → --category)
// categories.json 의 "unlisted" 는 "올리지 않는다" 이다 — 이름으로 불러도 건너뛴다. 이미 서버에 있는 것을 내리는 것은 `litecode-deploy plugin remove <id>` (docs/guides/publish.md)
// 서버에 올리는 일이라 --dry-run 으로 만들 명령만 먼저 본다. 서버가 있는 PC 에서만 된다 (원격 발행 없음)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const extensionsDir = path.join(root, 'plugins')
const buildDir = path.join(root, 'build')
const categoriesFile = path.join(root, 'categories.json')
const VERSION = /^\d+\.\d+\.\d+$/
const CATEGORIES = ['game', 'dev-tool', 'locale']
const UNLISTED = 'unlisted'
const MANIFESTS = ['extension.json', 'plugin.json']
const DEPLOY = process.env.LITECODE_DEPLOY ?? 'litecode-deploy'

const manifestFile = (folder) => MANIFESTS.map((name) => path.join(extensionsDir, folder, name)).find((file) => existsSync(file))

function folders() {
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && manifestFile(entry.name))
    .map((entry) => entry.name)
}

const manifestOf = (folder) => JSON.parse(readFileSync(manifestFile(folder), 'utf8'))

function zipManifest(file) {
  const listed = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n')
  const name = MANIFESTS.find((candidate) => listed.includes(candidate))
  if (!name) throw new Error(`${file}: zip 맨 위에 ${MANIFESTS.join(' 또는 ')} 이 없습니다`)
  return JSON.parse(execFileSync('unzip', ['-p', file, name], { encoding: 'utf8' }))
}

const categories = () => JSON.parse(readFileSync(categoriesFile, 'utf8'))
const isUnlisted = (id) => categories()[id] === UNLISTED

function categoryOf(id) {
  const category = categories()[id]
  if (category === UNLISTED) throw new Error(`${id} 는 올리지 않는 플러그인입니다 (categories.json 의 "${UNLISTED}") — 올리려면 분류를 적습니다`)
  if (!CATEGORIES.includes(category)) throw new Error(`categories.json 에 ${id} 의 분류(${CATEGORIES.join(' · ')})가 필요합니다`)
  return category
}

/** build/ 에 올릴 zip 을 만든다 — build.mjs 가 있으면 그 결과, 없으면 폴더를 그대로 묶은 것 */
function makeZip(folder, platform) {
  if (existsSync(path.join(extensionsDir, folder, 'build.mjs'))) {
    execFileSync(process.execPath, [path.join(extensionsDir, folder, 'build.mjs'), ...(platform ? ['--platform', platform] : [])], { stdio: 'inherit' })
    return path.join(buildDir, `${folder}${platform ? `-${platform}` : ''}.zip`)
  }
  if (platform) throw new Error(`${folder}: build.mjs 가 없는 플러그인은 --platform 을 받지 않습니다`)
  const { id, version } = manifestOf(folder)
  if (!id || !VERSION.test(version ?? '')) throw new Error(`${folder}: manifest 의 id·version(1.2.3) 이 필요합니다`)
  const zipFile = path.join(buildDir, `${id}-${version}.zip`)
  rmSync(zipFile, { force: true })
  // -X: 여분 속성 없이 · -r: 하위 폴더 · -q: 조용히. 폴더 안에서 묶어 zip 맨 위에 manifest 가 오게
  execFileSync('zip', ['-qrX', zipFile, '.', '-x', '.DS_Store', '*/.DS_Store', 'changes.txt', 'README.md', 'tests/*'], { cwd: path.join(extensionsDir, folder) })
  return zipFile
}

/** `litecode-deploy plugin publish` 인자 — 분류는 categories.json, 바뀐 것은 changes.txt */
function publishArgs(zipFile, platform, options) {
  const manifest = zipManifest(zipFile)
  if (!manifest.id || !VERSION.test(manifest.version ?? '')) throw new Error(`${zipFile}: zip 안 manifest 의 id·version 이 필요합니다`)
  const folder = folders().find((name) => manifestOf(name).id === manifest.id)
  const changes = folder && path.join(extensionsDir, folder, 'changes.txt')
  return [
    'plugin', 'publish', zipFile, '--category', categoryOf(manifest.id),
    ...(changes && existsSync(changes) ? ['--changes-file', changes] : []),
    ...(platform ? ['--platform', platform] : []),
    ...(options.data ? ['--data', options.data] : []),
    ...(options.signKey ? ['--sign-key', options.signKey, '--key-id', options.keyId] : []),
  ]
}

const args = process.argv.slice(2)
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const valueFlags = ['--platform', '--zip', '--data', '--sign-key', '--key-id']
const named = args.filter((arg, index) => !arg.startsWith('--') && !valueFlags.includes(args[index - 1]))
const zip = valueOf('--zip')
const platform = valueOf('--platform')
const options = { data: valueOf('--data'), signKey: valueOf('--sign-key'), keyId: valueOf('--key-id') }
if (named.length === 0 && !zip) {
  console.error('쓰는 법: npm run release <id 또는 폴더…> [--platform darwin-arm64] [--dry-run] · npm run release -- --zip <묶은.zip> [--platform darwin-arm64]\n  공통: [--data <서버 데이터 폴더>] [--sign-key <개인키> --key-id <키id>]  (개인키는 저장소 밖에 둔다)')
  process.exit(1)
}
if (options.signKey && !options.keyId) throw new Error('--sign-key 는 --key-id 와 같이 줍니다')
const dryRun = args.includes('--dry-run')
mkdirSync(buildDir, { recursive: true })

const all = folders()
const targets = zip ? [] : named.map((arg) => all.find((folder) => folder === arg || manifestOf(folder).id === arg) ?? arg)
for (const folder of targets) {
  if (!all.includes(folder)) throw new Error(`plugins/${folder} 가 없습니다`)
  if (isUnlisted(manifestOf(folder).id)) console.log(`- ${folder} 건너뜀 (${UNLISTED} — 올리지 않는 플러그인)`)
  else categoryOf(manifestOf(folder).id)
}
const zips = zip ? [path.resolve(zip)] : targets.filter((folder) => !isUnlisted(manifestOf(folder).id)).map((folder) => makeZip(folder, platform))
for (const zipFile of zips) {
  const publish = publishArgs(zipFile, platform, options)
  console.log(`${dryRun ? '(dry-run) ' : ''}${DEPLOY} ${publish.join(' ')}`)
  if (!dryRun) execFileSync(DEPLOY, publish, { stdio: 'inherit' })
}
