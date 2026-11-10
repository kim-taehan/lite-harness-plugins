// 드라이버 (#1248, 계획 §2-2) — 대상마다 하나: check()(실행 환경 확인) · run(cases) → 결과. 지금은 web(Playwright) 하나, client · mobile 은 나중에 더한다.
// web: 플러그인에 든 playwright-core 로 PC 에 설치된 Chrome · Edge 를 channel 로 띄운다(D2 · D3 — 브라우저를 내려받지 않는다)

import { pathToFileURL } from 'node:url'
import type { Channel } from './config.ts'
import { channelLabel } from './config.ts'
import { rowLabel } from './scenario.ts'
import { runCase, type Account, type CaseInput, type PageLike, type Spec } from './steps.ts'
import type { CaseResult, CaseStatus, DataTable, RowResult, ScenarioStep, StepResult } from './types.ts'

/** 케이스마다 새 브라우저 창 크기 — 화면 배율 0.75 로 스크린샷이 960×600 (결과서 크기, 계획 2 단계 위험 고침) */
export const VIEWPORT = { width: 1280, height: 800 }
export const DEVICE_SCALE = 0.75

export interface DriverCase {
  id: string
  title: string
  steps: ScenarioStep[]
  /** 생성 코드 절대 경로 */
  specFile: string
  /** `## 데이터` 표 — 있으면 행마다 새 창으로 한 번씩 */
  data?: DataTable
}

export interface DriverRunOptions {
  headed: boolean
  account: Account
  baseUrl: string
  secrets: string[]
  save: (name: string, bytes: Uint8Array) => Promise<string>
  onCase?: (index: number, result: Partial<CaseResult> & { steps: StepResult[] }) => void
  stopped: () => boolean
}

export interface CheckResult {
  ok: boolean
  text: string
}

export interface Driver {
  readonly target: string
  /** 쓰는 브라우저 이름 (결과서 머리) */
  browserName(): string
  check(url: string): Promise<CheckResult>
  run(cases: DriverCase[], options: DriverRunOptions): Promise<CaseResult[]>
  /** 결과서 · 가이드 HTML(절대 경로)을 인쇄 모양으로 PDF 에 쓴다 — 화면 없이 브라우저를 한 번 띄운다 */
  pdf(input: string, output: string): Promise<void>
  /** 멈추기 — 떠 있는 브라우저를 닫는다 */
  stop(): Promise<void>
}

/** Playwright 에서 쓰는 부분만 — 시험에서 가짜로 바꾼다 */
export interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>
  close(): Promise<void>
}
export type Launch = (options: { channel: Channel; headless: boolean }) => Promise<BrowserLike>

export const SUPPORTED_TARGETS = ['web'] as const

export function driverFor(target: string, config: { channel: Channel }, launch?: Launch): Driver {
  if (target === 'web') return new WebDriver(config.channel, launch)
  throw new Error(`아직 없는 대상입니다: ${target} (지금은 ${SUPPORTED_TARGETS.join(' · ')})`)
}

/** 브라우저 프로세스에 넘기는 환경변수 — 기록 저장소 번호표(LITECODE_DB_*)는 넘기지 않는다(브라우저에 토큰이 따라가지 않게) */
export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !entry[0].startsWith('LITECODE_DB_')))
}

/** 브라우저에 넘기는 옵션 — Chrome 의 HTTPS-First 자동 켜기를 끈다(빈 프로필로 뜨는 시험 브라우저가 IP 주소의 http:// 를 ERR_BLOCKED_BY_CLIENT 로 막는다) */
export const BROWSER_ARGS = ['--disable-features=HttpsFirstBalancedModeAutoEnable']

const playwrightLaunch: Launch = async ({ channel, headless }) => {
  const { chromium } = await import('playwright-core')
  return (await chromium.launch({ channel, headless, args: BROWSER_ARGS, env: browserEnv(process.env) })) as unknown as BrowserLike
}

/** 생성 코드 불러오기 — 고쳐 쓴 파일을 다시 읽게 주소에 시각을 붙인다 */
export async function loadSpec(file: string): Promise<Spec> {
  const loaded = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: unknown }
  if (typeof loaded.default !== 'function') throw new Error('생성 코드가 export default async ({ step, page, expect }) => { … } 모양이 아닙니다')
  return loaded.default as Spec
}

