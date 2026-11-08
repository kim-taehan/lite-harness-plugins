// release --changed — catalog 에 없거나 version 이 다른 플러그인만 올리는지(--dry-run 은 아무것도 쓰지 않는다)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(path.join(root, 'catalog.json'), 'utf8')) as { extensions: { id: string; version: string; platform?: string }[] }
const categories = JSON.parse(readFileSync(path.join(root, 'categories.json'), 'utf8')) as Record<string, string>
const manifests = readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => ['plugin.json', 'extension.json'].map((name) => path.join(root, 'plugins', entry.name, name)).filter(existsSync).slice(0, 1))
  .map((file) => JSON.parse(readFileSync(file, 'utf8')) as { id: string; version: string })

describe('release --changed', () => {
  it('--dry-run 은 version 이 catalog 와 다르거나 없는 플러그인만 보이고 파일을 쓰지 않는다', () => {
    const before = readFileSync(path.join(root, 'catalog.json'), 'utf8')
    const out = execFileSync(process.execPath, ['scripts/release.mjs', '--changed', '--dry-run'], { cwd: root, encoding: 'utf8' })
    expect(readFileSync(path.join(root, 'catalog.json'), 'utf8')).toBe(before)
    const listed = (out.match(/올릴 플러그인: (.+)/)?.[1] ?? '').split(' · ').filter(Boolean)
    const expected = manifests
      .filter((manifest) => categories[manifest.id] !== 'unlisted')
      .filter((manifest) => !catalog.extensions.some((entry) => entry.id === manifest.id && entry.platform))
      .filter((manifest) => catalog.extensions.find((entry) => entry.id === manifest.id)?.version !== manifest.version)
      .map((manifest) => manifest.id)
    expect(listed.sort()).toEqual(expected.sort())
  })
})
