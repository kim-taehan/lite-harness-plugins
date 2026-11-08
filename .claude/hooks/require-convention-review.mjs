// git commit 전에 /convention-review 심사를 거쳤는지 확인한다 (.claude/rules/plugin.md, desktop 과 같은 방식).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readHookInput, block, git, gitArgs } from './lib.mjs'
import { conventionState, STATE_FILE } from './convention-state.mjs'

const { command, cwd } = await readHookInput()
if (gitArgs(command, 'commit') === undefined) process.exit(0)

let top = cwd
try { top = git(cwd, 'rev-parse', '--show-toplevel').trim() } catch {}
let stored = ''
try { stored = readFileSync(join(top, STATE_FILE), 'utf8').trim() } catch {}
if (stored && stored === conventionState(top)) process.exit(0)

block('커밋 전에 규칙 심사가 필요합니다. /convention-review 로 변경을 .claude/rules 와 대조하고, 위반이 없으면 스킬의 마지막 단계(node .claude/hooks/convention-state.mjs store)를 실행한 뒤 다시 커밋해 주세요.')
