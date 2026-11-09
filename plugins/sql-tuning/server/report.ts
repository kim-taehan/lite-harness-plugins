// 튜닝 최종 결과서 — index.html 한 파일(외부 CDN · 폰트 · 이미지 · 스크립트 없음), 라이트 · 다크 · 좁은 폭 · 인쇄.
// 입력은 AI 가 compare · explain · impact_check 결과로 채운 JSON(parseReport 가 모양을 검사한다). 서버가 모든 글을 이스케이프하고 접속 정보를 지운다.
// 안전: 비밀번호 · 접속 주소 · 호스트 · 계정은 넣지 않고(scrub), 바인드 값 중 문자열은 길이만(maskBind), 데이터 행은 받지 않는다(compare 의 행 수 · 체크섬 · 시간만).
// 시안: scratchpad sql-tuning-report.html — CSS 와 마크업을 그대로 옮기고, 코드 비교(diff)는 시안처럼 AI 가 HTML 을 짜지 않고 두 SQL 에서 서버가 만든다.

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { redact } from './guard.ts'

/** 글 하나(SQL · 실행계획)의 상한 — 넘으면 잘라 표시하고 알린다 */
export const MAX_TEXT = 200 * 1024
const MAX_SHORT = 2000
export const REPORT_DIR = 'sql-tuning-reports'

export type Verdict = 'ok' | 'hold'
export type Level = 'low' | 'medium' | 'high' | 'unknown'
export type RuleStatus = 'applied' | 'already' | 'failed' | 'not_fixed'
export interface PlanSide { op: string; detail?: string }
export interface RunSide { rows: number; checksum: string; ms: number }
export interface CompareSet { label: string; binds?: unknown; original: RunSide; candidate: RunSide; partial?: boolean }

export interface ReportInput {
  verdict: Verdict
  target: string
  kind?: string
  project?: string
  db: 'oracle' | 'postgres'
  schema?: string
  source?: { file: string; line?: number }
  original_sql: string
  candidate_sql: string
  diff_note?: string
  cost?: { before: number; after: number }
  plan?: { what: string; before: PlanSide; after: PlanSide; changed?: boolean }[]
  plan_full?: { before: string; after: string }
  compare: CompareSet[]
  cause?: { title: string; text: string }
  index?: { ddl: string; write_load: { level: Level; note: string }; other_queries: { level: Level; note: string }; effect_verified: boolean; effect_note?: string }
  standard?: { file: string; rules_total?: number }
  rules?: { id: string; text: string; status: RuleStatus; where?: string }[]
  limits?: string[]
  unknown?: string[]
  estimates?: string[]
}

export type Parsed = { ok: true; input: ReportInput; notices: string[] } | { ok: false; error: string }

// ── 입력 검사 ─────────────────────────────────────────────────────────────────

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

class Check {
  errors: string[] = []
  notices: string[] = []
  str(o: Record<string, unknown>, key: string, at: string, required: boolean, max = MAX_SHORT): string | undefined {
    const value = o[key]
    if (value === undefined || value === null || value === '') {
      if (required) this.errors.push(`${at}${key} is required`)
      return undefined
    }
    if (typeof value !== 'string') {
      this.errors.push(`${at}${key} must be a string`)
      return undefined
    }
    if (value.length > max) {
      this.notices.push(`${at}${key} was cut to ${max} characters (it had ${value.length}).`)
      return value.slice(0, max)
    }
    return value
  }
  num(o: Record<string, unknown>, key: string, at: string, required: boolean): number | undefined {
    const value = o[key]
    if (value === undefined || value === null) {
      if (required) this.errors.push(`${at}${key} is required`)
      return undefined
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      this.errors.push(`${at}${key} must be a number >= 0`)
      return undefined
    }
    return value
  }
  obj(o: Record<string, unknown>, key: string, at: string, required: boolean): Record<string, unknown> | undefined {
    const value = o[key]
    if (value === undefined || value === null) {
      if (required) this.errors.push(`${at}${key} is required`)
      return undefined
    }
    if (!isObj(value)) {
      this.errors.push(`${at}${key} must be an object`)
      return undefined
    }
    return value
  }
  list(o: Record<string, unknown>, key: string, at: string, required: boolean, max: number): unknown[] | undefined {
    const value = o[key]
    if (value === undefined || value === null) {
      if (required) this.errors.push(`${at}${key} is required`)
      return undefined
    }
    if (!Array.isArray(value) || (required && value.length === 0)) {
      this.errors.push(`${at}${key} must be ${required ? 'a non-empty ' : 'an '}array`)
      return undefined
    }
    if (value.length > max) {
      this.notices.push(`${at}${key} was cut to ${max} items (it had ${value.length}).`)
      return value.slice(0, max)
    }
    return value
  }
  strings(o: Record<string, unknown>, key: string): string[] | undefined {
    const items = this.list(o, key, '', false, 20)
    if (!items) return undefined
    if (items.some((item) => typeof item !== 'string')) {
      this.errors.push(`${key} must be an array of strings`)
      return undefined
    }
    return (items as string[]).map((item) => item.slice(0, MAX_SHORT))
  }
  oneOf<T extends string>(o: Record<string, unknown>, key: string, at: string, allowed: readonly T[], required: boolean): T | undefined {
    const value = o[key]
    if (value === undefined || value === null) {
      if (required) this.errors.push(`${at}${key} is required (${allowed.join(' | ')})`)
      return undefined
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.errors.push(`${at}${key} must be one of ${allowed.join(' | ')}`)
      return undefined
    }
    return value as T
  }
}

const LEVELS = ['low', 'medium', 'high', 'unknown'] as const
const RULE_STATUS = ['applied', 'already', 'failed', 'not_fixed'] as const
const same = (set: CompareSet): boolean => set.original.rows === set.candidate.rows && set.original.checksum === set.candidate.checksum

function runSide(c: Check, o: Record<string, unknown>, key: string, at: string): RunSide | undefined {
  const side = c.obj(o, key, at, true)
  if (!side) return undefined
  const rows = c.num(side, 'rows', `${at}${key}.`, true)
  const ms = c.num(side, 'ms', `${at}${key}.`, true)
  const checksum = c.str(side, 'checksum', `${at}${key}.`, true, 100)
  return rows === undefined || ms === undefined || checksum === undefined ? undefined : { rows, ms, checksum }
}

function planSide(c: Check, o: Record<string, unknown>, key: string, at: string): PlanSide | undefined {
  const side = c.obj(o, key, at, true)
  if (!side) return undefined
  const op = c.str(side, 'op', `${at}${key}.`, true, 300)
  const detail = c.str(side, 'detail', `${at}${key}.`, false, 300)
  return op === undefined ? undefined : { op, ...(detail && { detail }) }
}

