// 삭제 — 시나리오 하나(md + 코드 + suite.md 의 순서 · 규칙) 또는 묶음 전체. 결과서 · 이력은 건드리지 않는다.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFromEnv } from '../server/config.ts'
import { createTools } from '../server/tools.ts'
import { driverFor } from '../server/driver.ts'
import { dropScenarioFromSuite, removeScenario, removeSuite } from '../server/remove.ts'
import { Workspace } from '../server/runner.ts'

const SUITE = `---
name: 가입
created: 2026-11-06
---
## 시나리오 순서
1. 01-정상.md
2. 02-필수값.md
3. 03-나이.md

## 규칙
- [검증] 이름은 필수 — 02
- [업무] 가입 나이 15~70세 — 01, 03
- [업무] 특약 조합 — (없음)
`

describe('suite.md 에서 시나리오 빼기', () => {
  it('순서 목록의 그 줄을 빼고 번호를 다시 매긴다', () => {
    const out = dropScenarioFromSuite(SUITE, '02-필수값')
    expect(out).toContain('1. 01-정상.md\n2. 03-나이.md\n')
    expect(out).not.toContain('02-필수값.md')
  })

  it('규칙의 "다루는 시나리오" 에서도 빼고, 남는 게 없으면 (없음)', () => {
    const out = dropScenarioFromSuite(SUITE, '02-필수값')
    expect(out).toContain('- [검증] 이름은 필수 — (없음)')
    expect(out).toContain('- [업무] 가입 나이 15~70세 — 01, 03')
    const out2 = dropScenarioFromSuite(SUITE, '03-나이')
    expect(out2).toContain('- [업무] 가입 나이 15~70세 — 01\n')
    expect(out2).toContain('- [업무] 특약 조합 — (없음)')
  })

  it('이름이 부분만 닮은 줄은 건드리지 않고, 없는 시나리오면 그대로, CRLF 도 유지', () => {
    const nearly = SUITE.replace('3. 03-나이.md', '3. 103-나이.md')
    // 순서 목록은 파일 이름이 정확히 같을 때만 뺀다 (규칙의 번호 03 은 03-나이 를 가리키므로 같이 빠진다)
    expect(dropScenarioFromSuite(nearly, '03-나이')).toContain('3. 103-나이.md')
    expect(dropScenarioFromSuite(SUITE, '99-없음')).toBe(SUITE)
    expect(dropScenarioFromSuite(SUITE.replace(/\n/g, '\r\n'), '01-정상')).toContain('1. 02-필수값.md\r\n2. 03-나이.md\r\n')
  })
})

describe('파일 삭제', () => {
  let dir = ''
  let testDir = ''
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-remove-'))
    testDir = path.join(dir, 'ui-tests')
    const suite = path.join(testDir, 'join')
    await fs.mkdir(suite, { recursive: true })
    await fs.writeFile(path.join(suite, 'suite.md'), SUITE)
    for (const id of ['01-정상', '02-필수값', '03-나이']) {
      await fs.writeFile(path.join(suite, `${id}.md`), `---\nname: ${id}\n---\n1. 연다\n`)
      if (id !== '03-나이') await fs.writeFile(path.join(suite, `${id}.spec.mjs`), 'export default async () => {}\n')
    }
    await fs.mkdir(path.join(testDir, '_reports', 'join', '20261106-120000'), { recursive: true })
    await fs.writeFile(path.join(testDir, '_reports', 'join', '20261106-120000', 'index.html'), '<html></html>')
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })
  const names = async (...parts: string[]) => (await fs.readdir(path.join(testDir, ...parts))).sort()

  it('시나리오 하나 — md · 코드를 지우고 suite.md 를 고친다, 다른 것 · 결과서는 그대로', async () => {
    const done = await removeScenario(testDir, 'join', '02-필수값')
    expect(done.files).toEqual(['02-필수값.md', '02-필수값.spec.mjs'])
    expect(await names('join')).toEqual(['01-정상.md', '01-정상.spec.mjs', '03-나이.md', 'suite.md'])
    expect(await fs.readFile(path.join(testDir, 'join/suite.md'), 'utf8')).toContain('1. 01-정상.md\n2. 03-나이.md')
    expect(await names('_reports', 'join')).toEqual(['20261106-120000'])
  })

  it('코드가 없는 시나리오도 지운다 · 없는 시나리오 · 묶음은 거절', async () => {
    expect((await removeScenario(testDir, 'join', '03-나이')).files).toEqual(['03-나이.md'])
    await expect(removeScenario(testDir, 'join', '03-나이')).rejects.toThrow('시나리오가 없습니다')
    await expect(removeScenario(testDir, 'nope', '01-정상')).rejects.toThrow('묶음이 없습니다')
  })

  it('경로를 벗어나는 이름은 거절한다', async () => {
    for (const bad of ['../x', 'a/b', '.hidden', '_reports', '', 'suite']) {
      await expect(removeScenario(testDir, 'join', bad)).rejects.toThrow('이름이 틀렸습니다')
    }
    await expect(removeScenario(testDir, '../join', '01-정상')).rejects.toThrow('이름이 틀렸습니다')
    await expect(removeSuite(testDir, '_reports')).rejects.toThrow('이름이 틀렸습니다')
    expect(await names('join')).toHaveLength(6)
  })

  it('묶음 전체 — 이 플러그인 파일만 지우고 폴더가 비면 폴더도, 그 밖의 파일이 있으면 폴더를 남긴다', async () => {
    const first = await removeSuite(testDir, 'join')
    expect(first.leftover).toEqual([])
    expect(await names()).toEqual(['_reports'])
    // 다른 파일이 든 묶음
    const other = path.join(testDir, 'other')
    await fs.mkdir(other)
    await fs.writeFile(path.join(other, 'suite.md'), '---\nname: 다른\n---\n')
    await fs.writeFile(path.join(other, 'notes.txt'), '내 메모')
    const second = await removeSuite(testDir, 'other')
    expect(second).toEqual({ files: ['suite.md'], leftover: ['notes.txt'] })
    expect(await names('other')).toEqual(['notes.txt'])
    expect(await names('_reports', 'join')).toEqual(['20261106-120000'])
  })

  it('delete 도구 — 수행 중인 묶음은 거절, 아니면 지우고 알린다', async () => {
    const space = new Workspace(configFromEnv({ UI_TEST_BASE_URL: 'http://a', UI_TEST_DATA_DIR: path.join(dir, 'data') }, dir), async () => {
      throw new Error('launch')
    })
    const tool = createTools({ workspace: space, checkDriver: () => driverFor('web', { channel: 'chrome' }), serverFile: '/p/ui-test.mjs' }).find((item) => item.name === 'delete')!
    const one = await tool.run({ suite: 'join', scenario: '01-정상' })
    expect(one.isError).toBeUndefined()
    expect(one.text).toContain('시나리오 01-정상 삭제')
    expect(one.text).toContain('결과서 · 이력은 남깁니다')
    const missing = await tool.run({ suite: 'join', scenario: '01-정상' })
    expect(missing).toMatchObject({ isError: true })
    const all = await tool.run({ suite: 'join' })
    expect(all.text).toContain('묶음 join 삭제')
    expect(await tool.run({})).toMatchObject({ isError: true })
  })
})
