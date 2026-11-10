// 삭제 — 시나리오 파일(md + 생성 코드 + 수행 기록)을 시나리오 폴더에서 지운다. 패널의 [삭제](확인 뒤)가 부른다 — AI 에는 노출하지 않는 패널 전용 도구.
// 여기서는 파일만 지운다. 저장소 줄 · 결과 · 스크린샷 · 결과서 정리는 runner.ts 가 이어서 한다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { guardPluginPath } from './config.ts'

export const SPEC_SUFFIX = '.spec.mjs'
/** 시나리오마다 두는 수행 기록 — 시나리오 옆 `<id>.history.md`. AI 가 쓰고 서버는 지우기만 한다(시나리오가 아니라서 훑을 때 건너뛴다) */
export const HISTORY_SUFFIX = '.history.md'

/** 시나리오 md 의 프로젝트 기준 경로 → 같은 이름의 생성 코드 경로 */
export const specOf = (file: string): string => file.replace(/\.md$/, SPEC_SUFFIX)
/** 시나리오 md 의 경로 → 같은 이름의 수행 기록 경로 */
export const historyOf = (file: string): string => file.replace(/\.md$/, HISTORY_SUFFIX)

export interface Removed {
  /** 지운 파일 — 프로젝트 기준 경로 */
  files: string[]
}

/** 시나리오 하나의 md · 생성 코드 · 수행 기록을 지운다 — 시나리오 폴더 바로 아래의 `.md` 만(밖으로 나가는 경로 · 하위 폴더 · `_` `.` 로 시작하는 이름은 거절, 실제 경로가 플러그인 폴더 밖이어도 거절). 이미 없는 파일은 건너뛴다 */
export async function removeScenarioFiles(project: string, scenarioDir: string, file: string): Promise<Removed> {
  const md = path.resolve(project, file)
  if (!md.endsWith('.md') || md.endsWith(HISTORY_SUFFIX) || path.dirname(md) !== scenarioDir || /^[_.]/.test(path.basename(md))) throw new Error(`시나리오 파일이 시나리오 폴더 밖입니다: ${file}`)
  await guardPluginPath(project, md)
  const files: string[] = []
  for (const target of [md, specOf(md), historyOf(md)]) {
    const existed = await fs.stat(target).then(() => true, () => false)
    if (!existed) continue
    await fs.rm(target, { force: true })
    files.push(path.relative(project, target).split(path.sep).join('/'))
  }
  return { files }
}
