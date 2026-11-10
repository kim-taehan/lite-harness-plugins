// 설정 칸 → 실행 값 (#1248). 앱이 plugin.json 의 mcp.env 자리표시로 넘긴다. 작업 폴더 = 그 프로젝트.
// 프로젝트 안 산출물은 모두 `<프로젝트>/.litecode/plugins/ui-test/` 아래에 둔다 — 앱이 플러그인을 지울 때 그 폴더를 통째로 지운다.
// 위치는 설정으로 바꾸지 않는다(바꾸면 삭제 때 정리가 안 된다). 폴더 이름은 여기 상수에서만 정한다.

import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** 프로젝트 기준 플러그인 폴더 — 앱이 정한 이름(`.litecode/plugins/<플러그인 id>`) */
export const PLUGIN_DIR = '.litecode/plugins/ui-test'
/** 시나리오 md · 생성 코드 — 플러그인 폴더 안, 하위 폴더 없이 */
export const SCENARIOS_FOLDER = 'scenarios'
/** 결과서 · 가이드 · PDF — 플러그인 폴더 안, 수행 id 폴더마다 */
export const REPORTS_FOLDER = 'reports'
/** 0.6.x 가 쓰던 테스트 폴더 — 가져오기(legacy.ts)에서만 읽는다 */
export const LEGACY_TEST_DIR = 'ui-tests'
/** 가져온 기록 — 있으면 다시 가져오지 않는다 */
export const IMPORTED_FILE = 'imported.json'
export const KEEP_RUNS = 20

export type Channel = 'chrome' | 'msedge'

export interface Config {
  project: string
  baseUrl: string
  /** 먼저 쓸 브라우저 — 없으면 다른 것 */
  channel: Channel
  user: string
  password: string
  /** 절대 경로 — 플러그인 폴더(프로젝트 `.litecode/plugins/ui-test`) · 시나리오 · 결과서 */
  pluginDir: string
  scenarioDir: string
  reportDir: string
  dataDir: string
  /** 백엔드 코드 폴더 (절대 경로) — 화면 뒤 서버 코드가 프로젝트 밖(다른 저장소)일 때. 없으면 [] */
  backendDirs: string[]
  /** 설정에 적혔지만 절대 경로가 아니라 쓰지 않는 것 — [연결 확인] 이 알린다 */
  backendIgnored: string[]
  /** 프로젝트 기준 경로 (화면 · 글용) */
  scenarioDirRel: string
  reportDirRel: string
}

export function channelOf(value: string | undefined): Channel {
  return /edge/i.test(value ?? '') ? 'msedge' : 'chrome'
}

export const channelLabel = (channel: string): string => (channel === 'msedge' ? 'Edge' : 'Chrome')

/** 프로젝트 안 상대 경로만 — `..` 로 나가거나 절대 경로면 던진다 */
export function insideProject(project: string, value: string, label: string): string {
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new Error(`${label}는 프로젝트 안 상대 경로여야 합니다: ${value}`)
  const resolved = path.resolve(project, value)
  if (resolved !== project && !resolved.startsWith(project + path.sep)) throw new Error(`${label}가 프로젝트 밖을 가리킵니다: ${value}`)
  return resolved
}

/** 쓰기 · 지우기 전에 실제 경로(realpath)가 프로젝트 `.litecode/plugins/ui-test` 안인지 본다 — 심볼릭 링크가 밖을 가리키면 던진다.
 *  아직 없는 경로는 있는 가장 가까운 윗 폴더의 실제 경로에 나머지를 붙여 본다 */
export async function guardPluginPath(project: string, target: string): Promise<string> {
  const base = path.join(await realpath(project), PLUGIN_DIR)
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
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`플러그인 폴더(${PLUGIN_DIR}) 밖입니다: ${target}`)
  return target
}

/** 백엔드 코드 폴더 설정 — 쉼표 · 세미콜론으로 여럿. 절대 경로만 쓰고 나머지는 ignored 로 (던지지 않는다 — 서버는 설정이 틀려도 떠서 도구 목록을 답해야 한다).
 *  프로젝트 안 코드는 적지 않아도 읽는다 */
export function backendFolders(value: string | undefined): { dirs: string[]; ignored: string[] } {
  const items = (value ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)
  return {
    dirs: items.filter((item) => path.isAbsolute(item)).map((dir) => path.normalize(dir).replace(/[\\/]+$/, '')),
    ignored: items.filter((item) => !path.isAbsolute(item)),
  }
}

/** 시나리오가 참고한 코드 파일 — 상대 경로는 프로젝트 안, 절대 경로는 백엔드 코드 폴더 안만 */
export function sourceFile(config: Pick<Config, 'project' | 'backendDirs'>, value: string): string {
  if (!path.isAbsolute(value)) return insideProject(config.project, value, '코드 파일')
  const resolved = path.normalize(value)
  if (config.backendDirs.some((dir) => resolved.startsWith(dir + path.sep))) return resolved
  throw new Error(`코드 파일이 프로젝트와 백엔드 코드 폴더 밖입니다: ${value}`)
}

export function configFromEnv(env: NodeJS.ProcessEnv, project: string): Config {
  const pluginDir = path.join(project, ...PLUGIN_DIR.split('/'))
  const scenarioDir = path.join(pluginDir, SCENARIOS_FOLDER)
  const reportDir = path.join(pluginDir, REPORTS_FOLDER)
  const backend = backendFolders(env['UI_TEST_BACKEND_DIRS'])
  return {
    project,
    baseUrl: env['UI_TEST_BASE_URL']?.trim() ?? '',
    channel: channelOf(env['UI_TEST_BROWSER']),
    user: env['UI_TEST_USER']?.trim() ?? '',
    password: env['UI_TEST_PASSWORD'] ?? '',
    pluginDir,
    scenarioDir,
    reportDir,
    // 앱은 플러그인 데이터 폴더를 준다 — 앱 밖(CI)에서 돌리면 결과서 폴더 안 .history
    dataDir: env['UI_TEST_DATA_DIR']?.trim() || path.join(reportDir, '.history'),
    backendDirs: backend.dirs,
    backendIgnored: backend.ignored,
    scenarioDirRel: `${PLUGIN_DIR}/${SCENARIOS_FOLDER}`,
    reportDirRel: `${PLUGIN_DIR}/${REPORTS_FOLDER}`,
  }
}

/** 비밀 값을 글에서 지운다 — 결과서 · 도구 결과 · 오류 글 */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) if (secret && secret.length >= 2) out = out.split(secret).join('****')
  return out
}
