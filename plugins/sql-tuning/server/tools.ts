// SQL 튜닝 도구 5개 (#1051) — DB 와 상관없는 부분: 인자 검사 · 문장 검사 · 시간 제한 · 결과 글. DB 일은 어댑터가 한다.
// 실제 데이터 행은 query 만 돌려준다(승인은 엔진 권한 규칙이 매번 묻는다 — README)

import { bindsFor, checkReadOnly } from './guard.ts'
import { gitignoreHint, hiddenValues, parseReport, renderReport, writeReport } from './report.ts'
import type { Adapter, Binds, CapturedSql, ImpactInfo, Plan, PlanStep, RunStats, TableInfo, TopBy, TopQuery } from './types.ts'

export interface ToolResult {
  text: string
  isError?: boolean
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<ToolResult>
}

export interface ToolOptions {
  rowLimit: number
  timeoutMs: number
  /** 이만큼(ms) 도구 호출이 없으면 DB 연결을 닫는다 — 다음 호출에서 다시 잇는다. 0 이면 닫지 않는다 */
  idleMs?: number
  /** 쉬면 끊기에서 부른다 — 어댑터의 close */
  onIdle?: () => Promise<void>
  /** 도구 호출을 한 줄로 세운다 (기본 true) — 연결이 하나일 때. 풀(연결 여럿)이면 false 로 동시에 돈다 */
  serial?: boolean
  /** compare 가 한 번 실행에서 읽을 최대 행 수 */
  compareRows?: number
  /** report 도구 — 결과서를 쓸 프로젝트 폴더(기본 작업 폴더) · 접속 주소(결과서에서 비밀번호 · 호스트 · 계정을 지우는 데) · 시계(시험용) */
  report?: { cwd?: string; databaseUrl?: string; now?: () => Date }
}

/** compare 한 번에 넣을 수 있는 바인드 묶음 수 */
export const MAX_COMPARE_SETS = 5

const SQL_ARG = { type: 'string', description: 'One SELECT or WITH statement.' }
const BINDS_ARG = { description: 'Bind values — an array for positional ($1, :1) or an object for named (:name) placeholders.', anyOf: [{ type: 'array' }, { type: 'object' }] }

