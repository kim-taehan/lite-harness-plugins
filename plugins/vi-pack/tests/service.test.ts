// 베트남어 언어 팩 서비스 — 앱 없이 SDK 가짜 host 로 본다. 앱이 서비스를 올리고 내장 사전으로 거르는 것은 앱에서 확인한다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
const messages = JSON.parse(readFileSync(path.join(here, 'locale.json'), 'utf8')) as Record<string, string>
let bundle: (host: unknown) => never
beforeAll(async () => {
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
})

describe('vi-pack 서비스', () => {
  it('올라오면 베트남어 번역을 앱에 올린다', () => {
    const fake = createFakeHost({ id: 'vi-pack', scope: 'app' })
    fake.mount(bundle)
    const [pack, ...rest] = fake.locales()
    expect(rest).toEqual([])
    expect(pack).toMatchObject({ language: 'vi', label: 'Tiếng Việt' })
    expect(Object.keys(pack!.messages)).toHaveLength(Object.keys(messages).length)
    expect(pack!.messages['sidebar.newChat']).toBe(messages['sidebar.newChat'])
  })

  it('번역은 모두 글이다', () => {
    expect(Object.values(messages).every((value) => typeof value === 'string')).toBe(true)
  })

  it('서비스를 내리면 등록한 번역도 걷힌다', async () => {
    const fake = createFakeHost({ id: 'vi-pack', scope: 'app' })
    fake.mount(bundle)
    await fake.dispose()
    expect(fake.locales()).toEqual([])
  })
})
