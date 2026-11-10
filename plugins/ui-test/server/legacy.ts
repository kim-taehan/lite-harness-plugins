// 옛 `ui-tests/` 가져오기 (0.7.0) — 0.6.x 가 프로젝트에 두던 시나리오(묶음 폴더 · suite.md · *.md · *.spec.mjs)를 새 시나리오 폴더로 한 번 **복사**한다.
// 옛 폴더는 건드리지 않는다(사용자가 직접 정리). 가져온 사실은 `.litecode/plugins/ui-test/imported.json` 에 적고, 그 파일이 있으면 다시 가져오지 않는다.
// 이름이 겹치면 `<묶음 폴더 이름>-<원래 이름>` 으로 피한다. 옛 `_reports/` 와 `_prompt.md` 는 가져오지 않는다.
// 옛 suite.md 의 request: · 폴더 이름은 imported.json 에 남겨 reindex 가 요청 태그로 만든다(reindex.ts).

import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { guardPluginPath, IMPORTED_FILE, LEGACY_TEST_DIR } from './config.ts'
import { specOf } from './remove.ts'
import { parseScenario, parseSuite } from './scenario.ts'
import type { LegacySuite } from './types.ts'

const SUITE_FILE = 'suite.md'

export interface ImportedRecord {
  at: number
  /** 프로젝트 기준 옛 폴더 */
  from: string
  /** 원본 경로(프로젝트 기준) → 새 시나리오 폴더 안 이름. folder 는 옛 suite.md 가 있던 묶음 폴더 */
  files: { from: string; to: string; folder?: string }[]
  /** suite.md 가 있던 묶음 폴더 → 그 머리 (요청 태그용) */
  suites: Record<string, Omit<LegacySuite, 'id'>>
}

const importedFile = (pluginDir: string): string => path.join(pluginDir, IMPORTED_FILE)

/** 가져온 기록 — 없거나 읽을 수 없으면 undefined */
export async function readImported(pluginDir: string): Promise<ImportedRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(importedFile(pluginDir), 'utf8')) as ImportedRecord
    return Array.isArray(record.files) ? record : undefined
  } catch {
    return undefined
  }
}

const posix = (project: string, abs: string): string => path.relative(project, abs).split(path.sep).join('/')

async function markdownIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== SUITE_FILE && !/^[_.]/.test(entry.name)).map((entry) => entry.name).sort()
}

/** 옛 폴더의 시나리오를 새 폴더로 복사하고 개수를 돌려준다. 이미 가져왔거나 옛 폴더가 없거나 가져올 것이 없으면 0 (아무것도 쓰지 않는다) */
export async function importLegacy(project: string, pluginDir: string, scenarioDir: string): Promise<number> {
  if (await stat(importedFile(pluginDir)).then(() => true, () => false)) return 0
  const legacyDir = path.join(project, LEGACY_TEST_DIR)
  const top = await readdir(legacyDir, { withFileTypes: true }).catch(() => undefined)
  if (!top) return 0

  // 가져올 것 — 바로 아래 먼저(원래 이름 · id 를 지키려고), 그 뒤 묶음 폴더 이름 순
  const sources: { abs: string; name: string; folder?: string }[] = []
  const suites: ImportedRecord['suites'] = {}
  for (const name of await markdownIn(legacyDir)) sources.push({ abs: path.join(legacyDir, name), name })
  for (const entry of top.filter((item) => item.isDirectory() && !/^[_.]/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(legacyDir, entry.name)
    const suiteText = await readFile(path.join(dir, SUITE_FILE), 'utf8').catch(() => undefined)
    if (suiteText !== undefined) {
      const suite = parseSuite(entry.name, suiteText)
      suites[entry.name] = { name: suite.name, ...(suite.request && { request: suite.request }), created: suite.created ?? new Date((await stat(path.join(dir, SUITE_FILE))).mtimeMs).toISOString() }
    }
    for (const name of await markdownIn(dir).catch(() => [])) sources.push({ abs: path.join(dir, name), name, folder: entry.name })
  }

  const taken = new Set(await readdir(scenarioDir).catch(() => [] as string[]))
  const files: ImportedRecord['files'] = []
  const copies: { from: string; to: string }[] = []
  for (const source of sources) {
    const text = await readFile(source.abs, 'utf8').catch(() => undefined)
    if (text === undefined || parseScenario('x', text).steps.length === 0) continue // 번호 단계가 없는 md 는 시나리오가 아니다
    const stem = source.name.replace(/\.md$/, '')
    let to = stem
    if (taken.has(`${to}.md`) || taken.has(specOf(`${to}.md`))) to = `${source.folder ?? 'ui-tests'}-${stem}`
    for (let seq = 2; taken.has(`${to}.md`) || taken.has(specOf(`${to}.md`)); seq++) to = `${source.folder ?? 'ui-tests'}-${stem}-${seq}`
    taken.add(`${to}.md`).add(specOf(`${to}.md`))
    copies.push({ from: source.abs, to: path.join(scenarioDir, `${to}.md`) })
    copies.push({ from: specOf(source.abs), to: path.join(scenarioDir, specOf(`${to}.md`)) })
    files.push({ from: posix(project, source.abs), to: `${to}.md`, ...(source.folder && suites[source.folder] && { folder: source.folder }) })
  }
  if (files.length === 0) return 0

  await guardPluginPath(project, scenarioDir)
  await mkdir(scenarioDir, { recursive: true })
  for (const { from, to } of copies) await copyFile(from, to, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error // 짝 spec 이 없는 것은 건너뛴다
  })
  const record: ImportedRecord = { at: Date.now(), from: LEGACY_TEST_DIR, files, suites }
  await guardPluginPath(project, importedFile(pluginDir))
  await writeFile(importedFile(pluginDir), JSON.stringify(record, null, 2))
  return files.length
}
