// 다시 채우기 (0.7.0 1 단계) — 테스트 폴더의 시나리오 md 를 훑어 DB 의 scenarios 를 맞춘다. 파일이 정본이라 DB 가 비어도 시나리오 목록은 돌아오고 잃는 것은 수행 기록뿐이다.
// 훑는 곳: 테스트 폴더 바로 아래와 한 단계 하위 폴더의 `.md` (suite.md · `_`·`.` 로 시작하는 폴더 제외). 번호 단계가 하나도 없는 md 는 시나리오가 아니라 건너뛴다.
// 옛 suite.md 가 있는 폴더는 요청 태그로 가져온다(폴더 이름 · request:) — 이미 요청 태그가 있는 시나리오는 그대로 둔다.
// 테스트 폴더가 없으면 아무것도 지우지 않는다(드라이브가 빠졌거나 설정이 틀린 경우에 이력을 날리지 않게). 폴더가 있는데 md 가 없으면 DB 줄과 결과도 지운다.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseScenario, parseSuite } from './scenario.ts'
import { importedRequestId, scenarioIdForFile, type Dropped, type RequestDoc, type ScenarioDoc, type Store } from './store.ts'

export interface ReindexResult {
  added: number
  updated: number
  removed: number
  /** 지운 시나리오의 결과 · 비게 된 수행 — 스크린샷 · 결과서 파일 삭제는 부르는 쪽 */
  dropped: Dropped
}

const SUITE_FILE = 'suite.md'

interface Found {
  id: string
  file: string
  doc: Pick<ScenarioDoc, 'title' | 'kind' | 'fingerprint' | 'file'>
  /** 옛 suite.md 폴더 이름 */
  folder?: string
}

async function markdownIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== SUITE_FILE).map((entry) => entry.name).sort()
}

const posix = (project: string, abs: string): string => path.relative(project, abs).split(path.sep).join('/')

async function scan(project: string, testDir: string, imports: Map<string, { suiteText: string; at: number }>): Promise<Found[]> {
  const found: Found[] = []
  const read = async (dir: string, name: string, topLevel: boolean, folder?: string): Promise<void> => {
    const abs = path.join(dir, name)
    const file = posix(project, abs)
    const id = scenarioIdForFile(file, topLevel)
    const scenario = parseScenario(id, await readFile(abs, 'utf8'))
    if (scenario.steps.length === 0) return
    found.push({ id, file, doc: { title: scenario.name, kind: scenario.kind, fingerprint: scenario.fingerprint, file }, ...(folder && { folder }) })
  }
  for (const name of await markdownIn(testDir)) await read(testDir, name, true)
  const folders = (await readdir(testDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !/^[_.]/.test(entry.name)).map((entry) => entry.name).sort()
  for (const folder of folders) {
    const dir = path.join(testDir, folder)
    const suiteFile = path.join(dir, SUITE_FILE)
    const suiteText = await readFile(suiteFile, 'utf8').catch(() => undefined)
    if (suiteText !== undefined) imports.set(folder, { suiteText, at: (await stat(suiteFile)).mtimeMs })
    for (const name of await markdownIn(dir)) await read(dir, name, false, suiteText !== undefined ? folder : undefined)
  }
  return found
}

export async function reindex(store: Store, config: { project: string; testDir: string }): Promise<ReindexResult> {
  const result: ReindexResult = { added: 0, updated: 0, removed: 0, dropped: { results: [], runs: [] } }
  if (!(await stat(config.testDir).then((s) => s.isDirectory(), () => false))) return result
  const imports = new Map<string, { suiteText: string; at: number }>()
  const found = await scan(config.project, config.testDir, imports)
  const existing = new Map((await store.listScenarios()).map((item) => [item.id, item.doc]))

  // 요청 태그 가져오기 — 폴더마다 한 줄, 그 폴더의 시나리오가 목록
  const members = new Map<string, string[]>()
  for (const item of found) if (item.folder) members.set(item.folder, [...(members.get(item.folder) ?? []), item.id])
  for (const [folder, ids] of members) {
    const { suiteText, at } = imports.get(folder)!
    const suite = parseSuite(folder, suiteText)
    const requestId = importedRequestId(folder)
    const current = await store.getRequest(requestId)
    const doc: RequestDoc = { text: suite.request || suite.name || folder, at: current?.at ?? (Date.parse(suite.created ?? '') || at), scenarios: ids, imported: folder }
    if (!current || current.text !== doc.text || current.scenarios.join('\n') !== ids.join('\n')) await store.putRequest(requestId, doc)
  }

  for (const item of found) {
    const before = existing.get(item.id)
    const request = item.folder && !before?.request ? importedRequestId(item.folder) : undefined
    const same = before && before.fingerprint === item.doc.fingerprint && before.title === item.doc.title && before.file === item.doc.file && before.kind === item.doc.kind
    if (same && !request) continue
    await store.upsertScenario(item.id, { ...item.doc, ...(request && { request }) })
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
