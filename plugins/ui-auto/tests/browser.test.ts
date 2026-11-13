// 브라우저 잠금 — 같은 프로젝트의 대화들이 한 탭을 같이 쓰다 서로 페이지를 옮기고 창을 닫던 문제(2026-11-13)
import { describe, expect, it } from 'vitest'
import { AI_IDLE_MS, Browser, OTHER_CONVERSATION, textOf, type ToolResult } from '../server/browser.ts'
import { createTools } from '../server/index.ts'
import { project } from './helper.ts'

function fakeBrowser() {
  let now = 0
  const browser = new Browser(project(false), () => now)
  const calls: string[] = []
  browser.call = async (name) => {
    calls.push(name)
    return { content: [{ type: 'text', text: 'ok' }] }
  }
  return { browser, calls, advance: (ms: number) => (now += ms) }
}

const refused = (result: ToolResult) => result.isError === true && textOf(result) === OTHER_CONVERSATION

describe('browser lock between conversations', () => {
  it('another conversation is refused until the holder closes the browser', async () => {
    const { browser, calls } = fakeBrowser()
    await browser.relay('browser_navigate', { url: 'a' }, 'c1')
    expect(refused(await browser.relay('browser_navigate', { url: 'b' }, 'c2'))).toBe(true)
    expect(refused(await browser.relay('browser_close', {}, 'c2'))).toBe(true) // 남의 창을 닫지 못한다
    expect((await browser.relay('browser_click', {}, 'c1')).isError).toBeUndefined()
    await browser.relay('browser_close', {}, 'c1')
    expect((await browser.relay('browser_navigate', { url: 'b' }, 'c2')).isError).toBeUndefined()
    expect(calls).toEqual(['browser_navigate', 'browser_click', 'browser_close', 'browser_navigate'])
  })

  it('the lock lapses after the holder stays idle', async () => {
    const { browser, advance } = fakeBrowser()
    await browser.relay('browser_navigate', {}, 'c1')
    advance(AI_IDLE_MS + 1)
    expect((await browser.relay('browser_navigate', {}, 'c2')).isError).toBeUndefined()
    expect(refused(await browser.relay('browser_click', {}, 'c1'))).toBe(true)
  })

  it('calls without a conversation id are not refused, and a known id takes over the lock', async () => {
    const { browser } = fakeBrowser()
    await browser.relay('browser_navigate', {})
    expect((await browser.relay('browser_click', {}, 'c1')).isError).toBeUndefined()
    expect((await browser.relay('browser_click', {})).isError).toBeUndefined()
    expect(refused(await browser.relay('browser_click', {}, 'c2'))).toBe(true)
  })

  it('begin warns, capture and login refuse while another conversation holds the browser', async () => {
    const { browser, calls } = fakeBrowser()
    const { own } = createTools(project(), browser)
    const run = (name: string, args: Record<string, unknown>, conversation: string) => own.find((tool) => tool.name === name)!.run(args, conversation)
    await browser.relay('browser_navigate', {}, 'c1')
    expect(textOf(await run('begin', { kind: 'run' }, 'c2'))).toContain(`브라우저: ${OTHER_CONVERSATION}`)
    expect(textOf(await run('begin', { kind: 'run' }, 'c1'))).not.toContain('브라우저:')
    expect(refused(await run('capture', { file: '.litecode/ui-auto/captures/p/x.png' }, 'c2'))).toBe(true)
    expect(refused(await run('login', {}, 'c2'))).toBe(true)
    expect(calls).toEqual(['browser_navigate'])
  })
})
