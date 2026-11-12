// 설정 칸 → 실행 값. 앱이 host.mcp.register 의 env 자리표시로 넘긴다. 작업 폴더 = 그 프로젝트.
// 증적(사람 · AI 가 읽고 고치는 원본, 팀이 커밋)은 `.litecode/ui-auto/`, 다시 만들 수 있는 생성물(HTML · PDF · MCP 세션 기록)은 `.litecode/plugins/ui-auto/`.
// 로그인 세션(쿠키)은 프로젝트 밖 `${projectDataDir}` — AI 가 읽는 폴더에 두지 않는다. 위치는 설정으로 바꾸지 않는다.

import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** 증적 폴더 — 플러그인을 지워도 남는다 */
export const EVIDENCE_DIR = '.litecode/ui-auto'
/** 생성물 폴더 — 앱이 플러그인을 지울 때 함께 지운다 */
export const PLUGIN_DIR = '.litecode/plugins/ui-auto'
/** 신선도 기준일 */
export const FRESH_DAYS = 30

export type Channel = 'chrome' | 'msedge'

export interface Login {
  user: string
  password: string
  /** 로그인 화면 경로 — 비면 대상 주소를 열어 비밀번호 칸이 있는 화면을 로그인 화면으로 찾는다 */
  path: string
  userField: string
  passwordField: string
  button: string
}

export interface Config {
  project: string
  baseUrl: string
  channel: Channel
  headless: boolean
  login: Login
  /** 절대 경로 */
  evidenceDir: string
  pluginDir: string
  /** 로그인 세션 파일 (프로젝트 밖) */
  stateFile: string
  /** 설치 폴더 — 동봉한 Playwright MCP · 배지 스크립트 */
  extensionDir: string
  /** 설정 칸의 기본 테스트 입력값 — testdata.md 에 없는 이름만 쓴다 */
  testdata: Record<string, string>
}

export function configFromEnv(env: NodeJS.ProcessEnv, project: string, extensionDir: string): Config {
  const stateDir = env['UI_AUTO_STATE_DIR']?.trim() || path.join(project, PLUGIN_DIR)
  return {
    project,
    baseUrl: (env['UI_AUTO_BASE_URL'] ?? '').trim().replace(/\/+$/, ''),
    channel: /edge/i.test(env['UI_AUTO_BROWSER'] ?? '') ? 'msedge' : 'chrome',
    headless: /숨기|hide|headless/i.test(env['UI_AUTO_WINDOW'] ?? ''),
    login: {
      user: env['UI_AUTO_USER']?.trim() ?? '',
      password: env['UI_AUTO_PASSWORD'] ?? '',
      path: env['UI_AUTO_LOGIN_PATH']?.trim() ?? '',
      userField: env['UI_AUTO_USER_FIELD']?.trim() || '아이디',
      passwordField: env['UI_AUTO_PASSWORD_FIELD']?.trim() || '비밀번호',
      button: env['UI_AUTO_LOGIN_BUTTON']?.trim() || '로그인',
    },
    evidenceDir: path.join(project, ...EVIDENCE_DIR.split('/')),
    pluginDir: path.join(project, ...PLUGIN_DIR.split('/')),
    stateFile: path.join(stateDir, 'state.json'),
    extensionDir,
    testdata: parseTestdata(env['UI_AUTO_TESTDATA'] ?? ''),
  }
}

/** `이름=값` — 줄바꿈 · 쉼표 · 세미콜론으로 여럿. 계정 · 비밀 같은 이름은 뺀다 */
export function parseTestdata(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of text.split(/[\n,;]/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(item)
    if (match && !/^TEST_USER$|PASSWORD|PASSWD|SECRET|TOKEN/i.test(match[1]!)) out[match[1]!] = match[2]!
  }
  return out
}

/** 로그인할 수 있나 — 아이디와 비밀번호(로그인 화면 경로는 없으면 찾는다) */
export const loginReady = (login: Login): boolean => Boolean(login.user && login.password)

/** 로그인 설정 상태를 사람 말로 — 값은 보이지 않는다(아이디는 앞 글자만) */
export function loginState(login: Login): string {
  if (!login.user && !login.password) return '설정 없음 (로그인 없이 씀)'
  const missing = [!login.user && '테스트 계정 아이디', !login.password && '테스트 계정 비밀번호'].filter(Boolean)
  if (missing.length) return `설정이 덜 됨 — 플러그인 설정의 ${missing.join(' · ')} 가 비어 있음`
  return `설정됨 (아이디 ${login.user.slice(0, 2)}***, 비밀번호 있음, 로그인 화면 ${login.path || '자동으로 찾음'})`
}

/** 쓰기 전에 실제 경로(링크를 푼 것)가 증적 폴더나 생성물 폴더 안인지 본다 — 밖이면 던진다. 아직 없는 경로는 있는 가장 가까운 윗 폴더로 본다 */
export async function guardWrite(config: Pick<Config, 'project'>, target: string): Promise<string> {
  const project = await realpath(config.project)
  const roots = [EVIDENCE_DIR, PLUGIN_DIR].map((dir) => path.join(project, ...dir.split('/')))
  let existing = path.resolve(target)
  const tail: string[] = []
  let real: string | undefined
  while (real === undefined) {
    real = await realpath(existing).catch(() => undefined)
    if (real !== undefined) break
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error(`경로를 확인하지 못했습니다: ${target}`)
    tail.unshift(path.basename(existing))
    existing = parent
  }
  const full = path.join(real, ...tail)
  if (!roots.some((root) => full === root || full.startsWith(root + path.sep))) throw new Error(`증적 · 생성물 폴더 밖에는 쓰지 않습니다: ${target}`)
  return target
}

/** 비밀 값을 글에서 지운다 — 도구 결과 · 오류 글 · 기록 */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) if (secret && secret.length >= 2) out = out.split(secret).join('****')
  return out
}

/** 지금 시각 — 기록에 쓰는 두 모양 (PC 의 시간대) */
export function stamp(now = new Date()): { date: string; compact: string; minute: string } {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return { date, compact: date.replaceAll('-', ''), minute: `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}` }
}
