import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../server/config.ts'
import { driverFor, type BrowserLike } from '../server/driver.ts'
import { fingerprint } from '../server/scenario.ts'
import { Workspace } from '../server/runner.ts'
import type { PageLike } from '../server/steps.ts'
import { createTools } from '../server/tools.ts'
import { fakeDb } from './store-helper.ts'

// PDF 내보내기 — 서버의 pdf 도구(결과서 · 가이드 HTML → 같은 폴더의 PDF). 진짜 브라우저 대신 page.pdf 를 흉내 낸다(실제 Chrome 으로 찍은 것은 PR 에 적는다)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
type PrintLog = { url: string; media?: unknown; pdf?: { path: string; format: string; printBackground: boolean } }

let dir: string
let root: string
let prints: PrintLog[]
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-pdf-')))
  root = path.join(dir, 'proj')
  prints = []
  await fs.mkdir(path.join(root, '.litecode/plugins/ui-test/scenarios'), { recursive: true })
  for (const id of ['a-01', 'a-02']) {
    const md = `---\nname: 시나리오 ${id}\n---\n1. 연다\n`
    await fs.writeFile(path.join(root, '.litecode/plugins/ui-test/scenarios', `${id}.md`), md)
    await fs.writeFile(path.join(root, '.litecode/plugins/ui-test/scenarios', `${id}.spec.mjs`), `// ui-test source: .litecode/plugins/ui-test/scenarios/${id}.md · fingerprint: ${fingerprint(md)}\nexport default async ({ step, page }) => {\n  await step('1. 연다', async () => page.goto('/x'))\n}\n`)
  }
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** page.goto · emulateMedia · pdf 까지 흉내 내는 가짜 브라우저 — pdf 는 path 에 글을 쓴다 */
function launch(options: { failPdf?: boolean } = {}): () => Promise<BrowserLike> {
  return async () => ({
    newContext: async () => ({
      newPage: async () => {
        const log: PrintLog = { url: '' }
        prints.push(log)
        const page = {
          screenshot: async () => JPEG,
          url: () => 'http://a/x',
          title: async () => '',
          goto: async (url: string) => ((log.url = url), null),
          emulateMedia: async (arg: unknown) => void (log.media = arg),
          pdf: async (arg: { path: string; format: string; printBackground: boolean }) => {
            if (options.failPdf) throw new Error('인쇄 실패')
            log.pdf = arg
            await fs.writeFile(arg.path, '%PDF-1.4 fake')
          },
        }
        return page as unknown as PageLike
      },
      close: async () => undefined,
    }),
    close: async () => undefined,
  })
}

function open(options?: { failPdf?: boolean }, db = fakeDb().db) {
  const config = configFromEnv({ UI_TEST_BASE_URL: 'http://a', UI_TEST_DATA_DIR: path.join(dir, 'data') }, root)
  const space = new Workspace(config, launch(options), db)
  const tools = createTools({ workspace: space, checkDriver: () => driverFor('web', { channel: 'chrome' }), serverFile: '/p/ui-test.mjs' })
  return { space, db, tool: (name: string) => tools.find((item) => item.name === name)! }
}

describe('pdf — 결과서 · 가이드를 PDF 로', () => {
  it('결과서는 시나리오 폴더의 index.pdf, 프로젝트 기준 경로와 저장 이름을 돌려준다 — 인쇄 모양(print)으로 file:// 를 열어 쓴다', async () => {
    const { space, tool } = open()
    await space.reindex()
    const { run } = await space.run({})
    const out = await tool('pdf').run({ run: run.id, kind: 'report', scenario: 'a-02' })
    expect(out.isError).toBeUndefined()
    const made = JSON.parse(out.text)
    expect(made.path).toBe(`.litecode/plugins/ui-test/reports/${run.id}/a-02/index.pdf`)
    expect(made.name).toMatch(/^결과서 - .+\.pdf$/)
    expect(await fs.readFile(path.join(root, made.path), 'utf8')).toContain('%PDF')
    const log = prints.at(-1)!
    expect(log.url).toBe(`file://${path.join(root, '.litecode/plugins/ui-test/reports', run.id, 'a-02', 'index.html')}`)
    expect(log.media).toEqual({ media: 'print' })
    expect(log.pdf).toMatchObject({ format: 'A4', printBackground: true, path: path.join(root, made.path) })
  })

  it('가이드 · 여러 시나리오를 낸 수행은 scenario 가 필요, 시나리오 하나뿐이면 생략 가능', async () => {
    const { space, tool } = open()
    await space.reindex()
    const { run } = await space.run({})
    await space.writeGuide(run.id)
    expect(await tool('pdf').run({ run: run.id, kind: 'report' })).toMatchObject({ isError: true, text: expect.stringContaining('scenario 가 필요') })
    const made = JSON.parse((await tool('pdf').run({ run: run.id, kind: 'guide', scenario: 'a-02' })).text)
    expect(made).toEqual({ path: `.litecode/plugins/ui-test/reports/${run.id}/a-02/guide.pdf`, name: '화면 가이드 - 시나리오 a-02.pdf' })
    expect(existsSync(path.join(root, made.path))).toBe(true)
    // 시나리오 하나만 실행한 수행은 scenario 없이
    const single = (await space.run({ scenarios: ['a-01'] })).run
    expect(JSON.parse((await tool('pdf').run({ run: single.id, kind: 'report' })).text).path).toBe(`.litecode/plugins/ui-test/reports/${single.id}/a-01/index.pdf`)
  })

  it('틀린 입력 · 없는 파일 · 브라우저 실패는 오류 글로 — 가이드가 없으면 먼저 만들라고', async () => {
    const { space, tool, db } = open()
    await space.reindex()
    const { run } = await space.run({})
    expect(await tool('pdf').run({ run: run.id, kind: 'x' })).toMatchObject({ isError: true })
    expect(await tool('pdf').run({ run: '../x', kind: 'report' })).toMatchObject({ isError: true })
    expect(await tool('pdf').run({ run: '20200101T000000_01', kind: 'report' })).toMatchObject({ isError: true })
    expect(await tool('pdf').run({ run: run.id, kind: 'guide', scenario: 'a-01' })).toMatchObject({ isError: true, text: expect.stringContaining('가이드 파일이 없습니다') })
    const bad = open({ failPdf: true }, db)
    expect(await bad.tool('pdf').run({ run: run.id, kind: 'report', scenario: 'a-01' })).toMatchObject({ isError: true, text: expect.stringContaining('인쇄 실패') })
  })

  it('PDF 는 시나리오 결과서 폴더 안에 있어 그 시나리오를 지울 때 함께 지워진다', async () => {
    const { space, tool } = open()
    await space.reindex()
    const { run } = await space.run({})
    await space.writeGuide(run.id)
    const made = async (id: string, kind: 'report' | 'guide') => JSON.parse((await tool('pdf').run({ run: run.id, kind, scenario: id })).text).path as string
    const first = await made('a-01', 'report')
    const second = await made('a-02', 'guide')
    await space.remove({ scenarios: ['a-01'] })
    expect(existsSync(path.join(root, first))).toBe(false)
    expect(existsSync(path.join(root, second))).toBe(true) // 남은 시나리오 것은 그대로
    // 마지막 시나리오까지 지우면 수행 폴더째
    await space.remove({ scenarios: ['a-02'] })
    expect(existsSync(path.join(root, '.litecode/plugins/ui-test/reports', run.id))).toBe(false)
  })
})
