// 수행 결과를 증적에 남기는 글 고치기 — 순수 함수(파일을 읽고 쓰는 것은 replay.ts).
// AI 가 쓴 md 에서 고칠 줄만 바꾼다: TC 표 한 줄, 수행 이력 맨 위 한 건, 머리말 last_verified, 스크립트의 최근 통과일, system_map 의 확인일 · TC 건수 줄.

import { blocks, sectionRange, table, updateRow } from './markdown.ts'

/** 페이지 문서에 남기는 수행 이력 최대 건수 — 넘는 것은 pages/history/<page_id>.md 로 */
export const KEEP_HISTORY = 10
const COUNT_ORDER = ['성공', '실패', '차단', '미수행', '폐기']

export interface RunRecord {
  tc: string
  status: string
  date: string
  scriptState: string
  /** 수행 이력 한 건 (### 줄부터) */
  entry: string
  /** 대상 페이지에 닿았다 — last_verified 를 오늘로 */
  arrived: boolean
}

/** 페이지 문서에 수행 한 건 — TC 줄을 못 찾으면 undefined (파일을 건드리지 않는다). moved 는 history 로 옮길 옛 항목 */
export function applyRun(text: string, run: RunRecord): { text: string; moved: string } | undefined {
  const updated = updateRow(text, '테스트 케이스', run.tc, { 상태: run.status, '최근 수행일': run.date, '스크립트 상태': run.scriptState })
  if (updated === undefined) return undefined
  let lines = updated.split('\n')
  let range = sectionRange(lines, '수행 이력')
  if (!range) {
    lines = [...trimEnd(lines), '', '## 수행 이력 (최근 10건)']
    range = [lines.length - 1, lines.length]
  }
  const [start, end] = range
  const body = lines.slice(start + 1, end)
  // 틀(<run_id> 자리표시)만 있는 빈 항목은 뺀다
  const existing = splitEntries(body).filter((entry) => !/^### <run_id>/.test(entry[0] ?? ''))
  const entries = [run.entry.trimEnd().split('\n'), ...existing]
  const keep = entries.slice(0, KEEP_HISTORY)
  const moved = entries.slice(KEEP_HISTORY).map((entry) => entry.join('\n').trimEnd()).join('\n')
  const tail = end < lines.length ? [''] : []
  lines = [...lines.slice(0, start + 1), ...keep.flatMap((entry) => trimEnd(entry)), ...tail, ...lines.slice(end)]
  let out = lines.join('\n')
  if (run.arrived) out = out.replace(/^(last_verified:).*$/m, `$1 ${run.date}`)
  return { text: out.endsWith('\n') ? out : out + '\n', moved }
}

function splitEntries(body: readonly string[]): string[][] {
  const out: string[][] = []
  for (const line of body) {
    if (line.startsWith('### ')) out.push([line])
    else if (out.length) out.at(-1)!.push(line)
  }
  return out
}

function trimEnd(lines: readonly string[]): string[] {
  const out = [...lines]
  while (out.length && !out.at(-1)!.trim()) out.pop()
  return out
}

/** history 파일 끝에 붙인다 */
export function appendHistory(existing: string | undefined, pageId: string, moved: string): string {
  const head = existing?.trimEnd() || `# ${pageId} 수행 이력 (옛 항목)`
  return `${head}\n${moved}\n`
}

/** 스크립트의 `최근 통과일:` 줄만 바꾼다 */
export function touchScript(text: string, date: string): string {
  return /^최근 통과일:.*$/m.test(text) ? text.replace(/^최근 통과일:.*$/m, `최근 통과일: ${date}`) : text
}

/** `N건 (성공 a, 미수행 b)` */
export function countsLine(statuses: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1)
  const order = [...COUNT_ORDER, ...[...counts.keys()].filter((key) => !COUNT_ORDER.includes(key))]
  const parts = order.filter((key) => counts.get(key)).map((key) => `${key} ${counts.get(key)}`)
  return `${statuses.length}건 (${parts.join(', ')})`
}

/** system_map — 페이지 · 지난 이동의 최근 확인일, 페이지 설명의 TC 건수 줄. 못 찾은 줄은 그대로 둔다 */
export function touchMap(text: string, input: { page: string; edges: readonly string[]; date: string; statuses: readonly string[]; arrived: boolean }): string {
  let out = text
  if (input.arrived) {
    out = updateRow(out, '페이지 목록', input.page, { '최근 확인일': input.date }) ?? out
    for (const edge of input.edges) out = updateRow(out, '이동 관계', edge, { '최근 확인일': input.date, 상태: '유효' }) ?? out
  }
  const lines = out.split('\n')
  const range = sectionRange(lines, '페이지 설명')
  if (!range) return out
  const start = lines.findIndex((line, index) => index > range[0] && index < range[1] && (line.startsWith(`### ${input.page} `) || line === `### ${input.page}`))
  if (start < 0) return out
  let end = range[1]
  for (let index = start + 1; index < range[1]; index++) {
    if (lines[index]!.startsWith('### ')) {
      end = index
      break
    }
  }
  const line = `- 테스트 케이스: ${countsLine(input.statuses)}`
  const at = lines.findIndex((value, index) => index > start && index < end && value.startsWith('- 테스트 케이스:'))
  if (at >= 0) lines[at] = line
  else {
    let last = end - 1
    while (last > start && !lines[last]!.trim()) last--
    lines.splice(last + 1, 0, line)
  }
  return lines.join('\n')
}

/** 페이지 문서 TC 표의 상태들 */
export const statusesOf = (pageDoc: string): string[] => table(pageDoc, '테스트 케이스').filter((row) => row['tc_id']).map((row) => row['상태'] ?? '미수행')

/** 수행 이력 항목 수 — 시험용 */
export const historyCount = (pageDoc: string): number => {
  const lines = pageDoc.split('\n')
  const range = sectionRange(lines, '수행 이력')
  return range ? blocks(lines.slice(range[0] + 1, range[1]).join('\n')).length : 0
}
