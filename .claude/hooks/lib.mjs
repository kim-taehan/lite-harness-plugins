// 훅 공용 (desktop 의 .claude/hooks/lib.mjs 와 같음): stdin 의 훅 입력(JSON)을 읽고, 막을 때는 사유를 stderr 로 내고 종료 코드 2.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export async function readHookInput() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  const command = input.tool_input?.command ?? ''
  return { input, command, cwd: commandDir(command, input.cwd ?? process.cwd()) }
}

// 따옴표 경로("…" · '…') 또는 공백·;&| 전까지의 경로
const PATH_ARG = String.raw`(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))`
const LEADING_CD = new RegExp(String.raw`^\s*cd\s+${PATH_ARG}\s*(?:&&|;)`)
const LEADING_EXPORT = /^\s*export\s+[^;&|]*(?:&&|;)/
const GIT_DASH_C = new RegExp(String.raw`\bgit\s+-C\s+${PATH_ARG}`)

// 명령이 실제로 도는 폴더 — 훅 입력의 cwd 는 세션의 원래 폴더라서, 다른 worktree 로 cd 하거나
// git -C 로 가리킨 명령을 엉뚱한 폴더 기준으로 검사하게 된다. 맨 앞의 `cd <폴더> &&`(`;`)를 차례로 따라가고
// (`export …;` 는 건너뜀), `git -C <폴더>` 가 있으면 그 폴더. 상대 경로는 그때까지의 폴더 기준으로 푼다.
export function commandDir(command, cwd) {
  let dir = cwd
  let rest = command
  for (;;) {
    const cd = LEADING_CD.exec(rest)
    if (cd) {
      dir = resolve(dir, cd[1] ?? cd[2] ?? cd[3])
      rest = rest.slice(cd[0].length)
      continue
    }
    const exported = LEADING_EXPORT.exec(rest)
    if (!exported) break
    rest = rest.slice(exported[0].length)
  }
  const gitC = GIT_DASH_C.exec(rest)
  return gitC ? resolve(dir, gitC[1] ?? gitC[2] ?? gitC[3]) : dir
}

// `git <하위 명령>` 을 찾아 그 뒤 인자 문자열을 돌려준다(없으면 undefined). 앞: 줄 처음 · 공백 · ; & | ( ` ' " 뒤 —
// `bash -c 'git …'` · `(cd x && git …)` · 경로 붙은 git 도. git 과 하위 명령 사이의 전역 옵션(`-c 값` · `-C 값` · `--no-pager` ·
// `--git-dir=…` 등)은 건너뛴다. 막는 쪽으로 넓게 잡는다 — 문자열 안의 git 명령까지 잡혀도 검사가 한 번 더 돌 뿐이다.
export function gitArgs(command, subcommand) {
  const pattern = new RegExp(String.raw`(?:^|[\s;&|(\`'"])(?:\S*\/)?git(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+${subcommand}\b([^;&|\n\`'")]*)`)
  return pattern.exec(command)?.[1]
}

export function block(reason) {
  process.stderr.write(reason + '\n')
  process.exit(2)
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}
