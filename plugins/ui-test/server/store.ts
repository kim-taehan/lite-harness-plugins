// 저장 계층 (0.7.0 1 단계) — host.db 의 컬렉션 · 문서 모양과 읽고 쓰는 함수. 서버 프로세스가 쓴다(서비스 번들과 한 파일로 묶지 않는다).
// 원본(시나리오 md · spec · 결과서 · 스크린샷)은 파일이고 여기는 그 색인 · 기록이다 — DB 는 깨지면 빈 채로 시작하므로 scenarios 는 reindex.ts 가 파일에서 다시 채운다.
// DB 한도: 문서 256KB · 컬렉션 20개 · 컬렉션당 5만 문서 · batch 50개 · 쪽 200개 · id 는 `A-Za-z0-9_.-` 128자 이하(한글 · `/` · `~` 불가).
// 정렬 · 조건 query 는 쓰지 않는다(컬렉션을 훑는다) — id 가 시각으로 시작해 list(id 순)가 곧 시간순이고, 시나리오 → 결과는 scenarios.recent 로 찾는다.
// 서버가 DB 를 못 쓰면(createDbClient() 가 undefined) 파일 대체 길 없이 db-unavailable 을 던진다.

import { createHash } from 'node:crypto'
import { KEEP_RUNS } from './config.ts'
import type { CaseResult, CaseStatus, Comparison, FailKind, RowResult, Rule, StepResult } from './types.ts'

/** DB 클라이언트가 가진 모양 — `sdk/litecode-db-client.mjs` 의 createDbClient() 반환(DbClient)과 서비스 host.db 둘 다 이 모양으로 맞는다(query 는 안 쓴다) */
export interface Db {
  get(collection: string, id: string): Promise<Record<string, unknown> | null>
  set(collection: string, id: string, doc: Record<string, unknown>): Promise<void>
  delete(collection: string, id: string): Promise<void>
  list(collection: string, params?: { limit?: number; cursor?: string }): Promise<{ docs: { id: string; doc: Record<string, unknown> }[]; cursor?: string }>
  batch(ops: DbOp[]): Promise<void>
  usage(): Promise<unknown>
}
export type DbOp = { op: 'set'; collection: string; id: string; doc: Record<string, unknown> } | { op: 'delete'; collection: string; id: string }

export const COLLECTIONS = { scenarios: 'scenarios', requests: 'requests', runs: 'runs', results: 'results', screens: 'screens' } as const

export const PAGE_SIZE = 200
export const BATCH_OPS = 50
/** 문서 한도 256KB 에서 남기는 여유 */
export const DOC_SOFT_BYTES = 200 * 1024
const ERROR_TEXT_MAX = 2000

// ── 문서 모양 ──

/** 시나리오 한 줄 — 정본은 파일(md). file 은 id 를 한글 파일명에서 해시로 지었을 때를 위한 색인 값(프로젝트 기준 상대 경로, reindex 가 갱신) */
export interface ScenarioDoc {
  title: string
  kind?: string
  /** 화면 태그 — "확인:" 단계를 실행한 주소의 라우트 패턴. 수행하면 서버가 채우고(observed), 한 번도 안 돈 시나리오는 md 머리 `screens:` 에서 온다 */
  screens: string[]
  /** 수행이 화면 태그를 정했다 — 그 뒤로 reindex 는 md 머리의 screens 로 덮지 않는다 */
  observed?: boolean
  /** 만든 요청의 id (요청 태그) */
  request?: string
  fingerprint: string
  file: string
  /** 마지막으로 실제 돈(성공 · 실패) 결과 */
  last?: { status: CaseStatus; at: number; run: string }
  /** 결과가 남아 있는 수행 id (오름차순, 최대 KEEP_RUNS) — results 문서를 찾는 길 */
  recent: string[]
}

export interface RequestDoc {
  text: string
  at: number
  scenarios: string[]
  /** 이 요청의 시나리오를 그룹으로 마지막에 같이 실행한 수행 id */
  lastRun?: string
}

export type RunTarget = { kind: 'screen' | 'request'; value: string } | { kind: 'scenarios' }

export interface RunDoc {
  at: number
  durationMs: number
  target: RunTarget
  scenarios: string[]
  totals: { passed: number; failed: number; other: number }
  compare?: Comparison
  /** 결과서 방식 — 하나로 / 시나리오마다 */
  report: 'one' | 'each'
  /** 결과서 · 가이드 제목 */
  title?: string
  headed?: boolean
  browser?: string
  baseUrl?: string
  /** 끝까지 못 돌고 중단됨 — 까닭 */
  interrupted?: string
}

