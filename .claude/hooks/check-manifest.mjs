// git commit 전에 바뀐 플러그인 manifest 를 검사한다 — 앱이 거절하는 모양(글자 수 · id)과 표준 테스트(tests/standards.test.ts)를 커밋 앞에서 막는다.
// 한도의 정본은 desktop shared/extensions/limits.ts(nameLength 80 · descriptionLength 300 · detailsLength 2000) — 넘으면 설치가 text-invalid 로 거절된다.
// 가벼운 검사(글자 수 · JSON · 폴더 이름 = id)는 의존성 없이 늘 돌고, vitest 가 설치돼 있으면 표준 테스트도 돌린다(없으면 건너뛴다 — 머지 훅이 npm run test:changed 로 한 번 더 막는다).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readHookInput, block, git, gitArgs } from './lib.mjs'

const LIMITS = { name: 80, description: 300, details: 2000 }

const { command, cwd } = await readHookInput()
if (gitArgs(command, 'commit') === undefined) process.exit(0)

let top
try { top = git(cwd, 'rev-parse', '--show-toplevel').trim() } catch { process.exit(0) }

// 스테이징 + 워크트리의 바뀐 파일 (첫 커밋이라 HEAD 가 없으면 스테이징만)
let changed = []
try { changed = git(top, 'diff', '--name-only', 'HEAD').split('\n') } catch {
  try { changed = git(top, 'diff', '--cached', '--name-only').split('\n') } catch {}
}
changed = changed.filter(Boolean)

const problems = []
for (const file of changed) {
  const match = /^plugins\/([^/]+)\/(?:plugin|extension)\.json$/.exec(file)
  const full = join(top, file)
  if (!match || !existsSync(full)) continue
  let manifest
  try { manifest = JSON.parse(readFileSync(full, 'utf8')) } catch (error) {
    problems.push(`${file}: JSON 이 아닙니다 — ${error.message}`)
    continue
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = manifest[field]
    if (typeof value === 'string' && value.length > max) problems.push(`${file}: ${field} 이(가) ${value.length}자입니다 — 앱 한도 ${max}자를 넘으면 설치가 거절됩니다(text-invalid). 줄이고 자세한 것은 README.md 로 보내세요.`)
  }
  if (manifest.id !== match[1]) problems.push(`${file}: id "${manifest.id}" 가 폴더 이름 "${match[1]}" 과 다릅니다.`)
}
if (problems.length) block(`플러그인 manifest 가 앱 설치 검사를 통과하지 못합니다:\n- ${problems.join('\n- ')}`)

// 표준 테스트 — 플러그인 · 표준 · 이 테스트가 바뀌었을 때만
const touches = changed.some((file) => file.startsWith('plugins/') || file === 'tests/standards.test.ts' || file === '.claude/rules/plugin.md' || file === 'sdk/litecode-service.d.ts')
const vitest = join(top, 'node_modules', 'vitest', 'vitest.mjs')
if (touches && existsSync(vitest)) {
  const result = spawnSync(process.execPath, [vitest, 'run', 'tests/standards.test.ts', '--reporter=dot'], { cwd: top, encoding: 'utf8', timeout: 150_000 })
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')
    block(`표준 테스트(tests/standards.test.ts)가 실패해 커밋을 막았습니다. 고친 뒤 다시 커밋하세요:\n${tail}`)
  }
}
