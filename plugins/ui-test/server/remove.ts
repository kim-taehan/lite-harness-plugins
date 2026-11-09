// 삭제 — 시나리오 하나(md + 생성 코드) 또는 묶음 전체를 테스트 폴더에서 지운다. 패널의 [삭제](확인 뒤)가 부른다 — AI 에는 노출하지 않는 패널 전용 도구.
// 지우는 것은 테스트 폴더 안 묶음 폴더의 suite.md · 시나리오 .md · .spec.mjs 뿐이다. 결과서 · 수행 이력은 남긴다(지난 수행 기록이라).
// 시나리오를 지우면 suite.md 의 `## 시나리오 순서` 에서 빼고(번호는 다시 매긴다) `## 규칙` 의 "다루는 시나리오" 에서도 뺀다(남는 게 없으면 "(없음)").

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SPEC_SUFFIX = '.spec.mjs'

/** 묶음 · 시나리오 이름 — 경로 구분 · 점으로 시작 · 밖으로 나가는 것은 거절 */
function safeName(value: string, label: string): string {
  if (!value || /[\\/]/.test(value) || value.startsWith('.') || value.startsWith('_') || value === 'suite') throw new Error(`${label} 이름이 틀렸습니다: ${value}`)
  return value
}

/** suite.md 에서 시나리오 하나를 뺀다 — 순서 목록의 그 줄(번호는 1 부터 다시), 규칙 줄의 그 시나리오 번호/이름 */
export function dropScenarioFromSuite(source: string, scenarioId: string): string {
  const file = `${scenarioId}.md`
  const number = scenarioId.split('-')[0]!
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let section: 'order' | 'rules' | '' = ''
  let n = 0
  const out: string[] = []
  for (const line of source.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      section = /시나리오\s*순서/.test(line) ? 'order' : /^##\s*규칙\s*$/.test(line.trim()) ? 'rules' : ''
      n = 0
      out.push(line)
      continue
    }
    if (section === 'order' && /^\s*(\d+[.)]|[-*])\s/.test(line)) {
      // parseSuite 와 같은 방식으로 파일 이름을 읽어 정확히 같은 때만 뺀다(1-a.md 가 11-a.md 를 지우지 않게)
      if (/([^\s`*()[\]]+\.md)\b/.exec(line)?.[1] === file) continue
      const numbered = /^(\s*)\d+([.)])(\s.*)$/.exec(line)
      out.push(numbered ? `${numbered[1]}${++n}${numbered[2]}${numbered[3]}` : line)
      continue
    }
    if (section === 'rules' && /^\s*[-*]\s*\[\s*(검증|업무)/.test(line)) {
      // `- [검증] 이름은 필수 — 02, 03` — 첫 구분(—)까지가 규칙 글, 그 뒤가 다루는 시나리오
      const match = /^(.*?\s+(?:—|–|->|→)\s+)(.*)$/.exec(line)
      if (match) {
        const covers = match[2]!.split(/[,\s·]+/).map((item) => item.replace(/\.md$/, '').trim()).filter((item) => item && !/^\(?없음\)?$/.test(item))
        const kept = covers.filter((item) => item !== scenarioId && item !== number)
        if (kept.length !== covers.length) {
          out.push(`${match[1]}${kept.length ? kept.join(', ') : '(없음)'}`)
          continue
        }
      }
    }
    out.push(line)
  }
  return out.join(eol)
}

export interface Removed {
  /** 지운 파일 — 프로젝트 기준이 아니라 묶음 폴더 기준 이름 */
  files: string[]
  /** 묶음 삭제에서 폴더에 남은, 이 플러그인 것이 아닌 파일 */
  leftover: string[]
}

/** 시나리오 하나 — md 와 생성 코드를 지우고 suite.md 를 고친다 */
export async function removeScenario(testDir: string, suiteId: string, scenarioId: string): Promise<Removed> {
  safeName(suiteId, '묶음')
  safeName(scenarioId, '시나리오')
  const dir = path.join(testDir, suiteId)
  const md = path.join(dir, `${scenarioId}.md`)
  if (!existsSync(path.join(dir, 'suite.md'))) throw new Error(`묶음이 없습니다: ${suiteId}`)
  if (!existsSync(md)) throw new Error(`시나리오가 없습니다: ${scenarioId}`)
  const files: string[] = []
  for (const file of [md, path.join(dir, scenarioId + SPEC_SUFFIX)]) {
    if (!existsSync(file)) continue
    await fs.rm(file)
    files.push(path.basename(file))
  }
  const suiteFile = path.join(dir, 'suite.md')
  const before = await fs.readFile(suiteFile, 'utf8')
  const after = dropScenarioFromSuite(before, scenarioId)
  if (after !== before) await fs.writeFile(suiteFile, after)
  return { files, leftover: [] }
}

/** 묶음 전체 — suite.md · 시나리오 .md · .spec.mjs 를 지우고, 그 밖의 파일이 없으면 폴더도 지운다 */
export async function removeSuite(testDir: string, suiteId: string): Promise<Removed> {
  safeName(suiteId, '묶음')
  const dir = path.join(testDir, suiteId)
  if (!existsSync(path.join(dir, 'suite.md'))) throw new Error(`묶음이 없습니다: ${suiteId}`)
  const files: string[] = []
  for (const name of await fs.readdir(dir)) {
    if (name === 'suite.md' || name.endsWith('.md') || name.endsWith(SPEC_SUFFIX)) {
      await fs.rm(path.join(dir, name), { force: true })
      files.push(name)
    }
  }
  const leftover = await fs.readdir(dir)
  if (leftover.length === 0) await fs.rmdir(dir)
  return { files, leftover }
}