const RUN_SIDE = {
  type: 'object',
  properties: { rows: { type: 'number', description: 'Row count from compare.' }, checksum: { type: 'string', description: 'Checksum text from compare, as printed.' }, ms: { type: 'number', description: 'Milliseconds from compare.' } },
  required: ['rows', 'checksum', 'ms'],
}
const PLAN_SIDE = { type: 'object', properties: { op: { type: 'string', description: 'Plan operation as printed, e.g. TABLE ACCESS FULL ORDERS.' }, detail: { type: 'string', description: 'Rows and cost as printed, e.g. "1,800,000 rows, cost 3,940".' } }, required: ['op'] }
const LEVEL_NOTE = (what: string) => ({ type: 'object', description: what, properties: { level: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] }, note: { type: 'string', description: 'Numbers from impact_check only.' } }, required: ['level', 'note'] })

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'hold'], description: "'ok' = rewrite improved and every compare set returned the same result. 'hold' = do not apply (results differ, or not an improvement); cause is then required." },
    target: { type: 'string', description: 'What was tuned, e.g. OrderMapper.selectRecentOrders.' },
    kind: { type: 'string', description: 'e.g. "MyBatis mapper", "JPA @Query", "SQL".' },
    project: { type: 'string' },
    db: { type: 'string', enum: ['oracle', 'postgres'] },
    schema: { type: 'string' },
    source: { type: 'object', description: 'Where the SQL came from, project-relative.', properties: { file: { type: 'string' }, line: { type: 'number' } }, required: ['file'] },
    original_sql: { type: 'string', description: 'The original SQL, exactly as tuned. The report shows it; the server builds the line diff.' },
    candidate_sql: { type: 'string', description: 'The rewritten (or hinted) SQL. Use bind variables, not literals with personal data — SQL text is shown as is.' },
    overview: {
      type: 'object',
      description: 'Shown first in the report. Your own account of this tuning for a reader who was not in the conversation — the same content as your answer: a short summary, then sections such as Cause (with the plan excerpt as code), ① SQL rewrite (works / not enough / not applicable and why), ② Hint, ③ Index, ④ Other. Numbers must match the tool results below; label estimates.',
      properties: {
        summary: { type: 'string', description: '2-4 sentences: what was asked, why it was slow, what you changed, the result.' },
        sections: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'For example "원인", "① SQL 리라이트 — 등가성 확인됨", "③ 인덱스 (제안)".' },
              text: { type: 'string', description: 'Paragraphs separated by a blank line; `backticks` mark code inside text.' },
              code: { type: 'string', description: 'Optional code block, for example the plan lines that show the cause.' },
            },
            required: ['title', 'text'],
          },
        },
      },
      required: ['summary'],
    },
    diff_note: { type: 'string', description: 'One or two sentences: what changed and why it is the same condition.' },
    cost: { type: 'object', description: 'Estimated plan cost from explain (reference only).', properties: { before: { type: 'number' }, after: { type: 'number' } }, required: ['before', 'after'] },
    plan: { type: 'array', description: 'Key plan lines before/after from explain.', items: { type: 'object', properties: { what: { type: 'string', description: 'e.g. "how orders is read"' }, before: PLAN_SIDE, after: PLAN_SIDE, changed: { type: 'boolean', description: 'Default: true when before and after differ.' } }, required: ['what', 'before', 'after'] } },
    plan_full: { type: 'object', description: 'Whole explain output of each query, as printed.', properties: { before: { type: 'string' }, after: { type: 'string' } }, required: ['before', 'after'] },
    compare: {
      type: 'array',
      description: 'One item per compare bind set, copied from the compare result. No data rows. String bind values are shown only by length in the report; do not put personal data in label.',
      items: { type: 'object', properties: { label: { type: 'string', description: 'Short description of the set, e.g. "last 7 days, paid".' }, binds: { description: 'The bind values you passed to compare (array or object).', anyOf: [{ type: 'array' }, { type: 'object' }] }, original: RUN_SIDE, candidate: RUN_SIDE, partial: { type: 'boolean', description: 'True when compare stopped at the row cap.' } }, required: ['label', 'original', 'candidate'] },
    },
    cause: { type: 'object', description: "Required when verdict is 'hold': what went wrong, from tool results. Say what you could not check.", properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] },
    index: {
      type: 'object',
      description: "Index proposal (verdict 'ok' only). Proposal only — nothing was created.",
      properties: { ddl: { type: 'string' }, write_load: LEVEL_NOTE('Write volume from impact_check.'), other_queries: LEVEL_NOTE('Other recorded queries and overlapping indexes from impact_check.'), effect_verified: { type: 'boolean', description: 'true only if you measured the effect. An index that does not exist cannot be measured, so normally false.' }, effect_note: { type: 'string' } },
      required: ['ddl', 'write_load', 'other_queries', 'effect_verified'],
    },
    standard: { type: 'object', description: 'The company SQL standard you used. Omit when none is installed — the report then says "no standard verdict".', properties: { file: { type: 'string' }, rules_total: { type: 'number' } }, required: ['file'] },
    rules: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, status: { type: 'string', enum: ['applied', 'already', 'failed', 'not_fixed'], description: 'applied = the rewrite follows it; already = original already followed it; failed = applied but results changed; not_fixed = original violates it, not fixed.' }, where: { type: 'string' } }, required: ['id', 'text', 'status'] } },
    limits: { type: 'array', items: { type: 'string' }, description: 'Extra limits beyond the standard ones the report adds.' },
    unknown: { type: 'array', items: { type: 'string' }, description: 'What you could not check.' },
    estimates: { type: 'array', items: { type: 'string' }, description: 'Anything you estimated instead of measuring, with the reason. Shown with an "estimate" label.' },
  },
  required: ['verdict', 'target', 'db', 'original_sql', 'candidate_sql', 'compare'],
}

function fail(text: string): ToolResult {
  return { text, isError: true }
}

