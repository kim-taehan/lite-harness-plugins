// npm run new-plugin — 새 서비스 플러그인 뼈대가 표준에 맞는 모양으로 만들어지고, 잘못된 입력은 거절하는지.
// 만든 플러그인이 실제로 테스트와 표준 검사를 통과하는지는 PR 에서 직접 돌려 확인했다(저장소에 임시 플러그인을 만들 수 없어서 여기서는 모양만 본다).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { transformSync } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error .mjs 스크립트 — 타입 선언 없음
import { scaffold } from '../scripts/new-plugin.mjs'

type Scaffold = (options: { root: string; id: string; name?: string; scope?: string }) => string[]
const make = scaffold as Scaffold

const dirs: string[] = []
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'new-plugin-'))
  dirs.push(root)
  mkdirSync(path.join(root, 'plugins'), { recursive: true })
  writeFileSync(path.join(root, 'categories.json'), '{\n  "token-pet": "game"\n}\n')
  return root
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('new-plugin 뼈대', () => {
  it('서비스 플러그인의 최소 파일을 만든다', () => {
    const root = repo()
    const created = make({ root, id: 'my-tool', name: '내 도구', scope: 'app' })
    expect(created.sort()).toEqual(['build.mjs', 'changes.txt', 'index.html', 'plugin.json', 'README.md', 'service/index.mjs', 'tests/service.test.ts'].map((file) => `plugins/my-tool/${file}`).sort())
    for (const file of created) expect(existsSync(path.join(root, file))).toBe(true)
  })

  it('plugin.json 은 표준 모양이다 — scope · 권한 service · service 선언 · 0.1.0', () => {
    const root = repo()
    make({ root, id: 'my-tool', name: '내 도구', scope: 'project' })
    const manifest = JSON.parse(readFileSync(path.join(root, 'plugins/my-tool/plugin.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'my-tool', name: '내 도구', version: '0.1.0', scope: 'project', entry: 'index.html', permissions: ['service'], service: { main: 'service.mjs', api: 1 } })
    expect(Object.keys(manifest).sort()).toEqual(['description', 'entry', 'id', 'name', 'permissions', 'scope', 'service', 'version'])
  })

  it('scope 를 안 주면 project, 이름을 안 주면 id', () => {
    const root = repo()
    make({ root, id: 'plain' })
    const manifest = JSON.parse(readFileSync(path.join(root, 'plugins/plain/plugin.json'), 'utf8'))
    expect(manifest.scope).toBe('project')
    expect(manifest.name).toBe('plain')
  })

  it('categories.json 에 unlisted 로 더하고 기존 줄은 둔다', () => {
    const root = repo()
    make({ root, id: 'my-tool' })
    expect(JSON.parse(readFileSync(path.join(root, 'categories.json'), 'utf8'))).toEqual({ 'my-tool': 'unlisted', 'token-pet': 'game' })
  })

  it('서비스 소스는 cordis · 바깥 요청이 없고 README 에 세 절이 있다', () => {
    const root = repo()
    make({ root, id: 'my-tool' })
    const source = readFileSync(path.join(root, 'plugins/my-tool/service/index.mjs'), 'utf8')
    expect(source).toContain('class MyTool extends host.Service')
    // 주석에는 설명으로 쓰인 낱말이 있어 걷어 내고 본다(표준 24번 점검과 같은 방식)
    expect(transformSync(source, { loader: 'js', format: 'esm' }).code).not.toMatch(/cordis|node:http|\bfetch\s*\(/)
    const readme = readFileSync(path.join(root, 'plugins/my-tool/README.md'), 'utf8')
    for (const title of ['역할', '구성', '개발']) expect(readme).toMatch(new RegExp(`^## ${title}\\s*$`, 'm'))
    expect(readFileSync(path.join(root, 'plugins/my-tool/build.mjs'), 'utf8')).toContain("'--dir'")
  })

  it.each(['ab', 'Abc', 'has_underscore', 'x'.repeat(41), ''])('거절: 잘못된 id %j', (id) => {
    expect(() => make({ root: repo(), id })).toThrow(/id/)
  })

  it('이미 있는 id 는 거절한다', () => {
    const root = repo()
    make({ root, id: 'my-tool' })
    expect(() => make({ root, id: 'my-tool' })).toThrow(/이미 있습니다/)
  })

  it('모르는 scope 는 거절한다', () => {
    expect(() => make({ root: repo(), id: 'my-tool', scope: 'global' })).toThrow(/scope/)
  })

  it('숫자로 시작하는 id 도 클래스 이름이 된다', () => {
    const root = repo()
    make({ root, id: '3d-view' })
    expect(readFileSync(path.join(root, 'plugins/3d-view/service/index.mjs'), 'utf8')).toContain('class P3dView extends host.Service')
  })
})
