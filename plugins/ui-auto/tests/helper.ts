// 시험용 프로젝트 — tests/fixtures/evidence(opencode 하네스가 실제로 남긴 증적 3회 수행분, 주소 · 제품명만 바꿈)를 임시 프로젝트의 .litecode/ui-auto/ 로 복사한다
import { cpSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configFromEnv, type Config } from '../server/config.ts'

export const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/evidence')
export const PLUGIN = path.resolve(import.meta.dirname, '..')

export function project(withEvidence = true, env: NodeJS.ProcessEnv = {}): Config {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ui-auto-')))
  if (withEvidence) cpSync(FIXTURE, path.join(dir, '.litecode/ui-auto'), { recursive: true })
  return configFromEnv({ UI_AUTO_BASE_URL: 'https://portal.example.test/', UI_AUTO_STATE_DIR: path.join(dir, 'state'), ...env }, dir, PLUGIN)
}