/** 기한 안에 끝나지 않으면 던진다 — DB 쪽 제한(어댑터)과 별개로, 응답 없는 접속에도 도구가 돌아온다 */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s.`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const num = (value: number | undefined): string => (value === undefined ? '-' : value.toLocaleString('en-US'))

/** 자기 비용 = 비용 − 자식들 비용 — 가장 큰 단계가 병목 후보. 비용이 없는 자식(FILTER · COUNT 등)은 그 아래 비용으로 본다 */
export function hottestStep(steps: PlanStep[]): PlanStep | undefined {
  const childrenOf = (id: number): PlanStep[] => steps.filter((other) => other.parentId === id)
  const effective = (step: PlanStep): number => step.cost ?? childrenOf(step.id).reduce((sum, child) => sum + effective(child), 0)
  let best: { step: PlanStep; self: number } | undefined
  // 맨 위(SELECT STATEMENT)는 후보에서 뺀다 — 그 자기 비용은 행마다 도는 스칼라 서브쿼리 같은 반복 실행이라 단계 하나가 아니다(formatPlan 이 따로 적는다)
  const candidates = steps.length > 1 ? steps.filter((step) => step.parentId !== null) : steps
  for (const step of candidates) {
    if (step.cost === undefined) continue
    const children = childrenOf(step.id).reduce((sum, child) => sum + effective(child), 0)
    const self = step.cost - children
    if (!best || self > best.self) best = { step, self }
  }
  return best?.step
}

/** 맨 위 단계의 자기 비용 — 자식 비용보다 크게 남으면 행마다 반복되는 일(스칼라 서브쿼리 등)이 있다는 뜻 */
export function rootRepeatedCost(steps: PlanStep[]): number | undefined {
  const root = steps.find((step) => step.parentId === null)
  if (!root?.cost || steps.length < 2) return undefined
  const own = root.cost - steps.filter((step) => step.parentId === root.id).reduce((sum, child) => sum + (child.cost ?? 0), 0)
  return own > root.cost * 0.2 ? own : undefined
}

export function formatPlan(plan: Plan, title: string): string {
  const hot = hottestStep(plan.steps)
  const repeated = rootRepeatedCost(plan.steps)
  const lines = [title]
  if (plan.steps.length) {
    for (const step of plan.steps) {
      const parts = [`${'  '.repeat(step.depth)}${step.id}. ${step.operation}${step.object ? ` ${step.object}` : ''}`, `cost=${num(step.cost)}`, `rows=${num(step.rows)}`]
      if (step.actualRows !== undefined) parts.push(`actual_rows=${num(step.actualRows)}`)
      if (step.actualMs !== undefined) parts.push(`actual_ms=${step.actualMs}`)
      const note = step === hot ? '   <-- largest own cost' : step.parentId === null && repeated !== undefined ? `   <-- ${num(repeated)} of this is repeated per-row work (e.g. scalar subqueries), not one step` : ''
      lines.push(`${parts.join('  ')}${note}`)
      if (step.access) lines.push(`${'  '.repeat(step.depth)}   access: ${step.access}`)
      if (step.filter) lines.push(`${'  '.repeat(step.depth)}   filter: ${step.filter}`)
    }
  }
  if (plan.text) lines.push('', plan.text)
  return lines.join('\n')
}

export function formatTable(info: TableInfo): string {
  if (info.view) {
    return [
      `View ${info.schema}.${info.name} — a view has no statistics or indexes of its own; call table_info on its base tables.`,
      `Base tables: ${info.view.bases.length ? info.view.bases.join(', ') : '(unknown)'}`,
      '',
      'Definition:',
      info.view.text,
    ].join('\n')
  }
  const lines = [`Table ${info.schema}.${info.name} — rows=${num(info.rows)} blocks=${num(info.blocks)} last_analyzed=${info.lastAnalyzed ?? 'never'}`, '', 'Columns (name type null distinct nulls):']
  for (const column of info.columns) lines.push(`- ${column.name} ${column.type} ${column.nullable ? 'NULL' : 'NOT NULL'} ${num(column.distinct)} ${column.nulls ?? '-'}`)
  lines.push('', 'Indexes:')
  if (!info.indexes.length) lines.push('- (none)')
  for (const index of info.indexes) lines.push(`- ${index.name} (${index.columns.join(', ')})${index.unique ? ' UNIQUE' : ''}${index.status ? ` ${index.status}` : ''}${index.clusteringFactor !== undefined ? ` clustering_factor=${num(index.clusteringFactor)}` : ''}`)
  if (info.constraints.length) {
    lines.push('', 'Constraints:')
    for (const constraint of info.constraints) lines.push(`- ${constraint.name} ${constraint.type} (${constraint.columns.join(', ')})`)
  }
  return lines.join('\n')
}

export function formatTop(queries: TopQuery[], by: TopBy): string {
  if (!queries.length) return 'No queries recorded yet.'
  const lines = [`Top ${queries.length} queries by ${by} (mean_ms total_ms executions sql):`]
  for (const query of queries) lines.push(`- ${query.meanMs.toFixed(1)} ${Math.round(query.totalMs)} ${query.executions} | ${query.sql.replace(/\s+/g, ' ').slice(0, 300)}`)
  return lines.join('\n')
}

export function formatImpact(info: ImpactInfo): string {
  const lines = [`Impact check for ${info.schema}.${info.name} — what else depends on this table before adding or changing an index:`, '']
  if (info.writes) lines.push(`Writes since ${info.writes.since ?? 'unknown'}: inserts=${num(info.writes.inserts)} updates=${num(info.writes.updates)} deletes=${num(info.writes.deletes)} — every new index adds work to each of these.`, '')
  lines.push(`Recorded queries using this table (${info.queries.length}, slowest first — kind mean_ms executions sql):`)
  if (!info.queries.length) lines.push('- (none recorded — the workload is unknown; say so instead of assuming the index is harmless)')
  for (const query of info.queries) lines.push(`- ${query.kind} ${query.meanMs.toFixed(1)} ${query.executions} | ${query.sql.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (info.indexUsage) {
    lines.push('', 'Existing index usage:')
    for (const index of info.indexUsage) lines.push(`- ${index.name} uses=${num(index.uses)}${index.lastUsed ? ` last_used=${index.lastUsed}` : ''}`)
  }
  lines.push('', 'Before proposing: explain the SELECTs above that filter or sort on the new index columns, check whether an existing index becomes redundant, and weigh the write volume.')
  return lines.join('\n')
}