/** 창 · 브라우저가 닫혀서 난 오류 — 정리 중에 떠 있던 기다리기가 내는 소음 */
const CLOSED = /closed|Target page|Browser has been|Execution context was destroyed/i

export class WebDriver implements Driver {
  readonly target = 'web'
  private browser: BrowserLike | undefined
  private used: Channel
  /** 수행 중 처리되지 않은 Promise 실패의 첫 줄 — 케이스가 끝날 때마다 비운다 */
  private stray: string[] = []

  constructor(
    private readonly channel: Channel,
    private readonly launch: Launch = playwrightLaunch,
    private readonly load: (file: string) => Promise<Spec> = loadSpec,
  ) {
    this.used = channel
  }

  browserName(): string {
    return `${channelLabel(this.used)} (PC 설치본)`
  }

  /** 고른 브라우저 → 안 되면 다른 것 (Chrome ↔ Edge) */
  private async open(headless: boolean): Promise<BrowserLike> {
    const order: Channel[] = this.channel === 'msedge' ? ['msedge', 'chrome'] : ['chrome', 'msedge']
    const errors: string[] = []
    for (const channel of order) {
      try {
        const browser = await this.launch({ channel, headless })
        this.used = channel
        return browser
      } catch (error) {
        errors.push(`${channelLabel(channel)}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`)
      }
    }
    throw new Error(`PC 에 설치된 Chrome · Edge 를 띄우지 못했습니다 — ${errors.join(' / ')}`)
  }

