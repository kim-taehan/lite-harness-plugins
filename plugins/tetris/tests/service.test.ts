// 테트리스 서비스 — 앱 없이 SDK 가짜 host(sdk/litecode-service-testing.mjs)로 본다.
// 앱이 서비스를 올리고 패널이 service.call 로 묻는 것은 앱(개발 모드)에서 확인한다 — 가짜 host 가 흉내 내지 못한다.
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
let bundle: (host: unknown) => never
beforeAll(async () => {
  // 서비스는 묶어서 시험한다 — zip 에 들어가는 service.mjs 와 같은 묶음
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0]!.text).toString('base64'))).default
})

function start(store = new Map<string, unknown>()) {
  const fake = createFakeHost({
    id: 'tetris',
    scope: 'app',
    calls: {
      'storage.get': (params) => store.get((params as { key: string }).key) ?? null,
      'storage.set': (params) => void store.set((params as { key: string }).key, (params as { value: unknown }).value),
    },
  })
  fake.mount(bundle)
  return { fake, store }
}

describe('tetris 서비스', () => {
  it('패널이 부를 메서드를 올린다', () => {
    expect(start().fake.names().sort()).toEqual(['best', 'submit'])
  })

  it('처음엔 최고 점수가 0 이다', async () => {
    expect(await start().fake.call('best')).toEqual({ best: 0 })
  })

  it('더 높은 점수만 기록하고 저장한다', async () => {
    const { fake, store } = start()
    expect(await fake.call('submit', { score: 500, lines: 4 })).toEqual({ best: 500, record: true })
    expect(await fake.call('submit', { score: 300, lines: 2 })).toEqual({ best: 500, record: false })
    expect(await fake.call('best')).toEqual({ best: 500 })
    expect(store.get('best')).toEqual({ score: 500, lines: 4 })
  })

  it('앱을 다시 켜도 저장된 최고 점수가 이어진다', async () => {
    const first = start()
    await first.fake.call('submit', { score: 800, lines: 8 })
    expect(await start(first.store).fake.call('best')).toEqual({ best: 800 })
  })

  it('점수가 아닌 값은 거절한다', async () => {
    const { fake } = start()
    for (const score of [-1, 1.5, '9', undefined]) await expect(fake.call('submit', { score })).rejects.toThrow()
  })

  it('서비스를 내린 뒤에는 부를 수 없다', async () => {
    const { fake } = start()
    await fake.dispose()
    await expect(fake.call('best')).rejects.toThrow()
  })
})
