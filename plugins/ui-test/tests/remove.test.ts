// 삭제 — 시나리오 파일(md + 생성 코드)을 테스트 폴더에서 지운다. 기록 · 스크린샷 · 결과서 정리(그룹 삭제 · 걸친 시나리오 · reindex 와의 연동)는 workspace.test.ts 가 본다.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeScenarioFiles, specOf } from '../server/remove.ts'

describe('시나리오 파일 삭제', () => {
  let project = ''
  let testDir = ''
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-remove-'))
    testDir = path.join(project, 'ui-tests')
    await fs.mkdir(path.join(testDir, 'join'), { recursive: true })
    await fs.mkdir(path.join(testDir, '_reports', '20261106T120000_01'), { recursive: true })
    await fs.writeFile(path.join(testDir, '_reports', '20261106T120000_01', 'index.html'), '<html></html>')
    for (const rel of ['q-01', 'q-02', 'join/01-정상', 'join/02-필수값']) {
      await fs.writeFile(path.join(testDir, `${rel}.md`), `---\nname: ${rel}\n---\n1. 연다\n`)
      if (rel !== 'q-02') await fs.writeFile(path.join(testDir, `${rel}.spec.mjs`), 'export default async () => {}\n')
    }
  })
  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true })
  })
  const names = async (...parts: string[]) => (await fs.readdir(path.join(testDir, ...parts))).sort()

  it('같은 이름의 md · 생성 코드를 지우고 프로젝트 기준 경로를 돌려준다 — 다른 시나리오 · 결과서는 그대로', async () => {
    expect(await removeScenarioFiles(project, testDir, 'ui-tests/q-01.md')).toEqual({ files: ['ui-tests/q-01.md', 'ui-tests/q-01.spec.mjs'] })
    expect(await names()).toEqual(['_reports', 'join', 'q-02.md'])
    expect(await names('_reports', '20261106T120000_01')).toEqual(['index.html'])
  })

  it('코드가 없는 시나리오도 지우고, 이미 없는 파일은 건너뛴다', async () => {
    expect((await removeScenarioFiles(project, testDir, 'ui-tests/q-02.md')).files).toEqual(['ui-tests/q-02.md'])
    expect((await removeScenarioFiles(project, testDir, 'ui-tests/q-02.md')).files).toEqual([])
  })

  it('하위 폴더는 뜻 없는 폴더 — 비면 같이 치우고, 다른 파일이 있으면 남긴다(테스트 폴더 자신은 남긴다)', async () => {
    await removeScenarioFiles(project, testDir, 'ui-tests/join/01-정상.md')
    expect(await names('join')).toEqual(['02-필수값.md', '02-필수값.spec.mjs'])
    await fs.writeFile(path.join(testDir, 'join', 'notes.txt'), '내 메모')
    await removeScenarioFiles(project, testDir, 'ui-tests/join/02-필수값.md')
    expect(await names('join')).toEqual(['notes.txt'])
    await fs.rm(path.join(testDir, 'join', 'notes.txt'))
    await fs.writeFile(path.join(testDir, 'join', 'x.md'), '1. x\n')
    await removeScenarioFiles(project, testDir, 'ui-tests/join/x.md')
    expect(await names()).toEqual(['_reports', 'q-01.md', 'q-01.spec.mjs', 'q-02.md'])
  })

  it('테스트 폴더 밖 · 결과서 폴더 · md 가 아닌 것은 거절한다', async () => {
    for (const bad of ['../x.md', 'ui-tests/../../x.md', 'ui-tests/_reports/20261106T120000_01/index.html', 'ui-tests/_reports/a.md', 'ui-tests/q-01.spec.mjs', '/etc/passwd.md']) {
      await expect(removeScenarioFiles(project, testDir, bad), bad).rejects.toThrow('테스트 폴더 밖')
    }
    expect(await names('join')).toHaveLength(4)
  })

  it('생성 코드 위치는 md 와 같은 이름', () => {
    expect(specOf('ui-tests/a/01-x.md')).toBe('ui-tests/a/01-x.spec.mjs')
  })
})
