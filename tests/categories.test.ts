// categories.json — release 가 --category 로 넘기는 분류가 모든 플러그인 폴더에 있는지 (없으면 release 가 멈춘다)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const categories: Record<string, string> = JSON.parse(readFileSync(path.join(root, 'categories.json'), 'utf8'))
const MANIFESTS = ['plugin.json', 'extension.json']

describe('categories.json', () => {
  it('모든 플러그인 폴더에 분류가 있다', () => {
    const ids = readdirSync(path.join(root, 'plugins'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => MANIFESTS.map((name) => path.join(root, 'plugins', entry.name, name)).filter(existsSync).slice(0, 1))
      .map((file) => JSON.parse(readFileSync(file, 'utf8')).id as string)
    expect(ids.filter((id) => !categories[id])).toEqual([])
  })

  it('분류는 game · dev-tool · locale 또는 unlisted', () => {
    expect(Object.values(categories).filter((value) => !['game', 'dev-tool', 'locale', 'unlisted'].includes(value))).toEqual([])
  })
})
