// convention-review 심사 상태의 지문 — "스테이징 diff + 워크트리 diff + .claude/rules" 해시 (desktop 과 같은 계산).
// 훅(commit 막기)과 스킬(store)이 같은 계산을 쓴다. 심사 뒤 변경이 생기면 지문이 달라져 다시 심사해야 한다.
//   node .claude/hooks/convention-state.mjs          지금 지문 출력
//   node .claude/hooks/convention-state.mjs store    .claude/.convention-state 에 저장
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './lib.mjs'

export const STATE_FILE = '.claude/.convention-state'

export function conventionState(cwd) {
  const hash = createHash('sha256')
  hash.update(git(cwd, 'diff', '--cached'))
  hash.update(git(cwd, 'diff'))
  const rulesDir = join(cwd, '.claude', 'rules')
  for (const name of readdirSync(rulesDir).sort()) hash.update(name).update(readFileSync(join(rulesDir, name)))
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1]?.endsWith('convention-state.mjs')) {
  const state = conventionState(process.cwd())
  if (process.argv[2] === 'store') writeFileSync(join(process.cwd(), STATE_FILE), state + '\n')
  console.log(state)
}