/** 시나리오 하나가 한 수행에서 낸 결과 — CaseResult 의 모양을 잇되 스크린샷은 파일 이름만(수행 폴더 · 데이터 폴더 shots/<수행 id>/ 아래) */
export interface ResultDoc {
  scenario: string
  run: string
  at: number
  title: string
  status: CaseStatus
  durationMs: number
  steps: StepResult[]
  error?: string
  failKind?: FailKind
  rows?: RowResult[]
  /** 이 결과가 가진 스크린샷 파일 이름 전부 — 지울 때 쓴다 */
  shots: string[]
  /** 확인 단계에서 본 주소 */
  urls: string[]
}

export interface ScreenDoc {
  /** 라우트 패턴 (id 는 해시 — 슬래시가 id 에 못 든다) */
  route: string
  name: string
  rules: Rule[]
  /** 이 화면의 시나리오를 그룹으로 마지막에 같이 실행한 수행 id */
  lastRun?: string
  coverage?: { validation: { covered: number; total: number }; business: { covered: number; total: number } }
}

/** 지워진 것 — 결과(스크린샷 파일 이름 포함)와 결과가 모두 없어진 수행 id. 파일(스크린샷 · 결과서) 삭제는 부르는 쪽이 한다 */
export interface Dropped {
  results: ResultDoc[]
  runs: string[]
}

// ── id ──

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/
export const isValidId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value)