export function formatCaptured(found: CapturedSql[], fragment: string): string {
  if (!found.length) return `No recorded SQL contains "${fragment}". Run the screen or feature once so the database records it, or check the spelling (table names are matched as written in the SQL).`
  const lines = [`Recorded SQL containing "${fragment}" (${found.length}, slowest first). This is the SQL the application actually sent:`]
  for (const item of found) {
    lines.push('', `[${item.id}] executions=${item.executions} mean_ms=${item.meanMs.toFixed(1)}`, item.sql.trim())
    if (item.binds) for (const bind of item.binds) lines.push(`  bind ${bind.name} (${bind.type}) = ${bind.value ?? '(not captured)'}${bind.captured ? ` @${bind.captured}` : ''}`)
  }
  lines.push('', 'Bind values (Oracle) are samples taken when the cursor was first run and about every 15 minutes — use them as one real value in compare, alongside rare and empty ones.')
  return lines.join('\n')
}

export interface CompareRow {
  label: string
  original: RunStats
  candidate: RunStats
}

const stat = (run: RunStats): string => `${num(run.rows)}${run.partial ? '+' : ''} rows · ${run.ms}ms${run.buffers !== undefined ? ` · ${num(run.buffers)} buffers` : ''}${run.checksum ? ` · sum ${run.checksum.slice(0, 8)}` : ''}`

