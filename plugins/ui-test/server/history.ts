// 수행 이력 (#1248, 계획 §2-3a) — 묶음마다 최근 KEEP_RUNS 개를 데이터 폴더(이 PC)의 JSON 하나에 둔다. 스크린샷은 수행마다 폴더 하나.
// 지난 수행과 비교: 새로 실패 · 고쳐짐 · 그대로 실패

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { KEEP_RUNS } from './config.ts'
import type { CaseResult, Comparison, RunRecord } from './types.ts'

/** 비교 단위 — 데이터 표가 없으면 시나리오 하나, 있으면 행마다 `<id>#<행>` */
export function units(cases: CaseResult[]): { key: string; status: CaseResult['status'] }[] {
  return cases.flatMap((item) => (item.rows ? item.rows.map((row) => ({ key: `${item.id}#${row.row}`, status: row.status })) : [{ key: item.id, status: item.status }]))
}

/** `<id>#2` → `<id> 2행` (화면 · 결과서) */
export const unitLabel = (key: string): string => key.replace(/#(\d+)$/, ' $1행')

/** 지난 수행과 비교 — 일부 시나리오만 돌린 수행이 끼어 있어도 맞게: 단위(시나리오 · 데이터 행)마다 **마지막으로 실제 돈**(성공 · 실패) 결과와 견준다.
 *  previous 가 바로 직전 수행(비교 기준 id), older 는 그 전 기록들(최근 것부터) — 직전 수행에 없던 시나리오는 더 오래된 기록에서 찾는다 */
export function compareRuns(previous: RunRecord | undefined, current: CaseResult[], older: RunRecord[] = []): Comparison | undefined {
  if (!previous) return undefined
  const before = new Map<string, string>()
  for (const run of [previous, ...older]) for (const item of units(run.cases)) if ((item.status === 'passed' || item.status === 'failed') && !before.has(item.key)) before.set(item.key, item.status)
  const out: Comparison = { previousId: previous.id, newFail: [], fixed: [], stillFail: [] }
  for (const item of units(current)) {
    const old = before.get(item.key)
    if (item.status === 'failed') (old === 'failed' ? out.stillFail : out.newFail).push(item.key)
    else if (item.status === 'passed' && old === 'failed') out.fixed.push(item.key)
  }
  return out
}

export const compareLine = (compare: Comparison): string => `새로 실패 ${compare.newFail.length} · 고쳐짐 ${compare.fixed.length} · 그대로 실패 ${compare.stillFail.length}`

/** 새 기록을 맨 앞에 — 넘친 기록을 돌려준다(그 스크린샷 · 결과서를 지운다) */
export function addRun(runs: RunRecord[], run: RunRecord, keep = KEEP_RUNS): { runs: RunRecord[]; dropped: RunRecord[] } {
  const all = [run, ...runs.filter((item) => item.id !== run.id)]
  return { runs: all.slice(0, keep), dropped: all.slice(keep) }
}

/** 결과서는 우리가 만든 폴더(<묶음>/<날짜-시각>/index.html)만 지운다 */
async function removeReportFolder(run: RunRecord): Promise<void> {
  if (path.basename(run.report) === 'index.html' && /^\d{8}-\d{6}$/.test(path.basename(path.dirname(run.report)))) await fs.rm(path.dirname(run.report), { recursive: true, force: true })
}

/** 프로젝트 · 묶음마다 파일 하나 — 데이터 폴더는 플러그인 하나가 여러 프로젝트에 같이 쓴다 */
export class History {
  constructor(
    private readonly dataDir: string,
    private readonly project: string,
  ) {}

  private get root(): string {
    return path.join(this.dataDir, 'projects', createHash('sha256').update(this.project).digest('hex').slice(0, 16))
  }

  private file(suite: string): string {
    return path.join(this.root, 'history', `${encodeURIComponent(suite)}.json`)
  }

  /** 수행 하나의 스크린샷 폴더 */
  shotsDir(suite: string, runId: string): string {
    return path.join(this.root, 'shots', encodeURIComponent(suite), runId)
  }

  async runs(suite: string): Promise<RunRecord[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.file(suite), 'utf8')) as unknown
      return Array.isArray(value) ? (value as RunRecord[]) : []
    } catch {
      return []
    }
  }

  async add(run: RunRecord, keep = KEEP_RUNS): Promise<RunRecord[]> {
    const { runs, dropped } = addRun(await this.runs(run.suite), run, keep)
    await fs.mkdir(path.dirname(this.file(run.suite)), { recursive: true })
    const temp = `${this.file(run.suite)}.${process.pid}.tmp`
    await fs.writeFile(temp, JSON.stringify(runs, null, 1))
    await fs.rename(temp, this.file(run.suite))
    for (const old of dropped) {
      await fs.rm(this.shotsDir(old.suite, old.id), { recursive: true, force: true })
      await removeReportFolder(old)
    }
    return dropped
  }

  /** 묶음을 지울 때 — 그 묶음의 수행 이력 파일과 스크린샷 전부 */
  async purge(suite: string): Promise<void> {
    await fs.rm(this.file(suite), { force: true })
    await fs.rm(path.join(this.root, 'shots', encodeURIComponent(suite)), { recursive: true, force: true })
  }

  /** 시나리오 하나를 지울 때 — 모든 수행 기록에서 그 시나리오 결과(와 비교 줄)를 빼고 스크린샷을 지운다. 남는 결과가 없는 수행은 통째로 지운다.
   *  고쳐 쓴 수행(결과서를 다시 만들 것)과 통째로 지운 수행을 돌려준다 */
  async dropScenario(suite: string, scenarioId: string): Promise<{ changed: RunRecord[]; removed: RunRecord[] }> {
    const runs = await this.runs(suite)
    const kept: RunRecord[] = []
    const changed: RunRecord[] = []
    const removed: RunRecord[] = []
    const own = (key: string) => key === scenarioId || key.startsWith(`${scenarioId}#`)
    for (const run of runs) {
      const gone = run.cases.find((item) => item.id === scenarioId)
      if (!gone) {
        kept.push(run)
        continue
      }
      for (const step of [...gone.steps, ...(gone.rows ?? []).flatMap((row) => row.steps)]) {
        for (const shot of [step.shot, step.failShot]) if (shot) await fs.rm(path.join(this.shotsDir(suite, run.id), path.basename(shot)), { force: true })
      }
      const cases = run.cases.filter((item) => item.id !== scenarioId)
      if (cases.length === 0) {
        removed.push(run)
        await fs.rm(this.shotsDir(suite, run.id), { recursive: true, force: true })
        await removeReportFolder(run)
        continue
      }
      const next: RunRecord = { ...run, cases, ...(run.compare && { compare: { ...run.compare, newFail: run.compare.newFail.filter((key) => !own(key)), fixed: run.compare.fixed.filter((key) => !own(key)), stillFail: run.compare.stillFail.filter((key) => !own(key)) } }) }
      kept.push(next)
      changed.push(next)
    }
    if (kept.length !== runs.length || changed.length) {
      const temp = `${this.file(suite)}.${process.pid}.tmp`
      await fs.writeFile(temp, JSON.stringify(kept, null, 1))
      await fs.rename(temp, this.file(suite))
    }
    return { changed, removed }
  }

  /** 처음 한 번만 참 — .gitignore 제안을 한 번만 하게 */
  async firstTime(flag: string): Promise<boolean> {
    const file = path.join(this.root, 'flags.json')
    let flags: Record<string, boolean> = {}
    try {
      flags = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, boolean>
    } catch {
      // 없으면 처음
    }
    if (flags[flag]) return false
    await fs.mkdir(this.root, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ ...flags, [flag]: true }))
    return true
  }
}