const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
/** 요청 id · 수행 id — `20261110T110500_01` (지역 시각 + 같은 초의 번호). 시각으로 시작해 id 순이 시간순 */
export function timeId(date: Date, seq = 1): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(seq)}`
}

const hash12 = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 12)

/** 한글 등 id 가 못 되는 파일 이름의 시나리오 id */
export const hashedScenarioId = (file: string): string => `s-${hash12(file)}`

/** 이미 있는 파일의 시나리오 id — 테스트 폴더 바로 아래의 ASCII 이름은 그 이름(.md 뺀 것), 그 밖(한글 이름 · 하위 폴더 · 128자 근처)은 `s-<경로 sha1 12자>`. file 은 프로젝트 기준 상대 경로 */
export function scenarioIdForFile(file: string, topLevel: boolean): string {
  const stem = file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return topLevel && isValidId(stem) && stem.length <= 100 ? stem : hashedScenarioId(file)
}

/** 새로 만드는 시나리오의 id (= 파일 이름) — `<요청 id>-<번호>` */
export const newScenarioId = (requestId: string, no: number): string => `${requestId}-${pad(no)}`

const REQUEST_STEM = /^(\d{8}T\d{6}_\d{2,})-\d+$/
/** md 머리의 요청 글이 가리키는 요청 id — 시나리오 id 가 `<요청 id>-<번호>` 면 그 앞, 아니면 요청 글 · 시각의 해시 */
export function requestIdFor(scenarioId: string, request: string, requested?: string): string {
  return REQUEST_STEM.exec(scenarioId)?.[1] ?? `q-${hash12(`${request}\n${requested ?? ''}`)}`
}

/** 결과 문서 id — 시나리오 id 와 수행 id 를 `.` 로 잇는다(`~` 는 id 에 못 든다). 거꾸로 쪼개 읽지 않는다 — 문서 안 scenario · run 필드를 본다 */
export const resultId = (scenarioId: string, runId: string): string => `${scenarioId}.${runId}`

export const screenId = (route: string): string => `r-${hash12(route)}`

// ── 결과 문서 만들기 ──

const base = (file: string | undefined): string | undefined => (file ? file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1) : undefined)
const cut = (text: string | undefined, max: number): string | undefined => (text !== undefined && text.length > max ? text.slice(0, max) + '…' : text)

/** 수행 기록(CaseResult)을 결과 문서로 — 스크린샷은 파일 이름만 */
export function toResultDoc(runId: string, at: number, result: CaseResult, urls?: string[]): ResultDoc {
  const shots: string[] = []
  const seen: string[] = []
  const names = (step: StepResult): StepResult => {
    const { shot, failShot, ...rest } = step
    const s = base(shot)
    const f = base(failShot)
    if (step.url) seen.push(step.url)
    if (s) shots.push(s)
    if (f) shots.push(f)
    return { ...rest, ...(s && { shot: s }), ...(f && { failShot: f }) }
  }
  const doc: ResultDoc = {
    scenario: result.id,
    run: runId,
    at,
    title: result.title,
    status: result.status,
    durationMs: result.durationMs,
    steps: result.steps.map(names),
    ...(result.error !== undefined && { error: result.error }),
    ...(result.failKind && { failKind: result.failKind }),
    ...(result.rows && { rows: result.rows.map((row) => ({ ...row, steps: row.steps.map(names) })) }),
    shots: [],
    urls: [],
  }
  doc.shots = [...new Set(shots)]
  doc.urls = urls ?? [...new Set(seen)]
  return doc
}

const bytesOf = (doc: unknown): number => Buffer.byteLength(JSON.stringify(doc), 'utf8')

/** 문서 256KB 를 넘지 않게 — 긴 오류 글을 자르고, 그래도 크면 단계의 `used` 를 빼고, 그래도 크면 행의 단계를 뺀다 */
export function fitResult(doc: ResultDoc): ResultDoc {
  const shrink = (max: number, dropUsed: boolean, dropRowSteps: boolean): ResultDoc => {
    const step = (s: StepResult): StepResult => ({ ...s, ...(s.error !== undefined && { error: cut(s.error, max)! }), ...(dropUsed && { used: [] }) })
    return {
      ...doc,
      ...(doc.error !== undefined && { error: cut(doc.error, max)! }),
      steps: doc.steps.map(step),
      ...(doc.rows && { rows: doc.rows.map((row) => ({ ...row, ...(row.error !== undefined && { error: cut(row.error, max)! }), steps: dropRowSteps ? [] : row.steps.map(step) })) }),
    }
  }
  let out = shrink(ERROR_TEXT_MAX, false, false)
  if (bytesOf(out) > DOC_SOFT_BYTES) out = shrink(300, true, false)
  if (bytesOf(out) > DOC_SOFT_BYTES) out = shrink(300, true, true)
  return out
}

// ── 저장소 ──

export class StoreError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export interface StoreOptions {
  now?: () => Date
}

export type Store = ReturnType<typeof openStore>

/** 서버가 DB 를 못 쓰면(db 가 undefined) db-unavailable */
export function openStore(db: Db | undefined, options: StoreOptions = {}) {
  if (!db) throw new StoreError('db-unavailable')
  const now = options.now ?? ((): Date => new Date())
  const C = COLLECTIONS

  async function readDoc<T>(collection: string, id: string): Promise<T | null> {
    return (await db!.get(collection, id)) as T | null
  }

  async function batchAll(ops: DbOp[]): Promise<void> {
    for (let at = 0; at < ops.length; at += BATCH_OPS) await db!.batch(ops.slice(at, at + BATCH_OPS))
  }

  /** 컬렉션 전체 — 쪽마다 읽는다 */
  async function listAll<T>(collection: string): Promise<{ id: string; doc: T }[]> {
    const out: { id: string; doc: T }[] = []
    let cursor: string | undefined
    do {
      const page = await db!.list(collection, { limit: PAGE_SIZE, ...(cursor && { cursor }) })
      for (const item of page.docs) out.push({ id: item.id, doc: item.doc as T })
      cursor = page.cursor
    } while (cursor)
    return out
  }

  /** 컬렉션마다 이 서버가 마지막으로 낸 시간 id — 정리로 지워진 id 를 다시 내지 않는다(id 순이 시간순이어야 recent · 정렬이 맞다) */
  const lastTimeId = new Map<string, string>()

  /** 시간 id 중 비어 있는 것 — 같은 초면 번호를 올린다. 이미 낸 것 뒤의 id 만 낸다 */
  async function freeTimeId(collection: string): Promise<string> {
    const at = now()
    for (let seq = 1; ; seq++) {
      const id = timeId(at, seq)
      const previous = lastTimeId.get(collection)
      if (previous !== undefined && id <= previous) continue
      if (!(await db!.get(collection, id))) {
        lastTimeId.set(collection, id)
        return id
      }
    }
  }

  /** 시나리오 문서를 모아 읽는 캐시 — 지운 것은 null */
  const scenarioCache = (): { get: (id: string) => Promise<ScenarioDoc | null>; put: (id: string, doc: ScenarioDoc | null) => void } => {
    const seen = new Map<string, ScenarioDoc | null>()
    return {
      get: async (id) => (seen.has(id) ? seen.get(id)! : (seen.set(id, await readDoc<ScenarioDoc>(C.scenarios, id)), seen.get(id)!)),
      put: (id, doc) => void seen.set(id, doc),
    }
  }

  /** 지난 수행 중 남은 결과가 하나도 없는 것 — 그 수행의 시나리오들이 recent 에 아직 들고 있는지 본다 */
  async function emptiedRuns(runIds: string[], cache: ReturnType<typeof scenarioCache>): Promise<string[]> {
    const emptied: string[] = []
    for (const runId of new Set(runIds)) {
      const run = await readDoc<RunDoc>(C.runs, runId)
      if (!run) continue
      let alive = false
      for (const scenarioId of run.scenarios) {
        if ((await cache.get(scenarioId))?.recent.includes(runId)) {
          alive = true
          break
        }
      }
      if (!alive) emptied.push(runId)
    }
    return emptied
  }

  async function takeResults(scenario: string, runIds: string[]): Promise<ResultDoc[]> {
    const docs = await Promise.all(runIds.map((runId) => readDoc<ResultDoc>(C.results, resultId(scenario, runId))))
    return docs.filter((doc): doc is ResultDoc => doc !== null)
  }

  async function resultsAtRun(scenarios: string[], runId: string): Promise<ResultDoc[]> {
    const docs = await Promise.all(scenarios.map((scenario) => readDoc<ResultDoc>(C.results, resultId(scenario, runId))))
    return docs.filter((doc): doc is ResultDoc => doc !== null)
  }

  return {
    // 시나리오
    getScenario: (id: string) => readDoc<ScenarioDoc>(C.scenarios, id),
    /** 있으면 patch 를 덮어 합치고 없으면 새로 — recent · last 같은 기록은 patch 에 없으면 그대로 */
    async upsertScenario(id: string, patch: Partial<ScenarioDoc>): Promise<ScenarioDoc> {
      const current = await readDoc<ScenarioDoc>(C.scenarios, id)
      const doc: ScenarioDoc = { title: '', screens: [], fingerprint: '', file: '', recent: [], ...current, ...patch }
      await db.set(C.scenarios, id, doc as unknown as Record<string, unknown>)
      return doc
    },
    /** 한 쪽(200개) — cursor 를 이어 부른다 */
    async scenarioPage(cursor?: string): Promise<{ items: { id: string; doc: ScenarioDoc }[]; cursor?: string }> {
      const page = await db.list(C.scenarios, { limit: PAGE_SIZE, ...(cursor && { cursor }) })
      return { items: page.docs.map((item) => ({ id: item.id, doc: item.doc as unknown as ScenarioDoc })), ...(page.cursor && { cursor: page.cursor }) }
    },
    listScenarios: () => listAll<ScenarioDoc>(C.scenarios),
    /** 마지막 결과 갱신 — 멈춤 · 코드 없음은 부르는 쪽이 덮지 않는다. 시나리오가 없으면 false */
    async setLast(id: string, last: NonNullable<ScenarioDoc['last']>): Promise<boolean> {
      const current = await readDoc<ScenarioDoc>(C.scenarios, id)
      if (!current) return false
      await db.set(C.scenarios, id, { ...current, last } as unknown as Record<string, unknown>)
      return true
    },
    /** 시나리오 삭제 — 문서 · 그 results(batch 50개씩) · 요청 태그에서 빠짐 · 비게 된 runs. 파일 삭제는 부르는 쪽 */
    async deleteScenario(id: string): Promise<Dropped> {
      const current = await readDoc<ScenarioDoc>(C.scenarios, id)
      if (!current) return { results: [], runs: [] }
      const results = await takeResults(id, current.recent)
      const ops: DbOp[] = [...results.map((doc): DbOp => ({ op: 'delete', collection: C.results, id: resultId(id, doc.run) })), { op: 'delete', collection: C.scenarios, id }]
      if (current.request) {
        const request = await readDoc<RequestDoc>(C.requests, current.request)
        if (request) {
          const rest = request.scenarios.filter((item) => item !== id)
          ops.push(rest.length ? { op: 'set', collection: C.requests, id: current.request, doc: { ...request, scenarios: rest } as unknown as Record<string, unknown> } : { op: 'delete', collection: C.requests, id: current.request })
        }
      }
      await batchAll(ops)
      const cache = scenarioCache()
      cache.put(id, null)
      const runs = await emptiedRuns(current.recent, cache)
      await batchAll(runs.map((runId): DbOp => ({ op: 'delete', collection: C.runs, id: runId })))
      return { results, runs }
    },

    // 요청
    newRequestId: () => freeTimeId(C.requests),
    getRequest: (id: string) => readDoc<RequestDoc>(C.requests, id),
    async putRequest(id: string, doc: RequestDoc): Promise<void> {
      await db.set(C.requests, id, doc as unknown as Record<string, unknown>)
    },
    /** 채팅 요청 하나를 적고 새 요청 id 를 돌려준다 */
    async recordRequest(text: string, scenarios: string[]): Promise<string> {
      const id = await freeTimeId(C.requests)
      await db.set(C.requests, id, { text, at: now().getTime(), scenarios } satisfies RequestDoc as unknown as Record<string, unknown>)
      return id
    },
    listRequests: () => listAll<RequestDoc>(C.requests),

    // 수행
    newRunId: () => freeTimeId(C.runs),
    getRun: (id: string) => readDoc<RunDoc>(C.runs, id),
    getResult: (scenario: string, run: string) => readDoc<ResultDoc>(C.results, resultId(scenario, run)),
    /** 수행 한 번 — runs 1 줄 + results(시나리오마다, 긴 글은 자른다) 를 batch 로 쓰고 시나리오의 recent 에 수행 id 를 더한다. 넘친 것 정리는 pruneResults */
    async recordRun(runId: string, run: RunDoc, results: ResultDoc[]): Promise<void> {
      const ops: DbOp[] = [{ op: 'set', collection: C.runs, id: runId, doc: run as unknown as Record<string, unknown> }]
      for (const result of results) {
        const doc = fitResult({ ...result, run: runId })
        ops.push({ op: 'set', collection: C.results, id: resultId(doc.scenario, runId), doc: doc as unknown as Record<string, unknown> })
        const scenario = await readDoc<ScenarioDoc>(C.scenarios, doc.scenario)
        if (scenario) ops.push({ op: 'set', collection: C.scenarios, id: doc.scenario, doc: { ...scenario, recent: [...scenario.recent.filter((item) => item !== runId), runId].sort() } as unknown as Record<string, unknown> })
      }
      await batchAll(ops)
    },
    /** 시나리오마다 최근 KEEP_RUNS 개 결과만 남긴다 — 넘친 results 와 결과가 모두 없어진 runs 를 지우고 돌려준다. 파일(스크린샷 · 결과서) 삭제는 부르는 쪽 */
    async pruneResults(scenarioIds: string[], keep = KEEP_RUNS): Promise<Dropped> {
      const cache = scenarioCache()
      const ops: DbOp[] = []
      const results: ResultDoc[] = []
      const droppedRuns: string[] = []
      for (const id of new Set(scenarioIds)) {
        const scenario = await cache.get(id)
        if (!scenario || scenario.recent.length <= keep) continue
        const drop = scenario.recent.slice(0, scenario.recent.length - keep)
        const kept = { ...scenario, recent: scenario.recent.slice(-keep) }
        cache.put(id, kept)
        const docs = await takeResults(id, drop)
        results.push(...docs)
        for (const runId of drop) ops.push({ op: 'delete', collection: C.results, id: resultId(id, runId) })
        ops.push({ op: 'set', collection: C.scenarios, id, doc: kept as unknown as Record<string, unknown> })
        droppedRuns.push(...drop)
      }
      await batchAll(ops)
      const runs = await emptiedRuns(droppedRuns, cache)
      await batchAll(runs.map((runId): DbOp => ({ op: 'delete', collection: C.runs, id: runId })))
      return { results, runs }
    },

    /** 수행 하나의 결과 — 아직 남아 있는 것만 (정리로 지워진 시나리오 몫은 빠진다) */
    resultsOfRun: (run: RunDoc, runId: string) => resultsAtRun(run.scenarios, runId),
    /** 시나리오 하나의 남은 결과들 — 최근 것이 앞 */
    async resultsOfScenario(id: string, recent: string[]): Promise<ResultDoc[]> {
      return (await takeResults(id, recent)).sort((a, b) => (a.run < b.run ? 1 : -1))
    },
    /** 그룹(화면 · 요청)을 마지막으로 같이 실행한 수행을 적는다 — 그룹 머리의 "결과서" 링크가 찾는다 */
    async markGroupRun(target: RunTarget, runId: string): Promise<void> {
      if (target.kind === 'request') {
        const request = await readDoc<RequestDoc>(C.requests, target.value)
        if (request) await db.set(C.requests, target.value, { ...request, lastRun: runId } as unknown as Record<string, unknown>)
      } else if (target.kind === 'screen') {
        const screen = (await readDoc<ScreenDoc>(C.screens, screenId(target.value))) ?? { route: target.value, name: target.value, rules: [] }
        await db.set(C.screens, screenId(target.value), { ...screen, lastRun: runId } as unknown as Record<string, unknown>)
      }
    },

    // 화면
    getScreen: (route: string) => readDoc<ScreenDoc>(C.screens, screenId(route)),
    async putScreen(doc: ScreenDoc): Promise<void> {
      await db.set(C.screens, screenId(doc.route), doc as unknown as Record<string, unknown>)
    },
    listScreens: () => listAll<ScreenDoc>(C.screens),
  }
}
