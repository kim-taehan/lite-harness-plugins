// 결과서 저장 위치(.litecode/plugins/sql-tuning/reports) · 목록 색인(host.db reports) — 서버 쪽(server/report.ts · tools.ts).
// 색인은 SDK 가짜 host 의 db 로 본다. 앱 안에서 AI 가 report 를 불러 서버가 LITECODE_DB_URL 로 쓰는 종단과 실제 DB(Oracle)는 여기서 못 본다.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'
import { PLUGIN_DIR, REPORTS_COLLECTION, buildMeta, removeReport, writeReport, type ReportIndex } from '../server/report.ts'
import { createTools } from '../server/tools.ts'
import type { Adapter } from '../server/types.ts'
import { win } from './report.fixtures.ts'

const DIR = '/work/a'
const at = new Date(2026, 10, 9, 14, 32, 5)
const dirs: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqlt-idx-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 서버가 쓰는 createDbClient() 와 같은 모양(directory 인자 없음)으로 가짜 host 의 db 를 감싼다 */
function fakeIndex() {
  const fake = createFakeHost({ id: 'sql-tuning', scope: 'project' })
  fake.enableProject(DIR)
  const db = fake.host.db!
  const index: ReportIndex = { set: (collection, id, doc) => db.set(collection, id, doc, { directory: DIR }), delete: (collection, id) => db.delete(collection, id, { directory: DIR }) }
  const rows = async () => (await db.list(REPORTS_COLLECTION, {}, { directory: DIR })).docs as { id: string; doc: Record<string, unknown> }[]
  return { index, rows }
}
const metaOf = (id: string) => buildMeta(win, id, at, [])
const tool = (cwd: string, index?: ReportIndex, name = 'report') => createTools(async () => ({}) as Adapter, { rowLimit: 3, timeoutMs: 1000, report: { cwd, now: () => at, ...(index && { index }) } }).find((t) => t.name === name)!

describe('결과서 쓰기 — 새 위치 + 색인', () => {
  it('.litecode/plugins/sql-tuning/reports/<시각>/ 에 index.html · meta.json 을 쓰고 reports 문서(요약 + legacy:false + hasMeta)를 쓴다', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    const file = await writeReport(cwd, '<html></html>', at, (id) => metaOf(id), index)
    expect(file).toBe(`${PLUGIN_DIR}/reports/20261109-143205/index.html`)
    expect(existsSync(path.join(cwd, PLUGIN_DIR, 'reports/20261109-143205/meta.json'))).toBe(true)
    expect(existsSync(path.join(cwd, 'sql-tuning-reports'))).toBe(false) // 옛 위치에는 쓰지 않는다
    const [row] = await rows()
    expect(row!.id).toBe('20261109-143205')
    expect(row!.doc).toMatchObject({ v: 1, verdict: 'ok', target: win.target, legacy: false, hasMeta: true, compare: { sets: win.compare.length } })
    expect(JSON.stringify(row!.doc).length).toBeLessThan(256 * 1024)
    expect(JSON.stringify(row!.doc)).not.toContain('original_sql')
  })

  it('DB 가 없으면(undefined) 파일만 쓰고 오류 없이 끝난다 · 색인 쓰기가 실패해도 결과서는 남는다', async () => {
    const cwd = temp()
    const none = await tool(cwd, undefined).run(win as never)
    expect(none.isError).toBeUndefined()
    const broken: ReportIndex = { set: async () => Promise.reject(new Error('unreachable')), delete: async () => Promise.reject(new Error('unreachable')) }
    const other = temp()
    const made = await tool(other, broken).run(win as never)
    expect(made.isError).toBeUndefined()
    expect(existsSync(path.join(other, PLUGIN_DIR, 'reports/20261109-143205/meta.json'))).toBe(true)
  })

  it('같은 초에 둘이면 -2 를 붙이고 문서도 각자 id 로 쓴다', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    await writeReport(cwd, 'a', at, (id) => metaOf(id), index)
    await writeReport(cwd, 'b', at, (id) => metaOf(id), index)
    expect((await rows()).map((row) => row.id)).toEqual(['20261109-143205', '20261109-143205-2'])
  })

  it('.litecode 나 plugins 가 프로젝트 밖을 가리키면 폴더를 만들기 전에 거절하고 밖에는 아무것도 쓰지 않는다', async () => {
    const outside = temp()
    const viaLitecode = temp()
    symlinkSync(outside, path.join(viaLitecode, '.litecode'))
    await expect(writeReport(viaLitecode, 'x', at)).rejects.toThrow('resolves outside')
    const viaReports = temp()
    mkdirSync(path.join(viaReports, PLUGIN_DIR), { recursive: true })
    symlinkSync(outside, path.join(viaReports, PLUGIN_DIR, 'reports'))
    await expect(writeReport(viaReports, 'x', at)).rejects.toThrow('resolves outside')
    expect(existsSync(path.join(outside, 'plugins'))).toBe(false)
    expect(existsSync(path.join(outside, '20261109-143205'))).toBe(false)
  })

  it('report 도구는 색인을 쓰고 안내 경로는 새 위치다', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    const result = await tool(cwd, index).run(win as never)
    expect(result.text).toContain(`Report written: ${PLUGIN_DIR}/reports/20261109-143205/index.html`)
    expect(result.text).toContain(`\`${PLUGIN_DIR}/\` is not in .gitignore`)
    expect(await rows()).toHaveLength(1)
  })
})