export function formatCompare(rows: CompareRow[]): string {
  const lines = ['Comparison (both queries were executed; rows discarded, only counts and checksums kept):', '', 'binds | original | candidate | same result']
  for (const row of rows) {
    const same = row.original.checksum === row.candidate.checksum && row.original.rows === row.candidate.rows
    lines.push(`${row.label} | ${stat(row.original)} | ${stat(row.candidate)} | ${same ? 'yes' : 'NO'}${row.original.partial || row.candidate.partial ? ' (partial — row cap reached)' : ''}`)
  }
  const differ = rows.some((row) => row.original.checksum !== row.candidate.checksum || row.original.rows !== row.candidate.rows)
  // 열 목록이 다르면(예: 원래 쪽에만 ROWNUM 별칭 RN) 값이 같아도 체크섬이 다르다 — 이유를 알려 준다 (#1074)
  const columns = rows.map((row) => [row.original.columns, row.candidate.columns]).find(([a, b]) => a && b && a.join(',') !== b.join(','))
  if (differ && columns) {
    const [a, b] = columns as [string[], string[]]
    const only = (x: string[], y: string[]) => x.filter((name) => !y.includes(name))
    lines.push('', `NOTE: the column lists differ — only in original: ${only(a, b).join(', ') || '(none)'}; only in candidate: ${only(b, a).join(', ') || '(none)'}${only(a, b).length + only(b, a).length === 0 ? ' (same names, different order)' : ''}. The checksum covers every column in order, so results can never match. Select the same columns in the same order in both (e.g. wrap both as SELECT <same columns> FROM (...)) and compare again.`)
  }
  if (differ) lines.push('', 'WARNING: results differ for at least one bind set — the candidate is not equivalent. Do not propose it as is.')
  lines.push('', 'Timings include fetching all rows. The first run of each query may include a cold cache; buffers (Oracle) are the steadier measure.')
  return lines.join('\n')
}

function bindsOf(args: Record<string, unknown>): Binds | undefined | 'invalid' {
  const binds = args['binds']
  if (binds === undefined || binds === null) return undefined
  if (typeof binds !== 'object') return 'invalid'
  return binds as Binds
}

