// 삭제 — 시나리오 파일(md + 생성 코드)을 테스트 폴더에서 지운다. 패널의 [삭제](확인 뒤)가 부른다 — AI 에는 노출하지 않는 패널 전용 도구.
// 여기서는 파일만 지운다. 저장소 줄 · 결과 · 스크린샷 · 결과서 정리는 runner.ts 가 이어서 한다.

import fs from 'node:fs/promises'
import path from 'node:path'

export const SPEC_SUFFIX = '.spec.mjs'

/** 시나리오 md 의 프로젝트 기준 경로 → 같은 이름의 생성 코드 경로 */
export const specOf = (file: string): string => file.replace(/\.md$/, SPEC_SUFFIX)

export interface Removed {
  /** 지운 파일 — 프로젝트 기준 경로 */
  files: string[]
}

/** 시나리오 하나의 md 와 생성 코드를 지운다 — 테스트 폴더 안의 `.md` 만(밖으로 나가는 경로 · 결과서 폴더는 거절). 이미 없는 파일은 건너뛴다.
 *  지운 뒤 비게 된 하위 폴더도 치운다(테스트 폴더 자신은 남긴다) */
export async function removeScenarioFiles(project: string, testDir: string, file: string): Promise<Removed> {
  const md = path.resolve(project, file)
  const inside = path.relative(testDir, md)
  const parts = inside.split(path.sep)
  if (!md.endsWith('.md') || inside.startsWith('..') || path.isAbsolute(inside) || (parts.length > 1 && /^[_.]/.test(parts[0]!))) throw new Error(`시나리오 파일이 테스트 폴더 밖입니다: ${file}`)
  const files: string[] = []
  for (const target of [md, specOf(md)]) {
    const existed = await fs.stat(target).then(() => true, () => false)
    if (!existed) continue
    await fs.rm(target, { force: true })
    files.push(path.relative(project, target).split(path.sep).join('/'))
  }
  // 비게 된 하위 폴더 (한 단계 위까지)
  for (let dir = path.dirname(md); dir !== testDir && dir.startsWith(testDir + path.sep); dir = path.dirname(dir)) {
    const rest = await fs.readdir(dir).catch(() => undefined)
    if (rest === undefined || rest.length > 0) break
    await fs.rmdir(dir).catch(() => undefined)
  }
  return { files }
}
