// 동봉한 Playwright MCP(@playwright/mcp 0.0.83)를 자식 프로세스로 띄우고 도구를 부른다 — AI 의 browser_* 중계와 패널 수행이 같은 브라우저를 쓴다.
// 잠금: 브라우저 하나를 AI 와 패널이 동시에 만지지 않게 한다. AI 는 첫 browser_* 부터 browser_close 까지(또는 오래 쉬면) 쥐고, 패널 수행은 그동안 busy 로 거절된다.
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

export class Browser implements Caller {
  private client: Promise<Client> | undefined
  private owner: Owner | undefined
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

  /** AI 의 browser_* 중계 — 패널이 쥐고 있으면 거절 */
  async relay(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (this.holder() === 'panel') return { content: [{ type: 'text', text: 'UI-AUTO 패널에서 TC 를 수행하는 중이라 브라우저를 쓸 수 없습니다. 패널 수행이 끝난 뒤 다시 부르세요.' }], isError: true }
    this.owner = 'ai'
    this.lastAi = this.now()
    try {
      return await this.call(name, args)
    } finally {
      if (name === 'browser_close') this.owner = undefined
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
