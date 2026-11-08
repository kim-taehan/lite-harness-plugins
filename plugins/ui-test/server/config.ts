// 설정 칸 → 실행 값 (#1248). 앱이 plugin.json 의 mcp.env 자리표시로 넘긴다. 작업 폴더 = 그 프로젝트.
// 테스트 폴더는 프로젝트 안만(기본 ui-tests), 결과서 폴더는 프로젝트 안 또는 절대 경로(공유 드라이브, 기본 ui-tests/_reports)

import path from 'node:path'

export const DEFAULT_TEST_DIR = 'ui-tests'
export const DEFAULT_REPORT_DIR = 'ui-tests/_reports'
export const KEEP_RUNS = 20

export type Channel = 'chrome' | 'msedge'

export interface Config {
  project: string
  baseUrl: string
  /** 먼저 쓸 브라우저 — 없으면 다른 것 */
  channel: Channel
  user: string
  password: string
  /** 절대 경로 */
  testDir: string
  reportDir: string
  dataDir: string
  /** 백엔드 코드 폴더 (절대 경로) — 화면 뒤 서버 코드가 프로젝트 밖(다른 저장소)일 때. 없으면 [] */
  backendDirs: string[]
  /** 설정에 적혔지만 절대 경로가 아니라 쓰지 않는 것 — [연결 확인] 이 알린다 */
  backendIgnored: string[]
  /** 설정에 적힌 그대로 (화면용) */
  testDirSetting: string
  reportDirSetting: string
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

/** 결과서 폴더 — 절대 경로는 그대로, 상대 경로는 프로젝트 안만 */
export function reportFolder(project: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : insideProject(project, value, '결과서 폴더')
}

export function configFromEnv(env: NodeJS.ProcessEnv, project: string): Config {
  const testDirSetting = env['UI_TEST_DIR']?.trim() || DEFAULT_TEST_DIR
  const reportDirSetting = env['UI_TEST_REPORT_DIR']?.trim() || DEFAULT_REPORT_DIR
  const reportDir = reportFolder(project, reportDirSetting)
  const backend = backendFolders(env['UI_TEST_BACKEND_DIRS'])
  return {
    project,
    baseUrl: env['UI_TEST_BASE_URL']?.trim() ?? '',
    channel: channelOf(env['UI_TEST_BROWSER']),
    user: env['UI_TEST_USER']?.trim() ?? '',
    password: env['UI_TEST_PASSWORD'] ?? '',
    testDir: insideProject(project, testDirSetting, '테스트 폴더'),
    reportDir,
    // 앱은 플러그인 데이터 폴더를 준다 — 앱 밖(CI)에서 돌리면 결과서 폴더 안 .history
    dataDir: env['UI_TEST_DATA_DIR']?.trim() || path.join(reportDir, '.history'),
    backendDirs: backend.dirs,
    backendIgnored: backend.ignored,
    testDirSetting,
    reportDirSetting,
  }
}

/** 비밀 값을 글에서 지운다 — 결과서 · 도구 결과 · 오류 글 */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) if (secret && secret.length >= 2) out = out.split(secret).join('****')
  return out
}