describe('결과서 삭제 — 새 · 옛 위치 + 색인', () => {
  it('새 위치의 결과서는 폴더와 색인 줄을 같이 지우고 다른 결과서는 남긴다', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    await writeReport(cwd, 'a', at, (id) => metaOf(id), index)
    await writeReport(cwd, 'b', new Date(2026, 10, 10, 9, 3, 33), (id) => metaOf(id), index)
    expect(await removeReport(cwd, '20261109-143205', index)).toEqual(expect.arrayContaining(['index.html', 'meta.json']))
    expect(existsSync(path.join(cwd, PLUGIN_DIR, 'reports/20261109-143205'))).toBe(false)
    expect(existsSync(path.join(cwd, PLUGIN_DIR, 'reports/20261110-090333'))).toBe(true)
    expect((await rows()).map((row) => row.id)).toEqual(['20261110-090333'])
  })

  it('옛 위치(sql-tuning-reports)의 결과서도 지운다 — 색인 줄 포함', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    mkdirSync(path.join(cwd, 'sql-tuning-reports/20261101-101010'), { recursive: true })
    writeFileSync(path.join(cwd, 'sql-tuning-reports/20261101-101010/index.html'), 'old')
    await index.set(REPORTS_COLLECTION, '20261101-101010', { legacy: true, hasMeta: false })
    expect(await removeReport(cwd, '20261101-101010', index)).toEqual(['index.html'])
    expect(existsSync(path.join(cwd, 'sql-tuning-reports/20261101-101010'))).toBe(false)
    expect(await rows()).toEqual([])
  })

  it('옛 위치 폴더가 링크로 프로젝트 밖이면 · 새 위치가 플러그인 폴더 밖이면 지우지 않는다', async () => {
    const outside = temp()
    mkdirSync(path.join(outside, '20261101-101010'))
    writeFileSync(path.join(outside, '20261101-101010/keep.txt'), 'x')
    const oldLink = temp()
    symlinkSync(outside, path.join(oldLink, 'sql-tuning-reports'))
    await expect(removeReport(oldLink, '20261101-101010')).rejects.toThrow(/^unsafe/)
    const newLink = temp()
    mkdirSync(path.join(newLink, PLUGIN_DIR), { recursive: true })
    symlinkSync(outside, path.join(newLink, PLUGIN_DIR, 'reports'))
    await expect(removeReport(newLink, '20261101-101010')).rejects.toThrow(/^unsafe/)
    expect(readFileSync(path.join(outside, '20261101-101010/keep.txt'), 'utf8')).toBe('x')
  })

  it('delete_report 도구 — 없는 결과서는 not-found 로 알리고 남은 색인 줄은 정리한다', async () => {
    const cwd = temp()
    const { index, rows } = fakeIndex()
    await index.set(REPORTS_COLLECTION, '20261101-101010', { legacy: false, hasMeta: false })
    const result = await tool(cwd, index, 'delete_report').run({ id: '20261101-101010' })
    expect(result).toMatchObject({ isError: true })
    expect(result.text).toMatch(/^not-found/)
    expect(await rows()).toEqual([])
    expect((await tool(cwd, index, 'delete_report').run({ id: '../x' })).text).toMatch(/^bad-id/)
  })
})
