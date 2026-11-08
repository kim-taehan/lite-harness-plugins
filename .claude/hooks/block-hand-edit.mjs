// catalog.json · dist/ 를 파일 편집 도구로 고치지 못하게 막는다 — npm run release 로만 바꾼다.
// 앱은 받은 zip 의 sha256 이 catalog 와 같을 때만 설치하므로, 손으로 고쳐 어긋나면 모든 PC 에서 설치가 실패한다.
// 이 저장소의 다른 worktree(같은 .git 을 쓰는 폴더) 안의 catalog.json · dist/ 도 막는다 — 작업은 보통 worktree 에서 한다.
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { readHookInput, block, git } from './lib.mjs'

const { input } = await readHookInput()
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path
if (!file) process.exit(0)

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
const target = path.resolve(root, file)

// 파일이 든 저장소가 이 저장소(같은 git common dir)면 그 worktree 맨 위 기준, 아니면 이 프로젝트 폴더 기준.
// 경로는 git 에게 묻는다(--show-prefix) — macOS 의 /var ↔ /private/var 처럼 같은 폴더가 두 이름일 수 있어서
const commonDir = (dir) => realpathSync(path.resolve(dir, git(dir, 'rev-parse', '--git-common-dir').trim()))
let relative = path.relative(root, target)
let dir = path.dirname(target)
while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir)
try {
  if (commonDir(dir) === commonDir(root)) relative = git(dir, 'rev-parse', '--show-prefix').trim() + path.relative(dir, target)
} catch {}
relative = relative.split(path.sep).join('/')

if (relative === 'catalog.json' || relative.startsWith('dist/')) {
  block(`${relative} 는 손으로 고치지 않습니다. npm run release 로 바꿔 주세요 (docs/guides/publish.md).`)
}
