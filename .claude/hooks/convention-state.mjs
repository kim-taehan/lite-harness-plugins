// convention-review 심사 상태의 지문 — "스테이징 diff + 워크트리 diff + 아직 add 안 한 새 파일(경로 · 내용) + .claude/rules" 해시.
// 새 파일을 빼면 심사 뒤 add 와 커밋을 한 명령으로 칠 때 심사 안 된 새 파일이 들어간다.
// 훅(commit 막기)과 스킬(store)이 같은 계산을 쓴다. 심사 뒤 변경이 생기면 지문이 달라져 다시 심사해야 한다.
//   node .claude/hooks/convention-state.mjs          지금 지문 출력
//   node .claude/hooks/convention-state.mjs store    .claude/.convention-state 에 저장
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './lib.mjs'

export const STATE_FILE = '.claude/.convention-state'

export function conventionState(cwd) {
  const hash = createHash('sha256')
  hash.update(git(cwd, 'diff', '--cached'))
  hash.update(git(cwd, 'diff'))
  for (const file of git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()) {
    const full = join(cwd, file)
    const stat = lstatSync(full, { throwIfNoEntry: false })
    hash.update(file).update(!stat ? '' : stat.isSymbolicLink() ? readlinkSync(full) : stat.isFile() ? readFileSync(full) : '')
  }
  const rulesDir = join(cwd, '.claude', 'rules')
  for (const name of readdirSync(rulesDir).sort()) hash.update(name).update(readFileSync(join(rulesDir, name)))
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1]?.endsWith('convention-state.mjs')) {
  const state = conventionState(process.cwd())
  if (process.argv[2] === 'store') writeFileSync(join(process.cwd(), STATE_FILE), state + '\n')
  console.log(state)
}
