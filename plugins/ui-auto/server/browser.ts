// 동봉한 Playwright MCP(@playwright/mcp 0.0.83)를 자식 프로세스로 띄우고 도구를 부른다 — AI 의 browser_* 중계와 패널 수행이 같은 브라우저를 쓴다.
// 잠금: 브라우저 하나를 AI 와 패널이 동시에 만지지 않게 한다. AI 는 첫 browser_* 부터 browser_close 까지(또는 오래 쉬면) 쥐고, 패널 수행은 그동안 busy 로 거절된다.
// 같은 프로젝트의 대화들도 한 탭을 같이 쓰므로 대화끼리 잠근다 — 동시에 돌린 대화가 서로 페이지를 옮기고 창을 닫았다(2026-11-13 실측). 대화는 앱이 요청 `_meta` 에 싣는 id 로 가른다.
// opencode 하네스의 실행 옵션 그대로: --isolated --storage-state <세션> --save-session --output-dir --init-script <배지>

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Config } from './config.ts'

/** AI 가 이만큼 browser_* 를 안 부르면 잠금을 푼다(닫기를 잊은 대화) */
export const AI_IDLE_MS = 10 * 60_000
/** 도구 하나의 기한 — 앱의 도구 기한(timeoutMs)보다 짧게 */
const CALL_TIMEOUT_MS = 120_000

export interface ToolResult {
  content: { type: string; text?: string; [key: string]: unknown }[]
  isError?: boolean
}
export interface ToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export type Owner = 'ai' | 'panel'

/** 앱이 확장 MCP 요청 `_meta` 에 싣는 부른 대화 id 의 키 (desktop CONVERSATION_META) */
export const CONVERSATION_META = 'litecode/conversation'

/** 다른 대화가 브라우저를 쥐었을 때 AI 에게 돌려주는 글 — 기다리며 다시 부르면 그 대화의 수행을 또 흔들 수 있어 멈추게 한다 */
export const OTHER_CONVERSATION =
  '같은 프로젝트의 다른 대화가 UI-AUTO 브라우저로 화면을 수행하는 중이라 이 대화는 브라우저를 쓸 수 없습니다. 브라우저 도구를 더 부르지 말고 이 작업을 멈춘 뒤, 다른 대화의 수행이 끝나면 다시 요청하라고 사용자에게 알리세요.'

export const textOf = (result: ToolResult): string => result.content.map((part) => part.text ?? '').filter(Boolean).join('\n')

/** 자식에게 줄 인자 — 시험이 본다 */
export function mcpArgs(config: Config): string[] {
  return [
    path.join(config.extensionDir, 'node_modules', '@playwright', 'mcp', 'cli.js'),
    '--browser', config.channel,
    '--isolated',
    '--storage-state', config.stateFile,
    '--save-session',
    '--output-dir', path.join(config.pluginDir, 'mcp'),
    '--init-script', path.join(config.extensionDir, 'assets', 'browser-badge.js'),
    ...(config.headless ? ['--headless'] : []),
  ]
}

/** Playwright MCP 는 세션 파일이 없으면 브라우저를 열지 못한다 — 빈 세션을 둔다 */
export function ensureState(file: string): void {
  if (existsSync(file)) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }))
}

export interface Caller {
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
}

/** 캡처에 표시할 요소 — 스크립트 단계의 target(locator) · element(사람 말) */
export interface Mark {
  target: string
  element?: string
}

/** 요소 둘레에 붉은 번호 상자를 페이지 안에 그린다 — 캡처에 그대로 남아 패널 · PDF · 가이드 md 어디서 열어도 보인다. 함수 글은 고정이고 번호만 숫자로 넣는다 */
export function markScript(number?: number): string {
  const label = Number.isInteger(number) && number! > 0 ? String(number) : ''
  return `(el) => { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; const box = document.createElement('div'); box.setAttribute('data-ui-auto-mark', ''); box.style.cssText = 'position:fixed;box-sizing:border-box;left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;border:3px solid #e5484d;border-radius:6px;box-shadow:0 0 0 2px rgba(255,255,255,.9);z-index:2147483647;pointer-events:none'; if (${JSON.stringify(label)}) { const tag = document.createElement('span'); tag.textContent = ${JSON.stringify(label)}; tag.style.cssText = 'position:absolute;left:' + Math.max(-14, 2 - r.left) + 'px;top:' + Math.max(-14, 2 - r.top) + 'px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#e5484d;color:#fff;font:700 12px/22px sans-serif;text-align:center;box-shadow:0 0 0 2px #fff'; box.appendChild(tag) } (el.closest('dialog[open]') || document.body).appendChild(box); return true }`
}
const CLEAR_MARKS = `() => { document.querySelectorAll('[data-ui-auto-mark]').forEach((node) => node.remove()); return true }`

