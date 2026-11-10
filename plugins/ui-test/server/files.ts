// 앱 데이터 폴더의 파일 — 스크린샷(수행마다 폴더 하나). 기록 · 색인은 host.db(store.ts)다.
// 데이터 폴더는 플러그인 하나가 여러 프로젝트에 같이 쓰므로 프로젝트마다 하위 폴더를 따로 둔다.

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 수행 id — `20261110T110500_01` (store.ts timeId). 파일 경로에 쓰기 전에 모양을 본다 */
export const RUN_ID = /^\d{8}T\d{6}_\d{2,}$/
export const isRunId = (value: unknown): value is string => typeof value === 'string' && RUN_ID.test(value)

export class DataFiles {
  constructor(
    private readonly dataDir: string,
    private readonly project: string,
  ) {}

  private get root(): string {
    return path.join(this.dataDir, 'projects', createHash('sha256').update(this.project).digest('hex').slice(0, 16))
  }

  /** 수행 하나의 스크린샷 폴더 */
  shotsDir(runId: string): string {
    if (!isRunId(runId)) throw new Error(`수행 id 가 틀렸습니다: ${runId}`)
    return path.join(this.root, 'shots', runId)
  }

  /** 처음 한 번만 참 — .gitignore 제안을 한 번만 하게 */
  async firstTime(flag: string): Promise<boolean> {
    const file = path.join(this.root, 'flags.json')
    let flags: Record<string, boolean> = {}
    try {
      flags = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, boolean>
    } catch {
      // 없으면 처음
    }
    if (flags[flag]) return false
    await fs.mkdir(this.root, { recursive: true })
    await fs.writeFile(file, JSON.stringify({ ...flags, [flag]: true }))
    return true
  }
}
