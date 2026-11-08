// gh pr merge 전에 npm run test:changed 를 돌려 종료 코드 0 일 때만 통과.
// 플러그인은 서로 따로라 PR 이 바꾼 플러그인의 테스트만 돌리고, 저장소 공통 검사(표준 · catalog ↔ dist 정합)는 늘 돌린다.
// 공통 파일(의존성 · vitest 설정 · scripts/)이 바뀌면 전부 돌린다 (scripts/test-changed.mjs).
// 지금 폴더에서 검사하므로, 머지하려는 PR 의 마지막 커밋(headRefOid)이 지금 폴더의 HEAD 이고 커밋 안 한 변경이 없어야 한다
// (브랜치 이름만 같으면 push 안 한 커밋 · 커밋 안 한 수정으로 검사하게 된다).
import { spawnSync, execFileSync } from 'node:child_process'
import { readHookInput, block, git } from './lib.mjs'

const { command, cwd } = await readHookInput()
// 경로를 붙인 gh(/opt/homebrew/bin/gh) · command gh · env gh · bash -c "gh pr merge …" 도 잡는다 — 명령 어디든 `gh pr merge`
const merge = command.match(/(?:^|[\s;&|(`'"\/])gh\s+pr\s+merge\b([^;&|\n`'"]*)/)
if (!merge) process.exit(0)

// 값을 받는 옵션의 값은 PR 번호로 읽지 않는다
const VALUED = new Set(['-R', '--repo', '-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit'])
const words = merge[1].trim().split(/\s+/).filter(Boolean)
let prArg
for (let i = 0; i < words.length; i++) {
  if (VALUED.has(words[i])) i++
  else if (!words[i].startsWith('-')) { prArg = words[i]; break }
}
let headOid = ''
try {
  headOid = execFileSync('gh', ['pr', 'view', ...(prArg ? [prArg] : []), '--json', 'headRefOid', '-q', '.headRefOid'], { cwd, encoding: 'utf8' }).trim()
} catch {
  block('머지할 PR 을 찾지 못했습니다. PR 번호를 확인해 주세요.')
}
const current = git(cwd, 'rev-parse', 'HEAD').trim()
if (headOid !== current) block(`지금 폴더의 HEAD(${current.slice(0, 7)})가 PR 의 마지막 커밋(${headOid.slice(0, 7)})과 다릅니다. PR 브랜치를 받아(pull) 같은 커밋에서 머지해 주세요 — 그 코드로 검사합니다.`)
if (git(cwd, 'status', '--porcelain', '--untracked-files=no').trim()) block('커밋 안 한 수정이 있습니다. PR 에 없는 변경으로 검사하지 않게, 커밋하거나 치운 뒤 머지해 주세요.')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = spawnSync(npm, ['run', 'test:changed'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' })
if (run.status !== 0) block(`npm run test:changed 가 종료 코드 ${run.status} 로 실패해서 머지를 막았습니다. 고친 뒤 다시 머지해 주세요.\n${`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-2000)}`)