/** 도구 인자 → 결과서 입력. 빠진 · 틀린 칸은 한꺼번에 알려 준다 */
export function parseReport(args: Record<string, unknown>): Parsed {
  const c = new Check()
  const verdict = c.oneOf(args, 'verdict', '', ['ok', 'hold'], true)
  const target = c.str(args, 'target', '', true, 300)
  const db = c.oneOf(args, 'db', '', ['oracle', 'postgres'], true)
  const original = c.str(args, 'original_sql', '', true, MAX_TEXT)
  const candidate = c.str(args, 'candidate_sql', '', true, MAX_TEXT)
  const sets: CompareSet[] = []
  ;(c.list(args, 'compare', '', true, 10) ?? []).forEach((item, at) => {
    const where = `compare[${at}].`
    if (!isObj(item)) return void c.errors.push(`compare[${at}] must be an object`)
    const label = c.str(item, 'label', where, true, 300)
    const o = runSide(c, item, 'original', where)
    const n = runSide(c, item, 'candidate', where)
    if (label !== undefined && o && n) sets.push({ label, binds: item['binds'], original: o, candidate: n, ...(item['partial'] === true && { partial: true }) })
  })

  const input: Partial<ReportInput> = {}
  for (const key of ['kind', 'project', 'schema', 'diff_note'] as const) {
    const value = c.str(args, key, '', false, key === 'diff_note' ? 1000 : 300)
    if (value) input[key] = value
  }
  const source = c.obj(args, 'source', '', false)
  if (source) {
    const file = c.str(source, 'file', 'source.', true, 500)
    const line = c.num(source, 'line', 'source.', false)
    if (file) input.source = { file, ...(line !== undefined && { line: Math.trunc(line) }) }
  }
  const cost = c.obj(args, 'cost', '', false)
  if (cost) {
    const before = c.num(cost, 'before', 'cost.', true)
    const after = c.num(cost, 'after', 'cost.', true)
    if (before !== undefined && after !== undefined) input.cost = { before, after }
  }
  const plan = c.list(args, 'plan', '', false, 30)
  if (plan) {
    input.plan = []
    plan.forEach((item, at) => {
      const where = `plan[${at}].`
      if (!isObj(item)) return void c.errors.push(`plan[${at}] must be an object`)
      const what = c.str(item, 'what', where, true, 200)
      const before = planSide(c, item, 'before', where)
      const after = planSide(c, item, 'after', where)
      if (what !== undefined && before && after) input.plan!.push({ what, before, after, ...(typeof item['changed'] === 'boolean' && { changed: item['changed'] }) })
    })
  }
  const full = c.obj(args, 'plan_full', '', false)
  if (full) {
    const before = c.str(full, 'before', 'plan_full.', true, MAX_TEXT)
    const after = c.str(full, 'after', 'plan_full.', true, MAX_TEXT)
    if (before !== undefined && after !== undefined) input.plan_full = { before, after }
  }
  const cause = c.obj(args, 'cause', '', false)
  if (cause) {
    const title = c.str(cause, 'title', 'cause.', true, 300)
    const text = c.str(cause, 'text', 'cause.', true, 1500)
    if (title !== undefined && text !== undefined) input.cause = { title, text }
  }
  const index = c.obj(args, 'index', '', false)
  if (index) {
    const ddl = c.str(index, 'ddl', 'index.', true, 2000)
    const load = c.obj(index, 'write_load', 'index.', true)
    const other = c.obj(index, 'other_queries', 'index.', true)
    const loadLevel = load && c.oneOf(load, 'level', 'index.write_load.', LEVELS, true)
    const loadNote = load && c.str(load, 'note', 'index.write_load.', true, 1000)
    const otherLevel = other && c.oneOf(other, 'level', 'index.other_queries.', LEVELS, true)
    const otherNote = other && c.str(other, 'note', 'index.other_queries.', true, 1000)
    if (typeof index['effect_verified'] !== 'boolean') c.errors.push('index.effect_verified is required (true only when you measured the effect)')
    const effectNote = c.str(index, 'effect_note', 'index.', false, 1000)
    if (ddl && loadLevel && loadNote && otherLevel && otherNote && typeof index['effect_verified'] === 'boolean') {
      input.index = { ddl, write_load: { level: loadLevel, note: loadNote }, other_queries: { level: otherLevel, note: otherNote }, effect_verified: index['effect_verified'], ...(effectNote && { effect_note: effectNote }) }
    }
  }
  const standard = c.obj(args, 'standard', '', false)
  if (standard) {
    const file = c.str(standard, 'file', 'standard.', true, 300)
    const total = c.num(standard, 'rules_total', 'standard.', false)
    if (file) input.standard = { file, ...(total !== undefined && { rules_total: Math.trunc(total) }) }
  }
  const rules = c.list(args, 'rules', '', false, 50)
  if (rules) {
    input.rules = []
    rules.forEach((item, at) => {
      const where = `rules[${at}].`
      if (!isObj(item)) return void c.errors.push(`rules[${at}] must be an object`)
      const id = c.str(item, 'id', where, true, 40)
      const text = c.str(item, 'text', where, true, 300)
      const status = c.oneOf(item, 'status', where, RULE_STATUS, true)
      const at2 = c.str(item, 'where', where, false, 300)
      if (id && text && status) input.rules!.push({ id, text, status, ...(at2 && { where: at2 }) })
    })
  }
  for (const key of ['limits', 'unknown', 'estimates'] as const) {
    const value = c.strings(args, key)
    if (value) input[key] = value
  }

  if (verdict === 'ok' && sets.some((set) => !same(set))) c.errors.push("verdict is 'ok' but a compare set returned different rows or checksum — use 'hold' and fill cause")
  if (verdict === 'hold' && !input.cause) c.errors.push("cause is required when verdict is 'hold' (what went wrong, from the tool results)")
  if (c.errors.length) return { ok: false, error: `report input is not valid:\n- ${c.errors.join('\n- ')}\nFill the fields from the tool results (compare, explain, impact_check); do not guess.` }

  if (verdict === 'hold' && input.index) {
    delete input.index
    c.notices.push('index was left out because the verdict is hold — no index proposal is made for an unconfirmed rewrite.')
  }
  if (verdict === 'ok' && input.cause) {
    delete input.cause
    c.notices.push("cause was left out because the verdict is 'ok'.")
  }
  return { ok: true, input: { verdict: verdict!, target: target!, db: db!, original_sql: original!, candidate_sql: candidate!, compare: sets, ...input }, notices: c.notices }
}

// ── 지우기 · 이스케이프 ───────────────────────────────────────────────────────

export const esc = (text: string): string => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const HIDDEN = '‹숨김›'

