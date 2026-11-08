import { describe, expect, it } from 'vitest'
import createService from '../service.mjs'

// 앱 없이 서비스 로직만 본다 — 호스트가 넘겨 주는 Service 와 ctx 를 흉내 낸 가짜.
// 실제로 앱이 올리고 패널이 service.call 로 묻는 것은 앱 PR 2 뒤에 앱에서 확인한다.
class FakeService {
  exposed = new Map<string, (params: unknown, caller: { directory?: string }) => unknown>()
  constructor(public ctx: FakeCtx) {}
  expose(name: string, fn: (params: unknown, caller: { directory?: string }) => unknown) {
    this.exposed.set(name, fn)
  }
}
class FakeCtx {
  handlers = new Map<string, (payload: { directory?: unknown }) => void>()
  on(event: string, handler: (payload: { directory?: unknown }) => void) {
    this.handlers.set(event, handler)
  }
}

function start() {
  const ctx = new FakeCtx()
  const Counter = createService({ Service: FakeService }) as new (ctx: FakeCtx) => FakeService
  const service = new Counter(ctx)
  const emit = (directory: unknown) => ctx.handlers.get('chat.turnEnded')?.({ directory })
  const count = (directory?: string) => (service.exposed.get('count') as (p: unknown, c: { directory?: string }) => { turns: number })({}, { directory })
  return { ctx, emit, count }
}

describe('service-example', () => {
  it('chat.turnEnded 만 구독한다', () => {
    expect([...start().ctx.handlers.keys()]).toEqual(['chat.turnEnded'])
  })

  it('프로젝트별로 센다', () => {
    const { emit, count } = start()
    emit('/p/a')
    emit('/p/a')
    emit('/p/b')
    expect(count('/p/a')).toEqual({ turns: 2 })
    expect(count('/p/b')).toEqual({ turns: 1 })
    expect(count('/p/none')).toEqual({ turns: 0 })
  })

  it('호출한 프로젝트를 모르면 0 을 돌려준다', () => {
    const { emit, count } = start()
    emit('/p/a')
    expect(count(undefined)).toEqual({ turns: 0 })
  })

  it('프로젝트를 모르는 소식은 버린다', () => {
    const { emit, count } = start()
    emit(undefined)
    expect(count('undefined')).toEqual({ turns: 0 })
  })
})
