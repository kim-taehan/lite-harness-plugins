// 로그인 · PDF · [연결 확인] — 플러그인에 든 playwright-core 로 PC 의 Chrome · Edge 를 화면 없이 띄운다(브라우저를 내려받지 않는다).
// 로그인은 opencode 하네스의 auth.setup.ts 를 옮긴 것이다: 로그인 화면에서 아이디 · 비밀번호 칸을 접근성 이름으로 찾아 채우고 세션을 파일로 남긴다.
// 비밀번호는 서버 env 로만 오고 AI 에도 도구 결과에도 나가지 않는다. 칸 이름은 설정 칸(대상 시스템마다 다르다).

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser as PwBrowser, type Locator } from 'playwright-core'
import { loginReady, loginState, scrub, type Channel, type Config } from './config.ts'

async function launch(channel: Channel): Promise<PwBrowser> {
  const order: Channel[] = channel === 'msedge' ? ['msedge', 'chrome'] : ['chrome', 'msedge']
  const errors: string[] = []
  for (const candidate of order) {
    try {
      return await chromium.launch({ channel: candidate, headless: true })
    } catch (error) {
      errors.push(`${candidate}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`)
    }
  }
  throw new Error(`PC 에 설치된 Chrome · Edge 를 띄우지 못했습니다 — ${errors.join(' / ')}`)
}

export const loginUrl = (config: Pick<Config, 'baseUrl' | 'login'>): string => new URL(config.login.path, config.baseUrl + '/').href

/** 로그인 화면인가 — 수행 중 세션이 끝났는지 본다 */
export function onLoginPage(config: Pick<Config, 'baseUrl' | 'login'>, url: string): boolean {
  if (!config.login.path) return false
  try {
    return new URL(url).pathname.startsWith(new URL(loginUrl(config)).pathname)
  } catch {
    return false
  }
}

/** 로그인해 세션을 config.stateFile 에 쓴다. 아이디 · 비밀번호가 없으면 빈 세션.
 *  로그인 화면 경로가 비면 대상 주소를 열어 비밀번호 칸이 보이는 화면을 로그인 화면으로 삼고(찾은 경로는 이번 서버 동안 기억 — 수행 중 세션 만료를 알아보려고),
 *  칸은 설정의 접근성 이름으로 먼저 찾고 없으면 비밀번호 칸 · 그 앞의 글 칸 · 제출 단추로 찾는다 */
export async function login(config: Config): Promise<string> {
  await mkdir(path.dirname(config.stateFile), { recursive: true })
  if (!loginReady(config.login)) {
    await writeFile(config.stateFile, JSON.stringify({ cookies: [], origins: [] }))
    return config.login.user || config.login.password ? `로그인하지 못했습니다 — ${loginState(config.login)}.` : '로그인 설정(아이디 · 비밀번호)이 없어 로그인 없이 씁니다.'
  }
  if (!config.baseUrl) throw new Error('대상 주소가 비어 있습니다')
  const browser = await launch(config.channel)
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(config.login.path ? loginUrl(config) : config.baseUrl, { timeout: 30_000 })
    const password = await pick([page.getByRole('textbox', { name: config.login.passwordField }), page.locator('input[type=password]')], 15_000)
    if (!password) throw new Error(config.login.path ? '로그인 화면에서 비밀번호 칸을 찾지 못했습니다' : '대상 주소에서 로그인 화면(비밀번호 칸)을 찾지 못했습니다 — 이미 로그인 없이 열리는 화면이면 아이디 · 비밀번호를 비우고, 아니면 로그인 화면 경로를 적으세요')
    if (!config.login.path) config.login.path = new URL(page.url()).pathname
    const user = await pick([page.getByRole('textbox', { name: config.login.userField }), page.locator('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button])')], 2_000)
    if (!user) throw new Error('로그인 화면에서 아이디 칸을 찾지 못했습니다')
    await user.fill(config.login.user, { timeout: 15_000 })
    await password.fill(config.login.password, { timeout: 15_000 })
    const button = await pick([page.getByRole('button', { name: config.login.button }), page.locator('button[type=submit], input[type=submit]')], 2_000)
    if (button) await button.click({ timeout: 15_000 })
    else await password.press('Enter')
    await page.waitForURL((url) => !onLoginPage(config, url.href), { timeout: 30_000 })
    await context.storageState({ path: config.stateFile })
    return `로그인했습니다 — 세션을 저장했습니다 (${new URL(page.url()).pathname}).`
  } catch (error) {
    throw new Error(scrub(`로그인하지 못했습니다 — ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}. 설정의 계정 · 로그인 화면 경로 · 칸 이름을 확인하세요.`, [config.login.password]))
  } finally {
    await browser.close().catch(() => undefined)
  }
}

type Field = Locator
/** 후보 locator 중 먼저 보이는 것 하나 — 첫 후보만 기다리고 나머지는 바로 본다 */
async function pick(candidates: Field[], wait: number): Promise<Field | undefined> {
  for (const [index, candidate] of candidates.entries()) {
    const first = candidate.first()
    if (index === 0) {
      if (await first.waitFor({ state: 'visible', timeout: wait }).then(() => true, () => false)) return first
    } else if (await first.isVisible().catch(() => false)) return first
  }
  return undefined
}

/** [연결 확인] — 대상 주소가 열리는지, 로그인이 되는지 */
export async function check(config: Config): Promise<{ ok: boolean; text: string }> {
  if (!config.baseUrl) return { ok: false, text: '대상 주소가 비어 있습니다' }
  try {
    const browser = await launch(config.channel)
    try {
      const page = await (await browser.newContext()).newPage()
      const response = await page.goto(config.baseUrl, { timeout: 15_000 })
      const status = response?.status()
      if (status !== undefined && status >= 400) return { ok: false, text: `열렸지만 오류 — HTTP ${status}` }
    } finally {
      await browser.close().catch(() => undefined)
    }
    if (!loginReady(config.login)) return { ok: true, text: `열림 — ${config.baseUrl} (로그인 설정 없음)` }
    return { ok: true, text: `열림 — ${config.baseUrl} · ${await login(config)}` }
  } catch (error) {
    return { ok: false, text: scrub(error instanceof Error ? error.message : String(error), [config.login.password]) }
  }
}

/** 한 파일 HTML → A4 PDF */
export async function pdf(channel: Channel, html: string, output: string): Promise<void> {
  const browser = await launch(channel)
  try {
    const page = await (await browser.newContext({ colorScheme: 'light' })).newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.emulateMedia({ media: 'print' })
    await page.pdf({ path: output, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })
  } finally {
    await browser.close().catch(() => undefined)
  }
}
