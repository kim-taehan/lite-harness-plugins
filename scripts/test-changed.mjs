// 바뀐 플러그인의 테스트만 돌린다 — `npm run test:changed [기준 브랜치]` (기본 origin/dev, 없으면 origin/main).
// 저장소 공통 검사(repo 프로젝트: 표준 · catalog ↔ dist 정합)는 늘 돌린다.
// 플러그인 밖의 공통 파일(의존성 · vitest 설정 · scripts/)이 바뀌었으면 전부 돌린다 — 모든 플러그인에 닿을 수 있어서.
// 바뀐 것 = 기준 브랜치와 갈라진 곳부터 지금까지의 커밋 + 커밋 안 된 변경.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const hasRef = (ref) => { try { git('rev-parse', '--verify', '--quiet', ref); return true } catch { return false } }
const base = process.argv[2] ?? (hasRef('origin/dev') ? 'origin/dev' : 'origin/main')
const fork = git('merge-base', 'HEAD', base).trim()
const changed = [...new Set([...git('diff', '--name-only', fork).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean)

const SHARED = [/^package(-lock)?\.json$/, /^vitest\.config\.ts$/, /^scripts\//]
const everything = changed.some((file) => SHARED.some((pattern) => pattern.test(file)))
const plugins = [...new Set(changed.map((file) => file.match(/^plugins\/([^/]+)\//)?.[1]).filter(Boolean))].filter((id) => existsSync(`plugins/${id}/tests`))

const projects = everything ? [] : ['repo', ...plugins].flatMap((name) => ['--project', name])
console.log(everything ? '공통 파일이 바뀌어 전부 돌립니다' : `돌릴 테스트: repo${plugins.length ? ` · ${plugins.join(' · ')}` : ''}`)
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...projects], { stdio: 'inherit' })
process.exit(run.status ?? 1)
