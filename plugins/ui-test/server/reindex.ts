// 다시 채우기 (0.7.0) — 시나리오 폴더(`.litecode/plugins/ui-test/scenarios`)의 시나리오 md 를 훑어 DB 의 scenarios · requests 를 맞춘다. 파일이 정본이라 DB 가 비어도 시나리오 목록 · 요청 태그는 돌아오고 잃는 것은 수행 기록뿐이다.
// 훑는 곳: 시나리오 폴더 바로 아래의 `.md` (`_`·`.` 로 시작하는 파일 제외, 하위 폴더는 보지 않는다). 번호 단계가 하나도 없는 md 는 시나리오가 아니라 건너뛴다.
// 요청 태그: 머리 `request:` · `requested:` 에서 만든다 — 파일 이름이 `<요청 id>-<번호>` 면 그 앞이 요청 id, 아니면 요청 글 · 시각의 해시.
// 화면 태그: 수행이 정하기 전(observed 아님)에는 머리 `screens:` 가 값이다. 이름은 머리 `screen-names:` 가 screens 컬렉션에 쓴다.
// 시나리오 폴더가 없으면 아무것도 지우지 않는다(드라이브가 빠졌거나 폴더를 아직 안 만든 경우에 이력을 날리지 않게). 폴더가 있는데 md 가 없으면 DB 줄과 결과도 지운다.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { HISTORY_SUFFIX } from './remove.ts'
import { parseScenario } from './scenario.ts'
import { requestIdFor, scenarioIdForFile, type Dropped, type RequestDoc, type Store } from './store.ts'
import type { Scenario } from './types.ts'

export interface ReindexResult {
  added: number
  updated: number
  removed: number
  /** 지운 시나리오의 결과 · 비게 된 수행 — 스크린샷 · 결과서 파일 삭제는 부르는 쪽 */
  dropped: Dropped
}

export interface Found {
  id: string
  /** 프로젝트 기준 경로 */
  file: string
  scenario: Scenario
}

async function markdownIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith(HISTORY_SUFFIX) && !/^[_.]/.test(entry.name)).map((entry) => entry.name).sort()
}

const posix = (project: string, abs: string): string => path.relative(project, abs).split(path.sep).join('/')

/** 시나리오 폴더의 시나리오 파일 — DB 없이도 쓴다(앱 밖 실행). 폴더가 없으면 비어 있다 */
export async function scanScenarios(project: string, scenarioDir: string): Promise<Found[]> {
  const found: Found[] = []
  for (const name of await markdownIn(scenarioDir).catch(() => [] as string[])) {
    const file = posix(project, path.join(scenarioDir, name))
    const id = scenarioIdForFile(file, true)
    const text = await readFile(path.join(scenarioDir, name), 'utf8').catch(() => undefined) // 훑는 사이에 지워진 파일은 건너뛴다
    if (text === undefined) continue
    const scenario = parseScenario(id, text)
    if (scenario.steps.length === 0) continue
    found.push({ id, file, scenario })
  }
  return found
}

const same = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((item, index) => item === b[index])

export async function reindex(store: Store, config: { project: string; scenarioDir: string }): Promise<ReindexResult> {
  const result: ReindexResult = { added: 0, updated: 0, removed: 0, dropped: { results: [], runs: [] } }
  if (!(await stat(config.scenarioDir).then((s) => s.isDirectory(), () => false))) return result
  const found = await scanScenarios(config.project, config.scenarioDir)
  const existing = new Map((await store.listScenarios()).map((item) => [item.id, item.doc]))

  // 요청 태그 — 시나리오마다 정하고, 같은 요청의 시나리오를 모아 requests 한 줄로
  const requestOf = new Map<string, string>()
  const requests = new Map<string, { text: string; at: number; members: string[] }>()
  for (const item of found) {
    const { scenario } = item
    let requestId: string | undefined
    if (scenario.request) {
      requestId = requestIdFor(item.id, scenario.request, scenario.requested)
      const group = requests.get(requestId)
      if (group) group.members.push(item.id)
      else requests.set(requestId, { text: scenario.request, at: Date.parse(scenario.requested ?? '') || 0, members: [item.id] })
    }
    if (requestId) requestOf.set(item.id, requestId)
  }
  for (const [requestId, group] of requests) {
    const current = await store.getRequest(requestId)
    const members = group.members.sort()
    const doc: RequestDoc = { text: group.text, at: current?.at ?? (group.at || Date.now()), scenarios: members, ...(current?.lastRun && { lastRun: current.lastRun }) }
    if (!current || current.text !== doc.text || !same(current.scenarios, members)) await store.putRequest(requestId, doc)
  }

  // 화면 이름 — 머리 screen-names 가 screens 컬렉션에
  const names = new Map<string, string>()
  for (const item of found) for (const [route, name] of Object.entries(item.scenario.screenNames)) names.set(route, name)
  for (const [route, name] of names) {
    const current = await store.getScreen(route)
    if (!current || current.name !== name) await store.putScreen({ rules: [], ...current, route, name })
  }

  for (const item of found) {
    const before = existing.get(item.id)
    const { scenario } = item
    const request = requestOf.get(item.id) ?? before?.request
    const screens = before?.observed ? before.screens : scenario.screens
    const same_ = before && before.fingerprint === scenario.fingerprint && before.title === scenario.name && before.file === item.file && before.kind === scenario.kind && before.request === request && (before.observed ? true : same(before.screens, screens))
    if (same_) continue
    await store.upsertScenario(item.id, { title: scenario.name, kind: scenario.kind, fingerprint: scenario.fingerprint, file: item.file, screens, ...(request && { request }) })
    if (before) result.updated++
    else result.added++
  }

  const alive = new Set(found.map((item) => item.id))
  for (const id of existing.keys()) {
    if (alive.has(id)) continue
    const dropped = await store.deleteScenario(id)
    result.removed++
    result.dropped.results.push(...dropped.results)
    result.dropped.runs.push(...dropped.runs)
  }
  return result
}
