// 지난 수행과 비교 (#1248, 계획 §2-3a) — 새로 실패 · 고쳐짐 · 그대로 실패.
// 비교 단위는 시나리오, 데이터 표가 있으면 행마다 `<id>#<행>`. 견주는 값은 단위마다 **마지막으로 실제 돈**(성공 · 실패) 결과 —
// 일부만 실행한 수행이 끼어 있어도 맞는다. 그 값은 저장소의 scenarios.last · results 에 있다(runner.ts 가 읽어 `before` 로 넘긴다).

import type { CaseResult, Comparison } from './types.ts'

/** 비교 단위 — 데이터 표가 없으면 시나리오 하나, 있으면 행마다 `<id>#<행>` */
export function units(cases: CaseResult[]): { key: string; status: CaseResult['status'] }[] {
  return cases.flatMap((item) => (item.rows ? item.rows.map((row) => ({ key: `${item.id}#${row.row}`, status: row.status })) : [{ key: item.id, status: item.status }]))
}

/** `<id>#2` → `<id> 2행` (화면 · 결과서) */
export const unitLabel = (key: string): string => key.replace(/#(\d+)$/, ' $1행')

/** 단위마다 지난 실제 결과(before)와 이번 결과를 견준다. before 가 비어 있으면(처음 실행) 비교하지 않는다 — previousId 는 견준 결과 중 가장 최근 수행 */
export function compareWithLast(before: Map<string, 'passed' | 'failed'>, previousId: string | undefined, current: CaseResult[]): Comparison | undefined {
  if (!previousId || before.size === 0) return undefined
  const out: Comparison = { previousId, newFail: [], fixed: [], stillFail: [] }
  for (const item of units(current)) {
    const old = before.get(item.key)
    if (item.status === 'failed') (old === 'failed' ? out.stillFail : out.newFail).push(item.key)
    else if (item.status === 'passed' && old === 'failed') out.fixed.push(item.key)
  }
  return out
}

/** 비교 줄 중 시나리오 하나의 몫만 — 시나리오마다 따로 낸 결과서에 쓴다 */
export function compareFor(compare: Comparison | undefined, scenarioId: string): Comparison | undefined {
  if (!compare) return undefined
  const own = (key: string): boolean => key === scenarioId || key.startsWith(`${scenarioId}#`)
  return { previousId: compare.previousId, newFail: compare.newFail.filter(own), fixed: compare.fixed.filter(own), stillFail: compare.stillFail.filter(own) }
}

export const compareLine = (compare: Comparison): string => `새로 실패 ${compare.newFail.length} · 고쳐짐 ${compare.fixed.length} · 그대로 실패 ${compare.stillFail.length}`
