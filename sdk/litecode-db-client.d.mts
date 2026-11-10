// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts · serviceDb.ts · dbClient.ts · docQuery.ts · docStore.ts · docMemory.ts · docCall.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
import type { ServiceDbOp, ServiceDbPage, ServiceDbQuery, ServiceDbUsage } from './litecode-service.js'

/** 중계가 거절했거나 db 호출이 실패했다 — code 는 서비스의 host.db 와 같다(params-invalid · not-on · no-project · doc-too-big · collection-limit · collection-full · db-full · io-failed).
 *  중계 자체: unauthorized(번호표가 틀리거나 서버가 내려간 뒤) · aborted(signal 로 중단) · rate-limited(번호표 하나가 초당 1000번 넘게 — 클라이언트가 Retry-After 만큼 기다려 3번까지 다시 시도한 뒤에도) · request-too-large(요청 본문 512KB) · unreachable(앱에 닿지 않음) · bad-reply */
export declare class DbClientError extends Error {
  readonly code: string
  constructor(code: string)
}

/** 서버 프로세스의 host.db — 서비스의 host.db 와 같은 모양이고 번호표가 플러그인 · 프로젝트를 정하므로 directory 인자는 없다. 한도 · 이름 규칙도 같다 */
export interface DbClient {
  get(collection: string, id: string): Promise<Record<string, unknown> | null>
  set(collection: string, id: string, doc: Record<string, unknown>): Promise<void>
  delete(collection: string, id: string): Promise<void>
  list(collection: string, params?: { limit?: number; cursor?: string }): Promise<ServiceDbPage>
  query(collection: string, params: ServiceDbQuery): Promise<ServiceDbPage>
  batch(ops: ServiceDbOp[]): Promise<void>
  usage(): Promise<ServiceDbUsage>
}

export declare const DB_URL_ENV: 'LITECODE_DB_URL'
export declare const DB_TOKEN_ENV: 'LITECODE_DB_TOKEN'

/** 앱이 서버를 띄우며 준 환경변수로 만든다 — 없으면(앱 밖에서 직접 실행 · CI · 옛 앱 · 프로젝트 없이 도구 목록만 물을 때) undefined 이니 파일 같은 대체 길로 물러난다 */
export declare function createDbClient(env?: Record<string, string | undefined>, fetchFn?: typeof fetch, options?: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }): DbClient | undefined
