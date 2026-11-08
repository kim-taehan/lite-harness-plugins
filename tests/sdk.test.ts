// 27 · sdk/ 는 desktop docs/plugin-sdk/ 생성물의 사본 — 옆 desktop 이 있을 때만 같은지 본다(없으면 건너뜀).
// desktop 은 읽기만 한다. 위치: ../desktop, 다른 곳이면 LITECODE_DESKTOP (scripts/sync-sdk.mjs).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compare, desktopSdk, SDK_FILES } from '../scripts/sync-sdk.mjs'

const source = desktopSdk()

describe('sdk/', () => {
  it('사본 5개가 모두 있다', () => {
    expect(SDK_FILES.filter((file) => !existsSync(path.join(import.meta.dirname, '..', 'sdk', file)))).toEqual([])
  })

  it.skipIf(!source)('옆 desktop 의 docs/plugin-sdk/ 와 같다 (다르면 npm run sync:sdk)', () => {
    expect(compare(source!).filter((entry) => entry.state === 'differs' || entry.state === 'missing-own')).toEqual([])
  })
})