export function createTools(adapter: () => Promise<Adapter>, options: ToolOptions): Tool[] {
  // 접속은 하나라 도구 호출을 한 줄로 세운다 — 모델이 도구를 동시에 부르면 한 트랜잭션에 문장이 섞인다(ORA-01453)
  let line: Promise<unknown> = Promise.resolve()
  // 쉬면 끊기 — 한 번 쓴 서버가 연결을 하루 종일 쥐지 않게. 마지막 호출이 끝난 뒤부터 센다
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    clearTimeout(idle)
    if (!options.idleMs || !options.onIdle) return
    idle = setTimeout(() => {
      line = line.then(() => options.onIdle?.()).catch(() => undefined)
    }, options.idleMs)
    idle.unref?.()
  }
  const timed = <T>(work: (db: Adapter) => Promise<T>): Promise<T> => {
    clearTimeout(idle)
    // 풀이 있으면 연결 하나를 빌려 그 안에서 (한 호출의 문장들은 한 연결 · 한 트랜잭션)
    const exec = (): Promise<T> => withTimeout(adapter().then((db) => (db.run ? db.run(() => work(db)) : work(db))), options.timeoutMs)
    const run = options.serial === false ? exec() : line.then(exec)
    if (options.serial !== false) line = run.catch(() => undefined)
    void run.finally(armIdle).catch(() => undefined)
    return run
  }

  return [
    {
      name: 'explain',
      description:
        'Show the estimated execution plan of a SELECT without running it: each step with operation, object, cost, estimated rows and access/filter predicates. The step with the largest own cost is marked. Use this first when tuning a query.',
      inputSchema: { type: 'object', properties: { sql: SQL_ARG }, required: ['sql'] },
      async run(args) {
        const checked = checkReadOnly(args['sql'])
        if (!checked.ok) return fail(checked.reason)
        return { text: formatPlan(await timed((db) => db.explain(checked.sql)), 'Estimated plan (not executed):') }
      },
    },
    {
      name: 'table_info',
      description:
        'Describe a table for tuning: row count, blocks, last statistics time, columns with distinct/null counts, indexes (columns, unique, status, clustering factor) and constraints. For a view, returns its definition and base tables. Returns no table data.',
      inputSchema: { type: 'object', properties: { table: { type: 'string' }, schema: { type: 'string', description: 'Owner/schema. Defaults to the connected user (Oracle) or the search path (PostgreSQL).' } }, required: ['table'] },
      async run(args) {
        const table = args['table']
        const schema = args['schema']
        if (typeof table !== 'string' || !table.trim()) return fail('table is required.')
        if (schema !== undefined && typeof schema !== 'string') return fail('schema must be a string.')
        const info = await timed((db) => db.tableInfo(table.trim(), schema?.trim() || undefined))
        return info ? { text: formatTable(info) } : fail(`Table not found or not visible: ${schema ? `${schema}.` : ''}${table}`)
      },
    },
    {
      name: 'top_queries',
      description: 'List the slowest or most frequent queries recorded by the database (Oracle V$SQLAREA, PostgreSQL pg_stat_statements).',
      inputSchema: { type: 'object', properties: { by: { type: 'string', enum: ['elapsed', 'cpu', 'executions'], default: 'elapsed' }, limit: { type: 'number', default: 10 } } },
      async run(args) {
        const by = (args['by'] ?? 'elapsed') as TopBy
        if (!['elapsed', 'cpu', 'executions'].includes(by)) return fail('by must be elapsed, cpu or executions.')
        const limit = Math.min(Math.max(Math.trunc(Number(args['limit'] ?? 10)) || 10, 1), 50)
        return { text: formatTop(await timed((db) => db.topQueries(by, limit)), by) }
      },
    },
    {
      name: 'runtime_plan',
      description:
        'RUN the SELECT for real and show the actual plan with real row counts and timings. Rows are read and discarded, not returned. Use only after explain, when estimates are not enough — the user approves each call.',
      inputSchema: { type: 'object', properties: { sql: SQL_ARG, binds: BINDS_ARG }, required: ['sql'] },
      async run(args) {
        const checked = checkReadOnly(args['sql'])
        if (!checked.ok) return fail(checked.reason)
        const binds = bindsOf(args)
        if (binds === 'invalid') return fail('binds must be an array or an object.')
        return { text: formatPlan(await timed((db) => db.runtimePlan(checked.sql, bindsFor(checked.sql, binds))), 'Actual plan (the query was executed, results discarded):') }
      },
    },
    {
      name: 'impact_check',
      description:
        'Before proposing a new or changed index on a table: list the other recorded queries that use the table (SELECT and DML), the write volume, and how existing indexes are used. Use it so the fix for one query does not slow down others.',
      inputSchema: { type: 'object', properties: { table: { type: 'string' }, schema: { type: 'string' }, limit: { type: 'number', default: 15 } }, required: ['table'] },
      async run(args) {
        const table = args['table']
        const schema = args['schema']
        if (typeof table !== 'string' || !table.trim()) return fail('table is required.')
        if (schema !== undefined && typeof schema !== 'string') return fail('schema must be a string.')
        const limit = Math.min(Math.max(Math.trunc(Number(args['limit'] ?? 15)) || 15, 1), 50)
        const info = await timed((db) => db.impact(table.trim(), schema?.trim() || undefined, limit))
        return info ? { text: formatImpact(info) } : fail(`Table not found or not visible: ${schema ? `${schema}.` : ''}${table}`)
      },
    },
    {
      name: 'captured_sql',
      description:
        'Find the SQL the application actually sent to the database (MyBatis, JPA/Hibernate, JDBC) by a fragment such as a table name or a distinctive part of the query. Returns the exact SQL text, execution counts and, on Oracle, sampled bind values. Use it to get the real SQL behind a mapper or repository method instead of guessing.',
      inputSchema: { type: 'object', properties: { contains: { type: 'string', description: 'Table name or SQL fragment (case-insensitive), at least 3 characters.' }, limit: { type: 'number', default: 5 } }, required: ['contains'] },
      async run(args) {
        const fragment = args['contains']
        if (typeof fragment !== 'string' || fragment.trim().length < 3) return fail('contains must be at least 3 characters.')
        const limit = Math.min(Math.max(Math.trunc(Number(args['limit'] ?? 5)) || 5, 1), 20)
        return { text: formatCaptured(await timed((db) => db.captured(fragment.trim(), limit)), fragment.trim()) }
      },
    },
    {
      name: 'compare',
      description: `RUN the original query and a rewritten/hinted candidate for real, once per bind set (up to ${MAX_COMPARE_SETS}; pick values from the statistics — a frequent value, a rare one, one with no rows). Returns row counts, timings, buffers (Oracle) and whether the results are identical. Rows are not returned. The user approves each call.`,
      inputSchema: {
        type: 'object',
        properties: {
          original: SQL_ARG,
          candidate: SQL_ARG,
          binds_list: { type: 'array', items: BINDS_ARG, description: 'Bind sets to run both queries with — one set may name every placeholder of both queries; each query gets only the binds it uses. Omit when the queries have no bind variables.' },
        },
        required: ['original', 'candidate'],
      },
      async run(args) {
        const original = checkReadOnly(args['original'])
        if (!original.ok) return fail(`original: ${original.reason}`)
        const candidate = checkReadOnly(args['candidate'])
        if (!candidate.ok) return fail(`candidate: ${candidate.reason}`)
        const list = args['binds_list'] ?? [undefined]
        if (!Array.isArray(list) || list.length === 0) return fail('binds_list must be a non-empty array.')
        if (list.length > MAX_COMPARE_SETS) return fail(`At most ${MAX_COMPARE_SETS} bind sets.`)
        if (list.some((binds) => binds !== undefined && (typeof binds !== 'object' || binds === null))) return fail('Each bind set must be an array or an object.')
        const cap = options.compareRows ?? 100_000
        const rows: CompareRow[] = []
        for (const binds of list as (Binds | undefined)[]) {
          const label = binds === undefined ? '(none)' : JSON.stringify(binds)
          // 쿼리마다 그 쿼리에 나오는 바인드만, 새 객체로 (드라이버가 넘긴 객체를 바꾼다)
          const measured = await timed(async (db) => ({ original: await db.measure(original.sql, bindsFor(original.sql, binds), cap), candidate: await db.measure(candidate.sql, bindsFor(candidate.sql, binds), cap) }))
          rows.push({ label, ...measured })
        }
        return { text: formatCompare(rows) }
      },
    },
    {
      name: 'report',
      description:
        'Write the final tuning report as one HTML file in the project folder (sql-tuning-reports/<time>/index.html) and return its path. Call it only after tuning is finished and the user asked for a report. Fill it only with values from explain, compare and impact_check; label estimates. It never contains passwords, connection details or data rows, and string bind values are reduced to their length.',
      inputSchema: REPORT_SCHEMA,
      async run(args) {
        const parsed = parseReport(args)
        if (!parsed.ok) return fail(parsed.error)
        const cwd = options.report?.cwd ?? process.cwd()
        const now = options.report?.now?.() ?? new Date()
        const html = renderReport(parsed.input, { at: now, hide: hiddenValues(options.report?.databaseUrl ?? '', parsed.input.schema) })
        const file = await writeReport(cwd, html, now)
        const lines = [`Report written: ${file}`, 'Tell the user this path. It is a local file; open it in a browser (print to PDF if needed).']
        if (parsed.notices.length) lines.push('', ...parsed.notices.map((notice) => `Note: ${notice}`))
        const hint = await gitignoreHint(cwd)
        if (hint) lines.push('', `The report folder \`${hint}\` is not in .gitignore — ask the user whether to add it so reports are not committed (this plugin does not edit .gitignore).`)
        return { text: lines.join('\n') }
      },
    },
    {
      name: 'query',
      description: `Run a read-only SELECT and return at most ${options.rowLimit} rows — for checking data distribution or dictionary views. Prefer explain/table_info; the user approves each call.`,
      inputSchema: { type: 'object', properties: { sql: SQL_ARG }, required: ['sql'] },
      async run(args) {
        const checked = checkReadOnly(args['sql'])
        if (!checked.ok) return fail(checked.reason)
        const result = await timed((db) => db.query(checked.sql, options.rowLimit))
        const lines = [result.columns.join(' | '), ...result.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? 'NULL' : String(cell))).join(' | '))]
        if (result.truncated) lines.push(`(truncated to ${options.rowLimit} rows)`)
        return { text: lines.join('\n') }
      },
    },
  ]
}
