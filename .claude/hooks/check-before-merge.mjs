// gh pr merge 전에 npm run test:changed 를 돌려 종료 코드 0 일 때만 통과.
// 플러그인은 서로 따로라 PR 이 바꾼 플러그인의 테스트만 돌리고, 저장소 공통 검사(표준 · catalog ↔ dist 정합)는 늘 돌린다.
// 공통 파일(의존성 · vitest 설정 · scripts/)이 바뀌면 전부 돌린다 (scripts/test-changed.mjs).
// 지금 폴더에서 검사하므로, 머지하려는 PR 의 브랜치가 지금 폴더에 체크아웃돼 있어야 한다.
import { spawnSync, execFileSync } from 'node:child_process'
import { readHookInput, block, git } from './lib.mjs'

const { command, cwd } = await readHookInput()
const merge = command.match(/(?:^|[;&|\n])\s*(?:\S*\/)?gh\s+pr\s+merge\b([^;&|\n]*)/)
if (!merge) process.exit(0)

const prArg = merge[1].trim().split(/\s+/).find((a) => a && !a.startsWith('-'))
let head = ''
try {
  head = execFileSync('gh', ['pr', 'view', ...(prArg ? [prArg] : []), '--json', 'headRefName', '-q', '.headRefName'], { cwd, encoding: 'utf8' }).trim()
} catch {
  block('머지할 PR 을 찾지 못했습니다. PR 번호를 확인해 주세요.')
}
const current = git(cwd, 'branch', '--show-current').trim()
if (head !== current) block(`지금 폴더의 브랜치(${current})가 PR 브랜치(${head})와 다릅니다. PR 브랜치를 체크아웃한 폴더에서 머지해 주세요 — 그 코드로 검사합니다.`)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = spawnSync(npm, ['run', 'test:changed'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' })
if (run.status !== 0) block(`npm run test:changed 가 종료 코드 ${run.status} 로 실패해서 머지를 막았습니다. 고친 뒤 다시 머지해 주세요.\n${`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-2000)}`)