  async check(url: string): Promise<CheckResult> {
    if (!url) return { ok: false, text: '대상 주소가 비어 있습니다' }
    const started = Date.now()
    const browser = await this.open(true)
    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      const response = (await (page['goto'] as (u: string, o: unknown) => Promise<{ status(): number } | null>)(url, { timeout: 15_000 })) ?? undefined
      const title = page.title ? await page.title() : ''
      const status = response?.status()
      const ok = status === undefined || status < 400
      return { ok, text: `${ok ? '열림' : '열렸지만 오류'} — ${url} · HTTP ${status ?? '-'} · 제목 "${title}" · ${channelLabel(this.used)} (${Date.now() - started}ms)` }
    } catch (error) {
      return { ok: false, text: `열지 못함 — ${url}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}` }
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  async pdf(input: string, output: string): Promise<void> {
    const browser = await this.open(true)
    try {
      const context = await browser.newContext({ colorScheme: 'light' })
      const page = (await context.newPage()) as PageLike & { goto(url: string, options: unknown): Promise<unknown>; emulateMedia(options: unknown): Promise<void>; pdf(options: unknown): Promise<unknown> }
      await page.goto(pathToFileURL(input).href, { waitUntil: 'load', timeout: 30_000 })
      await page.emulateMedia({ media: 'print' })
      await page.pdf({ path: output, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  async run(cases: DriverCase[], options: DriverRunOptions): Promise<CaseResult[]> {
    const results: CaseResult[] = []
    this.browser = await this.open(!options.headed)
    // 생성 코드가 기다리지 않고 걸어 둔 Promise(예: `const r = page.waitForResponse(…)` 를 await 하지 못한 채 단계가 실패) 는
    // 창이 닫힐 때 reject 되어 unhandledRejection 으로 Node 프로세스를 통째로 죽인다 — 수행 동안 받아 그 케이스의 일로 센다
    const onStray = (reason: unknown): void => {
      this.stray.push(reason instanceof Error ? reason.message.split('\n')[0]! : String(reason))
    }
    process.on('unhandledRejection', onStray)
    try {
      for (const [index, item] of cases.entries()) {
        if (options.stopped()) {
          results.push({ id: item.id, title: item.title, status: 'stopped', durationMs: 0, steps: [] })
          continue
        }
        options.onCase?.(index, { status: undefined, steps: [] })
        let spec: Spec
        try {
          spec = await this.load(item.specFile)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const result: CaseResult = { id: item.id, title: item.title, status: 'failed', durationMs: 0, steps: [], error: message, failKind: 'script' }
          results.push(result)
          options.onCase?.(index, result)
          continue
        }
        const input: CaseInput = { id: item.id, title: item.title, steps: item.steps, spec }
        const table = item.data
        if (!table) {
          const result = await this.safely(item, options, () => this.once(input, options, index, (steps) => options.onCase?.(index, { steps })))
          results.push(result)
          options.onCase?.(index, result)
          continue
        }
        // 데이터 표 — 행마다 새 창, 행 하나가 실패해도 다음 행을 돈다(멈추기만 멈춘다)
        const rows: RowResult[] = []
        for (const [at, values] of table.rows.entries()) {
          const label = rowLabel(table, at)
          if (options.stopped()) {
            rows.push({ row: at + 1, label, status: 'stopped', durationMs: 0, steps: [] })
            continue
          }
          const result = await this.safely(item, options, () => this.once(input, options, index, (steps) => options.onCase?.(index, { steps: [], rows: [...rows, { row: at + 1, label, status: 'passed', durationMs: 0, steps }] }), { no: at + 1, label, values }))
          rows.push({ row: at + 1, label, status: result.status, durationMs: result.durationMs, steps: result.steps, ...(result.error && { error: result.error }), ...(result.failKind && { failKind: result.failKind }) })
          options.onCase?.(index, { steps: [], rows: [...rows] })
        }
        const result: CaseResult = { id: item.id, title: item.title, status: caseStatus(rows), durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0), steps: [], rows }
        results.push(result)
        options.onCase?.(index, result)
      }
    } finally {
      process.off('unhandledRejection', onStray)
      await this.stop()
    }
    return results
  }

  /** 창을 열다 · 닫다 깨져도(멈추기로 브라우저가 닫힘 등) 수행 전체가 깨지지 않게 — 멈춤이면 멈춤, 아니면 그 케이스만 실패 */
  private async safely(item: DriverCase, options: DriverRunOptions, work: () => Promise<CaseResult>): Promise<CaseResult> {
    this.stray = []
    let result: CaseResult
    try {
      result = await work()
    } catch (error) {
      if (options.stopped()) result = { id: item.id, title: item.title, status: 'stopped', durationMs: 0, steps: [] }
      else {
        const message = error instanceof Error ? error.message.split('\n')[0]! : String(error)
        result = { id: item.id, title: item.title, status: 'failed', durationMs: 0, steps: [], error: message, failKind: 'navigation' }
      }
    }
    return this.withStray(result)
  }

  /** 창을 닫는 순간 reject 되는 따로 뜬 Promise 의 소식은 이 케이스에 이어 붙인다 — 이미 실패한 케이스는 그대로 두고, 성공으로 끝난 케이스에서 창이 닫혀서 난 오류(Target closed 따위)는 소음이라 무시하고, 그 밖의 처리 안 된 실패는 케이스를 실패로 바꾼다 */
  private async withStray(result: CaseResult): Promise<CaseResult> {
    await new Promise((resolve) => setImmediate(resolve)) // unhandledRejection 은 다음 틱에 온다
    const real = this.stray.filter((message) => !CLOSED.test(message))
    this.stray = []
    if (result.status !== 'passed' || real.length === 0) return result
    return { ...result, status: 'failed', error: `처리되지 않은 Promise 실패: ${real[0]} — 기다리기(waitForResponse 따위)는 동작과 묶어 await Promise.all([…]) 로 쓰세요`, failKind: 'script' }
  }

  /** 새 창 하나로 케이스(또는 데이터 표 한 행)를 한 번 */
  private async once(input: CaseInput, options: DriverRunOptions, index: number, onStep: (steps: StepResult[]) => void, row?: { no: number; label: string; values: Record<string, string> }): Promise<CaseResult> {
    const context = await this.browser!.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE, ...(options.baseUrl && { baseURL: options.baseUrl }) })
    try {
      const page = await context.newPage()
      return await runCase(input, { page, account: options.account, baseUrl: options.baseUrl, save: options.save, secrets: options.secrets, stopped: options.stopped, onStep, ...(row && { row }) }, index)
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    const browser = this.browser
    this.browser = undefined
    await browser?.close().catch(() => undefined)
  }
}

/** 행들의 결과 → 케이스 결과: 하나라도 실패면 실패, 아니면 멈춘 것이 있으면 멈춤, 다 성공이면 성공 */
export function caseStatus(rows: RowResult[]): CaseStatus {
  if (rows.some((row) => row.status === 'failed')) return 'failed'
  if (rows.some((row) => row.status === 'stopped')) return 'stopped'
  return rows.length ? 'passed' : 'stopped'
}
