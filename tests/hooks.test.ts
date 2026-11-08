// .claude/hooks 의 검사가 막아야 할 명령을 막고, 상관없는 명령은 통과시키는지 — 훅에 실제 입력(JSON)을 넣어 종료 코드를 본다(2 = 막음).
// 명령 모양(전역 옵션 · bash -c · 강제 push · worktree)이 빠져나가지 않게 고정한다.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const hooks = path.resolve(import.meta.dirname, '..', '.claude', 'hooks')
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function run(hook: string, toolInput: Record<string, string>, cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(hooks, `${hook}.mjs`)], {
    input: JSON.stringify({ tool_input: toolInput, cwd }),
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return result.status
}

let base: string
let repo: string
let worktree: string
let other: string

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'hooks-test-'))
  repo = path.join(base, 'repo')
  worktree = path.join(base, 'wt')
  other = path.join(base, 'other')
  for (const dir of [repo, other]) {
    mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true })
    writeFileSync(path.join(dir, '.claude', 'rules', 'rule.md'), '# 규칙\n')
    writeFileSync(path.join(dir, '.gitignore'), '.claude/.convention-state\n')
    git(dir, 'init', '-q', '-b', 'feature')
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  }
  git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree)
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

const G = 'git'
describe('block-protected-push — main 으로 가는 push 를 막는다', () => {
  it.each([
    `${G} push origin main`,
    `${G} push origin +main`,
    `${G} push -f origin HEAD:refs/heads/main`,
    `${G} push origin feature +HEAD:main`,
    `${G} --no-pager push origin main`,
    `${G} -c push.default=current push origin main`,
    `bash -c '${G} push origin main'`,
    `(cd . && ${G} push origin main)`,
    `/usr/bin/${G} push origin main`,
  ])('막음: %s', (command) => {
    expect(run('block-protected-push', { command }, repo)).toBe(2)
  })
  it.each([`${G} push origin feature`, `${G} push -u origin feature`, `${G} push`, `${G} status`])('통과: %s', (command) => {
    expect(run('block-protected-push', { command }, repo)).toBe(0)
  })
})

describe('require-convention-review — 심사 상태가 지금 변경과 같을 때만 커밋', () => {
  const commits = [`${G} commit -m x`, `${G} --no-pager commit -m x`, `bash -c '${G} commit -m x'`, `echo a; ${G} -C . commit -m x`]
  it.each(commits)('심사 전 막음: %s', (command) => {
    expect(run('require-convention-review', { command }, other)).toBe(2)
  })
  it('심사 상태를 저장하면 통과, 커밋 아닌 명령은 늘 통과', () => {
    execFileSync(process.execPath, [path.join(hooks, 'convention-state.mjs'), 'store'], { cwd: other })
    for (const command of commits) expect(run('require-convention-review', { command }, other)).toBe(0)
    writeFileSync(path.join(other, 'new.txt'), '심사 뒤 생긴 파일\n')
    expect(run('require-convention-review', { command: commits[0] }, other)).toBe(2)
    expect(run('require-convention-review', { command: `${G} log` }, other)).toBe(0)
  })
})

describe('block-hand-edit — catalog.json · dist/ 손편집을 막는다 (이 저장소의 worktree 포함)', () => {
  const edit = (file: string) => run('block-hand-edit', { file_path: file }, repo, { CLAUDE_PROJECT_DIR: repo })
  it('프로젝트 폴더 · 그 worktree 의 catalog.json · dist/ 는 막음', () => {
    expect(edit('catalog.json')).toBe(2)
    expect(edit(path.join(repo, 'dist', 'a.zip'))).toBe(2)
    expect(edit(path.join(worktree, 'catalog.json'))).toBe(2)
    expect(edit(path.join(worktree, 'dist', 'new', 'a.zip'))).toBe(2)
  })
  it('다른 파일, 다른 저장소의 catalog.json 은 통과', () => {
    expect(edit(path.join(worktree, 'plugins', 'a', 'plugin.json'))).toBe(0)
    expect(edit(path.join(other, 'catalog.json'))).toBe(0)
  })
})