/** 표시 → 캡처 → 표시 지우기. 표시하지 못한 요소(없음 · 안 보임)는 건너뛴다 — 그 화면 자체가 증적이다 */
export async function markedShot(caller: Caller, file: string, marks: readonly Mark[], number?: number): Promise<{ result: ToolResult; marked: number }> {
  const attempt = (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    caller.call(name, args).catch((error: unknown) => ({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }))
  let marked = 0
  for (const mark of marks) {
    const done = await attempt('browser_evaluate', { function: markScript(number), target: mark.target, ...(mark.element && { element: mark.element }) })
    if (!done.isError && /\btrue\b/.test(textOf(done))) marked++
  }
  const result = await attempt('browser_take_screenshot', { filename: file })
  if (marks.length) await attempt('browser_evaluate', { function: CLEAR_MARKS })
  return { result, marked }
}

export class Browser implements Caller {
  private client: Promise<Client> | undefined
  private owner: Owner | undefined
  /** AI 가 쥐었을 때 그 대화 id — 모르면(앱이 싣지 못했다) undefined */
  private conversation: string | undefined
  private lastAi = 0
  /** 브라우저 창이 떠 있을 수 있다(도구를 불렀고 아직 닫지 않았다) */
  open = false

  constructor(
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {}

  private connect(): Promise<Client> {
    this.client ??= (async () => {
      ensureState(this.config.stateFile)
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: mcpArgs(this.config),
        cwd: this.config.project,
        env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: '1' },
        stderr: 'ignore',
      })
      const client = new Client({ name: 'ui-auto', version: '0.1.0' })
      transport.onclose = () => {
        this.client = undefined
        this.open = false
      }
      await client.connect(transport)
      return client
    })().catch((error: unknown) => {
      this.client = undefined
      throw error
    })
    return this.client
  }

  async tools(): Promise<ToolInfo[]> {
    const { tools } = await (await this.connect()).listTools()
    return tools as ToolInfo[]
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = (await (await this.connect()).callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })) as ToolResult
    this.open = name !== 'browser_close'
    return result
  }

  /** 지금 쥔 쪽 — AI 가 오래 쉬었으면 풀린 것으로 본다 */
  holder(): Owner | undefined {
    if (this.owner === 'ai' && this.now() - this.lastAi > AI_IDLE_MS) this.owner = undefined
    return this.owner
  }

  /** 다른 대화가 쥐고 있나 — 둘 다 id 를 알 때만 가른다. id 를 모르는 호출은 예전처럼 막지 않는다(자기 대화의 호출을 스스로 막지 않게) */
  heldByOther(conversation: string | undefined): boolean {
    return this.holder() === 'ai' && conversation !== undefined && this.conversation !== undefined && this.conversation !== conversation
  }

  /** AI 의 browser_* 중계 — 패널이나 다른 대화가 쥐고 있으면 거절 */
  async relay(name: string, args: Record<string, unknown>, conversation?: string): Promise<ToolResult> {
    if (this.holder() === 'panel') return { content: [{ type: 'text', text: 'UI-AUTO 패널에서 TC 를 수행하는 중이라 브라우저를 쓸 수 없습니다. 패널 수행이 끝난 뒤 다시 부르세요.' }], isError: true }
    if (this.heldByOther(conversation)) return { content: [{ type: 'text', text: OTHER_CONVERSATION }], isError: true }
    if (this.owner !== 'ai') this.conversation = undefined
    this.owner = 'ai'
    this.conversation ??= conversation
    this.lastAi = this.now()
    try {
      return await this.call(name, args)
    } finally {
      if (name === 'browser_close') {
        this.owner = undefined
        this.conversation = undefined
      }
    }
  }

  /** 패널 수행이 쥔다 — AI 가 쓰는 중이면 false */
  take(): boolean {
    if (this.holder() !== undefined) return false
    this.owner = 'panel'
    return true
  }

  release(): void {
    if (this.owner === 'panel') this.owner = undefined
  }

  /** 열린 창을 닫는다 — 새 세션 파일을 다음 창부터 읽게 (로그인 뒤) */
  async closeWindow(): Promise<void> {
    if (this.open && this.client) await this.call('browser_close', {}).catch(() => undefined)
  }

  async shutdown(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (client) await (await client.catch(() => undefined))?.close().catch(() => undefined)
  }
}
