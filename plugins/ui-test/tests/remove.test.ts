// 삭제 — 시나리오 파일(md + 생성 코드)을 시나리오 폴더(.litecode/plugins/ui-test/scenarios)에서 지운다. 기록 · 스크린샷 · 결과서 정리(그룹 삭제 · 걸친 시나리오 · reindex 와의 연동)는 workspace.test.ts 가 본다.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeScenarioFiles, specOf } from '../server/remove.ts'

describe('시나리오 파일 삭제', () => {
  let project = ''
  let scenarioDir = ''
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-remove-'))
    scenarioDir = path.join(project, '.litecode/plugins/ui-test/scenarios')
    await fs.mkdir(path.join(scenarioDir, 'join'), { recursive: true })
    await fs.mkdir(path.join(project, '.litecode/plugins/ui-test/reports', '20261106T120000_01'), { recursive: true })
    await fs.writeFile(path.join(project, '.litecode/plugins/ui-test/reports', '20261106T120000_01', 'index.html'), '<html></html>')
    for (const rel of ['q-01', 'q-02', 'join/01-정상', 'join/02-필수값']) {
      await fs.writeFile(path.join(scenarioDir, `${rel}.md`), `---\nname: ${rel}\n---\n1. 연다\n`)
      if (rel !== 'q-02') await fs.writeFile(path.join(scenarioDir, `${rel}.spec.mjs`), 'export default async () => {}\n')
    }
  })
  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true })
  })
  const names = async (...parts: string[]) => (await fs.readdir(path.join(scenarioDir, ...parts))).sort()

  it('같은 이름의 md · 생성 코드를 지우고 프로젝트 기준 경로를 돌려준다 — 다른 시나리오 · 결과서는 그대로', async () => {
    expect(await removeScenarioFiles(project, scenarioDir, '.litecode/plugins/ui-test/scenarios/q-01.md')).toEqual({ files: ['.litecode/plugins/ui-test/scenarios/q-01.md', '.litecode/plugins/ui-test/scenarios/q-01.spec.mjs'] })
    expect(await names()).toEqual(['join', 'q-02.md'])
    expect(await fs.readdir(path.join(project, '.litecode/plugins/ui-test/reports/20261106T120000_01'))).toEqual(['index.html'])
  })

  it('코드가 없는 시나리오도 지우고, 이미 없는 파일은 건너뛴다', async () => {
    expect((await removeScenarioFiles(project, scenarioDir, '.litecode/plugins/ui-test/scenarios/q-02.md')).files).toEqual(['.litecode/plugins/ui-test/scenarios/q-02.md'])
    expect((await removeScenarioFiles(project, scenarioDir, '.litecode/plugins/ui-test/scenarios/q-02.md')).files).toEqual([])
  })

  it('하위 폴더의 파일은 거절한다 — 새 시나리오는 하위 폴더 없이 바로 아래에 둔다', async () => {
    await expect(removeScenarioFiles(project, scenarioDir, '.litecode/plugins/ui-test/scenarios/join/01-정상.md')).rejects.toThrow('시나리오 폴더 밖')
    expect(await names('join')).toHaveLength(4)
  })

  it('시나리오 폴더 밖 · 결과서 폴더 · md 가 아닌 것 · _ 로 시작하는 이름은 거절한다', async () => {
    await fs.writeFile(path.join(scenarioDir, '_prompt.md'), 'x')
    for (const bad of ['../x.md', '.litecode/plugins/ui-test/scenarios/../../x.md', '.litecode/plugins/ui-test/reports/20261106T120000_01/index.html', '.litecode/plugins/ui-test/reports/a.md', '.litecode/plugins/ui-test/scenarios/q-01.spec.mjs', '.litecode/plugins/ui-test/scenarios/_prompt.md', '/etc/passwd.md']) {
      await expect(removeScenarioFiles(project, scenarioDir, bad), bad).rejects.toThrow('시나리오 폴더 밖')
    }
    expect(await names('join')).toHaveLength(4)
  })

  it('플러그인 폴더가 밖을 가리키는 심볼릭 링크면 지우지 않고 거절한다', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-test-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'x.md'), '1. x\n')
      await fs.rm(path.join(project, '.litecode/plugins/ui-test'), { recursive: true })
      await fs.mkdir(path.join(project, '.litecode/plugins'), { recursive: true })
      await fs.symlink(outside, path.join(project, '.litecode/plugins/ui-test'))
      await expect(removeScenarioFiles(project, scenarioDir, '.litecode/plugins/ui-test/scenarios/x.md')).rejects.toThrow('플러그인 폴더')
      expect(await fs.readdir(outside)).toEqual(['x.md'])
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('생성 코드 위치는 md 와 같은 이름', () => {
    expect(specOf('.litecode/plugins/ui-test/scenarios/01-x.md')).toBe('.litecode/plugins/ui-test/scenarios/01-x.spec.mjs')
  })
})