/** 접속 주소에서 결과서에 넣으면 안 되는 값 — 비밀번호 · 호스트 · 계정. 계정이 스키마와 같으면(Oracle 은 흔하다) 객체 소유자 이름이라 지우지 않는다 */
export function hiddenValues(databaseUrl: string, schema?: string): string[] {
  try {
    const url = new URL(databaseUrl)
    const user = decodeURIComponent(url.username)
    const values = [decodeURIComponent(url.password), url.hostname.replace(/^\[|\]$/g, ''), user.toLowerCase() === schema?.toLowerCase() ? '' : user]
    return values.filter((value) => value.length >= 3)
  } catch {
    return []
  }
}

/** 글에서 접속 주소(비밀번호 포함) · 숨길 값을 지운다 */
export function scrub(text: string, hide: string[]): string {
  let out = redact(text).replace(/\b(?:oracle|postgres(?:ql)?):\/\/[^\s'"<>]+/gi, HIDDEN).replace(/\bjdbc:[^\s'"<>]+/gi, HIDDEN)
  for (const value of hide) out = out.replace(new RegExp(`(?<![\\w.-])${escapeRegExp(value)}(?![\\w-])`, 'gi'), HIDDEN)
  return out
}

/** 바인드 값 — 숫자 · 불리언 · NULL 은 그대로, 문자열은 길이만(이메일 · 이름 같은 개인정보 방지) */
export function maskBind(value: unknown): string {
  if (typeof value === 'string') return `‹문자열 ${[...value].length}자›`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'NULL'
  return '‹값›'
}

export function maskBinds(binds: unknown): string {
  if (Array.isArray(binds)) return binds.map((value, at) => `#${at + 1}=${maskBind(value)}`).join(' ')
  if (isObj(binds)) return Object.entries(binds).map(([name, value]) => `${name}=${maskBind(value)}`).join(' ')
  return '(바인드 없음)'
}

// ── 코드 비교(diff) ───────────────────────────────────────────────────────────

export type DiffRow = { kind: 'same' | 'chg' | 'add' | 'del'; ln: number; left: string; rn: number; right: string }

/** 가장 긴 공통 부분열로 맞춘 인덱스 쌍 — 크기가 크면 공통 없음으로 본다(전부 바뀜) */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  if (a.length * b.length > 4_000_000) return []
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = eq(a[i]!, b[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (eq(a[i]!, b[j]!)) pairs.push([i++, j++])
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

export function diffLines(original: string, candidate: string): DiffRow[] {
  const a = original.replace(/\s+$/, '').split(/\r?\n/)
  const b = candidate.replace(/\s+$/, '').split(/\r?\n/)
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  const flush = (toI: number, toJ: number): void => {
    // 사이에 낀 줄 — 앞에서부터 짝지어 바뀐 줄, 남는 것은 지움 · 더함
    const dels = a.slice(i, toI)
    const adds = b.slice(j, toJ)
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const hasL = k < dels.length
      const hasR = k < adds.length
      rows.push({ kind: hasL && hasR ? 'chg' : hasL ? 'del' : 'add', ln: hasL ? i + k + 1 : 0, left: dels[k] ?? '', rn: hasR ? j + k + 1 : 0, right: adds[k] ?? '' })
    }
    i = toI
    j = toJ
  }
  for (const [x, y] of [...lcs(a, b, (p, q) => p.trim() === q.trim()), [a.length, b.length] as [number, number]]) {
    flush(x, y)
    if (x < a.length) rows.push({ kind: 'same', ln: x + 1, left: a[x]!, rn: y + 1, right: b[y]! })
    i = x + 1
    j = y + 1
  }
  return rows
}

const tokens = (line: string): string[] => line.match(/\w+|\s+|[^\w\s]/gu) ?? []

/** 한 줄 안에서 달라진 낱말만 <mark> 로 — 입력은 이스케이프 전 글 */
function markWords(left: string, right: string): [string, string] {
  const a = tokens(left)
  const b = tokens(right)
  const pairs = lcs(a, b, (x, y) => x === y)
  const keepA = new Set(pairs.map(([x]) => x))
  const keepB = new Set(pairs.map(([, y]) => y))
  const build = (list: string[], keep: Set<number>, cls: string): string => {
    let out = ''
    let open = false
    list.forEach((token, at) => {
      const marked = !keep.has(at) && !/^\s+$/.test(token)
      if (marked && !open) out += `<mark class="${cls}">`
      if (!marked && open) out += '</mark>'
      open = marked
      out += esc(token)
    })
    return open ? `${out}</mark>` : out
  }
  return [build(a, keepA, 'd'), build(b, keepB, 'a')]
}

// ── 결과서 ────────────────────────────────────────────────────────────────────

const STYLE = `
:root{--paper:#eef0f4;--sheet:#ffffff;--well:#f5f6f9;--rule:rgba(20,28,46,.10);--rule-strong:rgba(20,28,46,.18);--ink:#141a29;--ink-2:#566077;--ink-3:#8a93a6;--probe:#2d4fd6;--probe-wash:#eef1fd;--pass:#167a3f;--pass-wash:#e4f5ea;--bad:#c0332b;--bad-wash:#fdecea;--warn:#8a5200;--warn-wash:#fff6e8;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#0e1118;--sheet:#161b26;--well:#1b2130;--rule:rgba(255,255,255,.08);--rule-strong:rgba(255,255,255,.16);--ink:#e9ecf4;--ink-2:#a2abc0;--ink-3:#6e788f;--probe:#8fa4ff;--probe-wash:#1f2745;--pass:#63d28f;--pass-wash:#15301f;--bad:#f2928b;--bad-wash:#3a1e1c;--warn:#f0a53a;--warn-wash:rgba(240,165,58,.14);color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased}
body{margin:0;background:var(--paper);color:var(--ink);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;font-variant-numeric:tabular-nums;word-break:keep-all}
h1,h2,h3,p,dl,dd,ul{margin:0}
h1,h2,h3{text-wrap:balance}
p{text-wrap:pretty}
code,pre,.mono{font-family:var(--mono)}
summary:focus-visible{outline:2px solid var(--probe);outline-offset:2px}
article{max-width:920px;margin:12px auto 40px;background:var(--sheet);border-radius:12px;box-shadow:0 0 0 1px var(--rule);padding:36px 40px 28px}
.sec{padding:26px 0 0;margin-top:26px;border-top:1px solid var(--rule)}
.sec>.h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.sec h2{font-size:14.5px;font-weight:650;line-height:1.3;display:flex;align-items:baseline;gap:10px}
.sec h2 .no{font:600 11.5px var(--mono);color:var(--ink-3);letter-spacing:.02em}
.sec .meta{font-size:12px;color:var(--ink-3)}
.lbl{font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:99px;font-size:12px;font-weight:700;white-space:nowrap}
.chip.ok{background:var(--pass-wash);color:var(--pass)}
.chip.bad{background:var(--bad-wash);color:var(--bad)}
.chip.warn{background:var(--warn-wash);color:var(--warn)}
.chip.off{background:var(--well);color:var(--ink-2);font-weight:600;box-shadow:inset 0 0 0 1px var(--rule)}
.head{padding-bottom:18px;border-bottom:2px solid var(--ink)}
.head .eyebrow{display:flex;align-items:center;justify-content:space-between;gap:10px}
.head h1{margin-top:6px;font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-.018em;overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 20px;margin-top:16px}
.facts div{display:grid;gap:2px;align-content:start;min-width:0}
.facts dt{font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
.facts dd{font-size:13px;overflow-wrap:anywhere}
.facts dd small{display:block;color:var(--ink-3);font-size:12px}
.facts .src{grid-column:1/-1}
.facts code{font-size:12px}
.verdict{margin-top:22px;padding:22px 22px 18px;border-radius:12px;background:var(--well);box-shadow:inset 0 0 0 1px var(--rule);display:grid;gap:12px}
.verdict .state{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2)}
.verdict .line{font-size:27px;line-height:1.25;font-weight:700;letter-spacing:-.022em;text-wrap:balance}
.verdict .line .was{color:var(--ink-3);font-weight:600}
.verdict .line .arrow{color:var(--ink-3);font-weight:500;margin:0 .12em}
.verdict .line .now{color:var(--pass)}
.verdict .line .sep{color:var(--ink-3);font-weight:400;margin:0 .35em}
.verdict .line .good{color:var(--pass)}
.verdict .line .stop{color:var(--bad)}
.verdict .line .mute{color:var(--ink-3);font-weight:600}
.verdict .next{font-size:13px;color:var(--ink-2);max-width:62ch}
.readout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:4px;border-top:1px solid var(--rule);padding-top:14px}
.readout div{display:grid;gap:2px;align-content:start;padding:0 18px;min-width:0}
.readout div:first-child{padding-left:0}
.readout div+div{box-shadow:inset 1px 0 0 var(--rule)}
.readout dt{font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
.readout dd{font-size:19px;font-weight:700;letter-spacing:-.018em;line-height:1.3}
.readout dd .was{color:var(--ink-3);font-weight:600}
.readout dd .arrow{color:var(--ink-3);font-weight:500}
.readout dd small{font-size:12px;font-weight:600;letter-spacing:0;color:var(--ink-2);margin-left:2px}
.readout dd.bad{color:var(--bad)}
.readout dd.dim{color:var(--ink-2)}
.readout .sub{font-size:12px;color:var(--ink-3)}
.readout .sub.ok{color:var(--pass);font-weight:600}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px;font-size:11.5px;font-weight:600;color:var(--ink-3);margin-bottom:6px;align-items:center}
.cols span{display:flex;align-items:center;gap:8px;letter-spacing:.06em}
.diff{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font:12px/1.6 var(--mono);border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px var(--rule)}
.diff td{padding:0 8px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--sheet);word-break:normal}
.diff td.n{width:30px;padding:0 6px 0 0;text-align:right;color:var(--ink-3);font-size:11px;user-select:none;background:var(--well);word-break:normal}
.diff td.g{width:10px;padding:0;background:var(--paper)}
.diff td.empty{background:var(--well)}
.diff tr.chg td.l{background:var(--bad-wash)}
.diff tr.chg td.r{background:var(--pass-wash)}
.diff tr.add td.r{background:var(--pass-wash)}
.diff tr.del td.l{background:var(--bad-wash)}
.diff mark{border-radius:3px;padding:0 1px;color:inherit;font-weight:700}
.diff mark.d{background:color-mix(in srgb,var(--bad) 26%,transparent)}
.diff mark.a{background:color-mix(in srgb,var(--pass) 26%,transparent)}
.diff td.mk{width:16px;padding:0 0 0 6px;font-weight:700;user-select:none;color:var(--ink-3)}
.diff tr.chg td.l.mk,.diff tr.del td.l.mk{color:var(--bad)}
.diff tr.chg td.r.mk,.diff tr.add td.r.mk{color:var(--pass)}
.note{margin-top:10px;font-size:12.5px;color:var(--ink-2)}
.note b{color:var(--ink);font-weight:650}
.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px}
.plan{border-radius:8px;box-shadow:0 0 0 1px var(--rule);overflow:hidden}
.plan .row{display:grid;grid-template-columns:minmax(76px,.5fr) minmax(0,1fr) minmax(0,1fr);gap:0 10px;border-top:1px solid var(--rule)}
.plan .row:first-child{border-top:0}
.plan .row.hd{background:var(--well);font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
.plan .row>*{padding:9px 12px;min-width:0}
.plan .what{font-size:12.5px;color:var(--ink-2);padding-right:0}
.plan .op{display:grid;gap:2px;align-content:start}
.plan .op code{font-size:12px;overflow-wrap:anywhere;color:var(--ink)}
.plan .op small{font-size:12px;color:var(--ink-3)}
.plan .row.hot .op.b{background:var(--bad-wash)}
.plan .row.hot .op.a{background:var(--pass-wash)}
.plan .op.b.same,.plan .op.a.same{color:var(--ink-2)}
details.full{margin-top:10px}
details.full summary{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 4px;color:var(--probe);font-size:12.5px;font-weight:500;cursor:pointer;border-radius:6px;list-style:none}
details.full summary::-webkit-details-marker{display:none}
details.full summary::before{content:"";width:6px;height:6px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(-45deg);margin-right:4px}
details.full[open] summary::before{transform:rotate(45deg)}
details.full .pair{margin-top:8px}
pre.raw{margin:0;padding:10px 12px;border-radius:8px;background:var(--well);box-shadow:inset 0 0 0 1px var(--rule);font:11.5px/1.6 var(--mono);color:var(--ink-2);overflow-x:auto;white-space:pre}
.pairlbl{font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3);margin-bottom:4px}
.cmp{width:100%;border-collapse:separate;border-spacing:0;border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px var(--rule);font-size:12.5px}
.cmp th,.cmp td{padding:8px 10px;text-align:right;vertical-align:middle;border-top:1px solid var(--rule)}
.cmp thead th{border-top:0;background:var(--well);font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3);white-space:nowrap}
.cmp thead tr.g th{text-align:center;color:var(--ink-2);border-left:1px solid var(--rule)}
.cmp thead tr.g th:first-child{border-left:0}
.cmp thead tr.s th{border-top:1px solid var(--rule)}
.cmp .set{text-align:left;width:26%}
.cmp .set b{display:block;font-weight:650}
.cmp .set span{display:block;font:11.5px/1.45 var(--mono);color:var(--ink-3);overflow-wrap:anywhere}
.cmp .sum{font:12px var(--mono);color:var(--ink-2)}
.cmp .sum.diffsum{color:var(--bad);font-weight:700}
.cmp td.after{font-weight:650}
.cmp td.sep,.cmp th.sep{border-left:1px solid var(--rule)}
.cmp .v{text-align:center;white-space:nowrap}
.cmp tr.differ td{background:var(--bad-wash)}
.cmp td small{display:block;font-size:11.5px;color:var(--ink-3);font-weight:500}
.rowsdiff{color:var(--bad);font-weight:700}
.cmp-foot{margin-top:8px;font-size:12px;color:var(--ink-3);display:flex;gap:4px 16px;flex-wrap:wrap}
.cause{margin-top:12px;padding:12px 14px;border-radius:8px;background:var(--bad-wash);display:grid;gap:4px;font-size:12.5px}
.cause b{color:var(--bad);font-size:13.5px;font-weight:650}
.cause p{color:var(--ink)}
.ddl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:8px;background:var(--well);box-shadow:inset 0 0 0 1px var(--rule)}
.ddl code{flex:1 1 300px;min-width:0;font-size:12px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}
.impact{margin-top:10px;display:grid;border-radius:8px;box-shadow:0 0 0 1px var(--rule);overflow:hidden}
.impact .r{display:grid;grid-template-columns:96px minmax(0,1fr);gap:4px 14px;padding:10px 12px;border-top:1px solid var(--rule)}
.impact .r:first-child{border-top:0}
.impact .k{display:grid;gap:4px;align-content:start;font-weight:650;font-size:12.5px;justify-items:start}
.impact .t{color:var(--ink-2);font-size:12.5px;overflow-wrap:anywhere}
.empty{padding:14px;border-radius:8px;background:var(--well);box-shadow:inset 0 0 0 1px var(--rule);display:grid;gap:2px}
.empty b{font-size:13.5px;font-weight:650}
.empty p{color:var(--ink-2);font-size:12.5px}
.rules{display:grid;border-radius:8px;box-shadow:0 0 0 1px var(--rule);overflow:hidden}
.rules .r{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:4px 12px;align-items:baseline;padding:9px 12px;border-top:1px solid var(--rule);font-size:12.5px}
.rules .r:first-child{border-top:0}
.rules .r b{font:650 12px var(--mono);overflow-wrap:anywhere}
.rules .r span.tx{color:var(--ink-2)}
.rules .r em{font-style:normal;white-space:nowrap}
.rules .r .where{grid-column:2/4;font-size:12px;color:var(--ink-3);margin-top:-2px}
.src-line{margin-top:8px;font-size:12px;color:var(--ink-3)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 28px}
.two h3{font-size:12.5px;font-weight:650;margin-bottom:6px}
.two ul{padding-left:16px;display:grid;gap:5px;color:var(--ink-2);font-size:12.5px;overflow-wrap:anywhere}
.two li::marker{color:var(--ink-3)}
.foot{margin-top:28px;padding-top:14px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;gap:6px 20px;flex-wrap:wrap;font-size:12px;color:var(--ink-3)}
@media screen and (max-width:720px){
  article{padding:22px 16px 20px;border-radius:0;margin:8px 0 24px}
  .facts{grid-template-columns:repeat(2,minmax(0,1fr))}
  .verdict{padding:16px 14px 14px}
  .verdict .line{font-size:22px}
  .readout{grid-template-columns:1fr;gap:12px}
  .readout div{padding:0}
  .readout div+div{box-shadow:none;border-top:1px solid var(--rule);padding-top:12px}
  .cols{display:none}
  .diff,.diff tbody,.diff tr,.diff td{display:block}
  .diff tr{display:grid;grid-template-columns:30px minmax(0,1fr)}
  .diff td.g,.diff td.mk{display:none}
  .diff td.empty{display:none}
  .diff td.n:empty{display:none}
  .diff tr.same td.r,.diff tr.same td.rn{display:none}
  .diff tr.add td.r,.diff tr.del td.l{grid-column:2}
  .diff tr{box-shadow:0 1px 0 var(--rule)}
  .diff td.n{padding:0 6px 0 0}
  .pair{grid-template-columns:minmax(0,1fr);gap:10px}
  .plan .row{grid-template-columns:1fr}
  .plan .row.hd{display:none}
  .plan .what{padding-bottom:0;font-weight:650;color:var(--ink)}
  .plan .op::before{content:attr(data-side);font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
  .cmp,.cmp tbody,.cmp tr,.cmp td{display:block}
  .cmp thead{display:none}
  .cmp tr{display:grid;grid-template-columns:1fr 1fr;gap:0}
  .cmp td{text-align:left;border-top:0;padding:4px 12px}
  .cmp tr{border-top:1px solid var(--rule);padding:6px 0}
  .cmp tr:first-child{border-top:0}
  .cmp td.set{grid-column:1/-1;width:auto;padding-top:6px}
  .cmp td.v{grid-column:1/-1;text-align:left;padding-bottom:6px}
  .cmp td[data-k]::before{content:attr(data-k);display:block;font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
  .cmp td.sep{border-left:0}
  .impact .r{grid-template-columns:1fr}
  .two{grid-template-columns:1fr}
  .rules .r{grid-template-columns:62px minmax(0,1fr)}
  .rules .r em{grid-column:2}
  .rules .r .where{grid-column:2}
}
@page{size:A4;margin:14mm}
@media print{
  :root{--paper:#ffffff;--sheet:#ffffff;--well:#f5f6f9;--rule:rgba(20,28,46,.10);--rule-strong:rgba(20,28,46,.18);--ink:#141a29;--ink-2:#566077;--ink-3:#6b7488;--probe:#2d4fd6;--probe-wash:#eef1fd;--pass:#167a3f;--pass-wash:#e4f5ea;--bad:#c0332b;--bad-wash:#fdecea;--warn:#8a5200;--warn-wash:#fff6e8}
  html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-size:12px}
  article{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}
  .sec{break-inside:avoid;padding-top:18px;margin-top:18px}
  .sec.long{break-inside:auto}
  .verdict,.diff tr,.plan .row,.cmp tr,.rules .r,.impact .r,.cause{break-inside:avoid}
  .verdict .line{font-size:24px}
  .diff{font-size:10.5px}
  .diff td.n{width:24px}
  details.full summary{display:none}
  details.full .pair{grid-template-columns:minmax(0,1fr);gap:8px}
  pre.raw{font-size:9px;white-space:pre-wrap;overflow:visible;overflow-wrap:anywhere;padding:8px}
  .cmp th,.cmp td{padding:7px 6px;font-size:11.5px}
  .cmp td{white-space:nowrap}
  .cmp td.set{white-space:normal}
  .cmp td small{white-space:nowrap}
  .foot{break-inside:avoid}
}
`

const fmt = (n: number): string => n.toLocaleString('en-US')
const pct = (from: number, to: number): number => (from === 0 ? 0 : Math.round(((from - to) / from) * 100))
const median = (values: number[]): number => {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}
const pad = (value: number): string => String(value).padStart(2, '0')
const DB_LABEL = { oracle: 'Oracle', postgres: 'PostgreSQL' } as const
const LEVEL: Record<Level, [string, string]> = { low: ['낮음', 'ok'], medium: ['보통', 'warn'], high: ['높음', 'bad'], unknown: ['확인 못 함', 'off'] }
const RULE: Record<RuleStatus, [string, string]> = { applied: ['적용', 'ok'], already: ['이미 지킴', 'off'], failed: ['적용했으나 결과가 달라짐', 'bad'], not_fixed: ['해당하나 고치지 않음', 'warn'] }

/** 파일 이름과 시각에 쓰는 YYYYMMDD-HHMMSS (이 PC 의 시각) */
export const stamp = (date: Date): string => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
const when = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`

export interface RenderContext {
  at: Date
  /** 결과서에 넣으면 안 되는 값(hiddenValues) */
  hide?: string[]
}

export function renderReport(input: ReportInput, context: RenderContext): string {
  const hide = context.hide ?? []
  const clean = (text: string): string => esc(scrub(text, hide))
  const ok = input.verdict === 'ok'
  const dbName = DB_LABEL[input.db]
  const differing = input.compare.filter((set) => !same(set))
  const t0 = median(input.compare.map((set) => set.original.ms))
  const t1 = median(input.compare.map((set) => set.candidate.ms))
  const sameCount = input.compare.length - differing.length

  const head = `<header class="head">
    <div class="eyebrow"><span class="lbl">SQL 튜닝 최종 결과서</span>${input.kind ? `<span class="chip off">${clean(input.kind)}</span>` : ''}</div>
    <h1>${clean(input.target)}</h1>
    <dl class="facts">
      <div><dt>프로젝트</dt><dd>${input.project ? clean(input.project) : '-'}</dd></div>
      <div><dt>DB</dt><dd>${dbName}<small>${input.schema ? `스키마 ${clean(input.schema)} · ` : ''}개발 DB</small></dd></div>
      <div><dt>시각</dt><dd>${when(context.at)}</dd></div>
      ${input.source ? `<div class="src"><dt>요청한 SQL 의 출처</dt><dd><code>${clean(input.source.file)}${input.source.line ? `:${input.source.line}` : ''}</code></dd></div>` : ''}
    </dl>
  </header>`

  const speed = t1 <= t0 ? `${pct(t0, t1)}% 빨라짐` : `${pct(t1, t0)}% 느려짐`
  const costCell = input.cost
    ? ok
      ? `<div><dt>비용 변화</dt><dd>${input.cost.after <= input.cost.before ? '−' : '+'}${Math.abs(pct(input.cost.before, input.cost.after))}<small>%</small></dd><span class="sub">실행계획 예상값</span></div>`
      : `<div><dt>비용 (예상)</dt><dd class="dim"><span class="was">${fmt(input.cost.before)}</span> <span class="arrow">→</span> ${fmt(input.cost.after)}</dd><span class="sub">참고 — 개선으로 세지 않음</span></div>`
    : '<div><dt>비용 (예상)</dt><dd class="dim">-</dd><span class="sub">확인 못 함 — 실행계획 비용이 없습니다</span></div>'
  const line = ok
    ? `${input.cost ? `<span class="was">비용 ${fmt(input.cost.before)}</span><span class="arrow">→</span><span class="now">${fmt(input.cost.after)}</span>` : `<span class="was">시간 ${fmt(t0)}</span><span class="arrow">→</span><span class="now">${fmt(t1)}ms</span>`}<span class="sep">·</span><span class="good">결과 동일 확인</span>`
    : `<span class="stop">적용 보류</span><span class="sep">·</span><span class="mute">${differing.length ? '결과가 달라졌습니다' : clean(input.cause?.title ?? '')}</span>`
  const next = ok
    ? '코드에는 아직 반영하지 않았습니다. 고친 SQL 을 코드에 옮긴 뒤 테스트로 확인하세요.'
    : differing.length
      ? '고친 SQL 을 그대로 쓰면 조회 결과가 달라집니다. 비용 · 시간은 참고로만 적었고 개선으로 세지 않았습니다. 코드에 반영하지 마세요.'
      : '이 고친 SQL 은 적용을 권하지 않습니다. 비용 · 시간은 참고로만 적었고 개선으로 세지 않았습니다. 이유는 아래 원인 상자에 있습니다.'
  const cells = ok
    ? `<div><dt>실측 시간 (중앙값)</dt><dd><span class="was">${fmt(t0)}</span> <span class="arrow">→</span> ${fmt(t1)}<small>ms</small></dd><span class="sub ${t1 <= t0 ? 'ok' : ''}">${speed}</span></div>
    <div><dt>결과 일치</dt><dd>${sameCount} / ${input.compare.length}<small>바인드</small></dd><span class="sub ok">행 수 · 체크섬 모두 같음</span></div>
    ${costCell}`
    : `<div><dt>결과 일치</dt><dd class="${differing.length ? 'bad' : ''}">${sameCount} / ${input.compare.length}<small>바인드</small></dd><span class="sub">${differing.length ? `${differing.length}개에서 행 수 · 체크섬이 다름` : '행 수 · 체크섬은 모두 같음'}</span></div>
    <div><dt>실측 시간 (중앙값)</dt><dd class="dim"><span class="was">${fmt(t0)}</span> <span class="arrow">→</span> ${fmt(t1)}<small>ms</small></dd><span class="sub">참고 — 개선으로 세지 않음</span></div>
    ${costCell}`
  const verdict = `<section class="verdict" aria-label="한 줄 결론">
    <div class="state">${ok ? '<span class="chip ok">개선 성공</span>' : '<span class="chip bad">적용 보류</span>'}<span>${ok ? (input.index ? '인덱스는 만들지 않았고, 제안만 합니다' : '인덱스는 만들지 않았고, SQL 만 고쳤습니다') : '원래 SQL 은 그대로 둡니다'}</span></div>
    <p class="line">${line}</p>
    <p class="next">${next}</p>
    <dl class="readout">${cells}</dl>
  </section>`

  const rows = diffLines(scrub(input.original_sql, hide), scrub(input.candidate_sql, hide))
  const changed = rows.filter((row) => row.kind !== 'same').length
  const diffBody = rows
    .map((row) => {
      const [l, r] = row.kind === 'chg' ? markWords(row.left, row.right) : [esc(row.left), esc(row.right)]
      const left = row.kind === 'add' ? '<td class="n"></td><td class="mk l"></td><td class="l empty"></td>' : `<td class="n">${row.ln}</td><td class="mk l">${row.kind === 'chg' || row.kind === 'del' ? '−' : ''}</td><td class="l">${l}</td>`
      const right = row.kind === 'del' ? '<td class="n"></td><td class="mk r"></td><td class="r empty"></td>' : `<td class="n rn">${row.rn}</td><td class="mk r">${row.kind === 'chg' || row.kind === 'add' ? '+' : ''}</td><td class="r">${r}</td>`
      return `<tr class="${row.kind}">${left}<td class="g"></td>${right}</tr>`
    })
    .join('')
  const diff = `<section class="sec long" aria-labelledby="s3"><div class="h"><h2 id="s3"><span class="no">03</span>고쳐 쓴 SQL</h2><span class="meta">${ok ? '' : '<span class="chip bad">적용 보류</span> '}${changed ? `바뀐 곳 ${changed}줄 (색 · +/− 표시)` : '바뀐 곳 없음'}</span></div>
    <div class="cols"><span>원래 <span class="chip off">전</span></span><span>고친 SQL <span class="chip ${ok ? 'ok' : 'bad'}">후</span></span></div>
    <table class="diff" aria-label="원래 SQL 과 고친 SQL 비교"><colgroup><col style="width:30px"><col style="width:16px"><col><col style="width:10px"><col style="width:30px"><col style="width:16px"><col></colgroup><tbody>${diffBody}</tbody></table>
    ${input.diff_note ? `<p class="note">${clean(input.diff_note)}</p>` : ''}</section>`

  const plan = input.plan ?? []
  const planRows = plan
    .map((item) => {
      const hot = item.changed ?? (item.before.op !== item.after.op || item.before.detail !== item.after.detail)
      const cell = (side: PlanSide, cls: string, label: string): string => `<div class="op ${cls} ${hot ? '' : 'same'}" data-side="${label}"><code>${clean(side.op)}</code>${side.detail ? `<small>${clean(side.detail)}</small>` : ''}</div>`
      return `<div class="row ${hot ? 'hot' : ''}"><div class="what">${clean(item.what)}</div>${cell(item.before, 'b', '전')}${cell(item.after, 'a', '후')}</div>`
    })
    .join('')
  const hotCount = plan.filter((item) => item.changed ?? (item.before.op !== item.after.op || item.before.detail !== item.after.detail)).length
  const planTable = plan.length ? `<div class="plan" role="table" aria-label="실행계획 핵심 줄 비교"><div class="row hd" role="row"><div>무엇을</div><div>전</div><div>후</div></div>${planRows}</div>` : ''
  const full = input.plan_full
    ? `<details class="full" open><summary>전체 실행계획</summary><div class="pair"><div><div class="pairlbl">전</div><pre class="raw">${clean(input.plan_full.before)}</pre></div><div><div class="pairlbl">후</div><pre class="raw">${clean(input.plan_full.after)}</pre></div></div></details>`
    : ''
  const planSec = `<section class="sec" aria-labelledby="s4"><div class="h"><h2 id="s4"><span class="no">04</span>실행계획 전후</h2><span class="meta">${plan.length ? `핵심 ${hotCount}곳이 달라짐 · ` : ''}실행하지 않고 계획만 본 값(explain)</span></div>
    ${planTable}${full}${plan.length || full ? '' : '<div class="empty"><b>실행계획을 넣지 않았습니다</b><p>explain 결과가 이 결과서에 없습니다.</p></div>'}</section>`

  const cmpRows = input.compare
    .map((set, at) => {
      const eq = same(set)
      const diffRows = set.original.rows - set.candidate.rows
      const plus = (side: RunSide): string => `${fmt(side.rows)}${set.partial ? '+' : ''}`
      return `<tr class="${eq ? '' : 'differ'}"><td class="set"><b>바인드 ${at + 1} · ${clean(set.label)}</b><span>${clean(maskBinds(set.binds))}</span></td>
      <td data-k="원래 행 수">${plus(set.original)}</td><td class="sum" data-k="원래 체크섬">${clean(set.original.checksum)}</td><td data-k="원래 시간">${fmt(set.original.ms)} ms</td>
      <td class="sep after ${eq ? '' : 'rowsdiff'}" data-k="고친 행 수">${plus(set.candidate)}${diffRows === 0 ? '' : `<small>${diffRows > 0 ? '−' : '+'}${fmt(Math.abs(diffRows))}행</small>`}</td><td class="sum ${eq ? '' : 'diffsum'}" data-k="고친 체크섬">${clean(set.candidate.checksum)}</td><td class="after" data-k="고친 시간">${fmt(set.candidate.ms)} ms<small>${set.candidate.ms <= set.original.ms ? `${pct(set.original.ms, set.candidate.ms)}% 빨라짐` : `${pct(set.candidate.ms, set.original.ms)}% 느려짐`}</small></td>
      <td class="v sep">${eq ? '<span class="chip ok">✓ 같음</span>' : '<span class="chip bad">✕ 다름</span>'}</td></tr>`
    })
    .join('')
  const partial = input.compare.some((set) => set.partial)
  const cause = input.cause ? `<div class="cause" role="alert"><b>${clean(input.cause.title)}</b><p>${clean(input.cause.text)}</p></div>` : ''
  const cmp = `<section class="sec long" aria-labelledby="s5"><div class="h"><h2 id="s5"><span class="no">05</span>결과 동일 확인</h2><span class="meta">바인드 값 ${input.compare.length}개로 원래 · 고친 SQL 을 실제로 실행 (compare)</span></div>
    <table class="cmp"><thead><tr class="g"><th class="set" rowspan="2" style="text-align:left">바인드 값</th><th colspan="3">원래</th><th colspan="3" class="sep">고친 SQL</th><th rowspan="2" class="sep">결과</th></tr>
      <tr class="s"><th>행 수</th><th>체크섬</th><th>시간</th><th class="sep">행 수</th><th>체크섬</th><th>시간</th></tr></thead><tbody>${cmpRows}</tbody></table>
    <p class="cmp-foot"><span>행 수 · 체크섬 · 걸린 시간만 기록합니다. <b style="color:var(--ink-2);font-weight:600">데이터 행은 이 결과서에 담지 않습니다.</b></span><span>바인드 값 중 문자열은 길이만 적었습니다.</span>${partial ? '<span>행 수 뒤의 + 는 행 수 상한까지만 읽었다는 뜻입니다.</span>' : ''}</p>${cause}</section>`

  const indexSec = (): string => {
    const i = input.index
    if (!i) {
      const why = ok ? 'SQL 을 고치는 것만으로 충분했습니다. 인덱스 변경은 제안하지 않습니다.' : 'SQL 의 결과가 아직 확정되지 않았습니다. 고친 SQL 이 정해진 뒤에 인덱스를 다시 살펴봅니다.'
      return `<section class="sec" aria-labelledby="s6"><div class="h"><h2 id="s6"><span class="no">06</span>인덱스 제안</h2><span class="meta">제안만 — 실행하지 않음</span></div>
    <div class="empty"><b>이번에는 제안이 없습니다</b><p>${why}</p></div></section>`
    }
    const row = (name: string, level: Level, note: string): string => `<div class="r"><div class="k">${name}<span class="chip ${LEVEL[level][1]}">${LEVEL[level][0]}</span></div><p class="t">${clean(note)}</p></div>`
    const effect = i.effect_verified
      ? `<div class="r"><div class="k">예상 효과<span class="chip ok">확인함</span></div><p class="t">${clean(i.effect_note ?? '')}</p></div>`
      : `<div class="r"><div class="k">예상 효과<span class="chip off">확인 못 함</span></div><p class="t">${clean(i.effect_note ?? '만들기 전이라 실행계획으로 효과를 확인하지 못했습니다.')}</p></div>`
    return `<section class="sec" aria-labelledby="s6"><div class="h"><h2 id="s6"><span class="no">06</span>인덱스 제안</h2><span class="meta">영향 확인(impact_check)까지 한 결과</span></div>
    <div class="ddl"><span class="chip warn">제안만 · 실행하지 않음</span><code>${clean(i.ddl)}</code></div>
    <div class="impact">${row('쓰기 부하', i.write_load.level, i.write_load.note)}${row('기존 쿼리 영향', i.other_queries.level, i.other_queries.note)}${effect}</div></section>`
  }

  const rulesSec = (): string => {
    const head7 = '<section class="sec" aria-labelledby="s7"><div class="h"><h2 id="s7"><span class="no">07</span>근거 — 적용한 사내 표준</h2>'
    if (!input.standard) {
      return `${head7}<span class="meta">표준 판정 없음</span></div>
    <div class="empty"><b>표준 판정 없음</b><p>이 프로젝트에 사내 SQL 표준이 설치되어 있지 않아 규칙 번호로 근거를 달지 않았습니다.</p></div></section>`
    }
    const list = input.rules ?? []
    const items = list
      .map((rule) => {
        const [label, tone] = RULE[rule.status]
        return `<div class="r"><b>${clean(rule.id)}</b><span class="tx">${clean(rule.text)}</span><em><span class="chip ${tone}">${tone === 'ok' ? '✓ ' : tone === 'bad' ? '✕ ' : ''}${label}</span></em>${rule.where ? `<span class="where">${clean(rule.where)}</span>` : ''}</div>`
      })
      .join('')
    const total = input.standard.rules_total
    return `${head7}<span class="meta">규칙 번호는 표준 문서의 번호입니다</span></div>
    ${items ? `<div class="rules">${items}</div>` : '<div class="empty"><b>해당하는 규칙이 없습니다</b><p>표준은 있었지만 이번 SQL 에 적용되는 규칙을 찾지 못했습니다.</p></div>'}
    <p class="src-line">표준 파일 <code>${clean(input.standard.file)}</code>${total !== undefined ? ` (규칙 ${total}개 중 ${list.length}개 해당)` : ''}</p></section>`
  }

  const limits = [
    `<b>개발 DB 기준</b>입니다. 운영 DB 의 데이터 양 · 통계가 다르면 실행계획과 시간이 달라질 수 있습니다.`,
    `<b>비용</b>은 ${input.db === 'oracle' ? '옵티마이저' : '플래너'}의 예상값이고, <b>실측 시간</b>은 DB 캐시의 영향을 받습니다.`,
    `결과 비교는 <b>바인드 값 ${input.compare.length}개</b>로 했습니다. ${ok ? '다른 값에서도 같다는 보장은 아닙니다.' : '같은 값만 골랐다면 차이를 놓쳤을 수 있습니다.'}`,
  ]
  const li = (text: string, html = false): string => `<li>${html ? text : clean(text)}</li>`
  const unknown = [li('고친 SQL 을 코드에 옮긴 뒤의 동작(코드는 바꾸지 않았습니다)'), ...(input.index ? [li('인덱스를 만든 뒤의 실행계획과 쓰기 속도(제안만 했고 실행하지 않았습니다)')] : []), ...(input.unknown ?? []).map((text) => li(text))]
  const limitSec = `<section class="sec" aria-labelledby="s8"><div class="h"><h2 id="s8"><span class="no">08</span>한계와 확인하지 못한 것</h2></div>
    <div class="two"><div><h3>한계</h3><ul>${limits.map((text) => li(text, true)).join('')}${(input.limits ?? []).map((text) => li(text)).join('')}${(input.estimates ?? []).map((text) => `<li><span class="chip warn">추정</span> ${clean(text)}</li>`).join('')}</ul></div>
    <div><h3>확인하지 못한 것</h3><ul>${unknown.join('')}</ul></div></div></section>`

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SQL 튜닝 최종 결과서 — ${clean(input.target)}</title>
<style>${STYLE}</style>
</head>
<body>
<article aria-label="SQL 튜닝 최종 결과서 — ${clean(input.target)}">${head}${verdict}${diff}${planSec}${cmp}${indexSec()}${rulesSec()}${limitSec}
<footer class="foot"><span>AI 는 DB 와 프로젝트 소스를 바꾸지 않았습니다. 조회만 했습니다.</span><span>비밀번호 · 접속 정보와 데이터 행은 이 문서에 들어 있지 않습니다. 인쇄하면 PDF 결과서입니다.</span></footer></article>
</body>
</html>
`
}

// ── 파일 쓰기 ─────────────────────────────────────────────────────────────────

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** 프로젝트 폴더 아래 sql-tuning-reports/<시각>/index.html 로 쓰고 프로젝트 기준 경로를 돌려준다. 실제 경로(심볼릭 링크 풀어서)가 프로젝트 밖이면 거절한다 */
export async function writeReport(cwd: string, html: string, now: Date): Promise<string> {
  const root = await realpath(cwd)
  const base = path.join(root, REPORT_DIR)
  await mkdir(base, { recursive: true })
  if (!inside(root, await realpath(base))) throw new Error(`${REPORT_DIR} resolves outside the project folder — refusing to write there.`)
  for (let attempt = 0; attempt < 100; attempt++) {
    const dir = path.join(base, attempt ? `${stamp(now)}-${attempt + 1}` : stamp(now))
    try {
      await mkdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    const file = path.join(dir, 'index.html')
    if (!inside(root, await realpath(dir))) throw new Error('The report folder resolves outside the project folder.')
    await writeFile(file, html, 'utf8')
    return path.relative(root, file).split(path.sep).join('/')
  }
  throw new Error('Could not pick a free report folder name.')
}

/** 결과서 폴더가 .gitignore 에 없고 처음이면 제안 글 — 플러그인은 .gitignore 를 고치지 않는다 (ui-test 와 같은 방식). 물어 본 표시는 폴더 안 .gitignore-asked */
export async function gitignoreHint(cwd: string): Promise<string | undefined> {
  const root = await realpath(cwd)
  const ignore = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '')
  if (ignore.split(/\r?\n/).some((line) => line.trim().replace(/^\//, '').replace(/\/?$/, '/') === `${REPORT_DIR}/`)) return undefined
  const marker = path.join(root, REPORT_DIR, '.gitignore-asked')
  if (await readFile(marker, 'utf8').then(() => true, () => false)) return undefined
  await writeFile(marker, 'asked\n', 'utf8').catch(() => undefined)
  return `${REPORT_DIR}/`
}
