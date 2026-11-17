// release — zip 만 만들고 litecode-deploy plugin publish 인자를 넘기는지 (--dry-run 은 서버를 부르지 않는다)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'plugins/service-example/plugin.json'), 'utf8')) as { id: string; version: string }
const run = (...args: string[]) => execFileSync(process.execPath, ['scripts/release.mjs', ...args, '--dry-run'], { cwd: root, encoding: 'utf8' })

describe('release --dry-run', () => {
  it('categories.json 이 unlisted 인 플러그인은 올리지 않고 건너뛴다', () => {
    const categories = JSON.parse(readFileSync(path.join(root, 'categories.json'), 'utf8')) as Record<string, string>
    expect(categories[manifest.id]).toBe('unlisted')
    expect(run(manifest.id)).toContain('건너뜀')
  })

  it('분류 · changes.txt · 서명 옵션을 plugin publish 인자로 넘긴다', () => {
    const out = run('tetris', '--data', '/srv/deploy', '--sign-key', '/keys/priv', '--key-id', 'k1')
    expect(out).toMatch(/litecode-deploy plugin publish .*build\/tetris\.zip --category game --changes-file .*tetris\/changes\.txt --data \/srv\/deploy --sign-key \/keys\/priv --key-id k1/)
  })

  it('--sign-key 만 주면 거절한다', () => {
    expect(() => run('tetris', '--sign-key', '/keys/priv')).toThrow()
  })
})
