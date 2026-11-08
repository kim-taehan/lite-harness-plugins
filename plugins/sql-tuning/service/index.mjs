// SQL 튜닝 서비스 (0.10.0) — 앱 안에서 도는 얇은 코드. 하는 일 둘:
//  1. DB 를 읽는 MCP 서버(server/sql-tuning.mjs)를 앱에 등록한다 — 일은 별도 자식 프로세스가 한다(오래 걸리는 쿼리 · DB 비밀번호를 앱 프로세스 밖에 둔다).
//     DB 비밀번호는 서비스가 읽지 않는다: ${secret:password} 자리표시로 서버 프로세스의 환경 변수로만 간다.
//  2. 패널이 service.call 한 통로로 앱에 닿게 중계한다(표준 문서 읽기 · 쓰기 · 설정 요약 · 연결 확인 …) — 같은 이름 · 같은 권한 검사의 host.call.
//  3. 스킬(skills/sql-tuning — SKILL.md 와 references/)을 host.skills.register 로 올린다. 서비스가 올린 스킬은 skills.readFile 이 듣지 않으므로
//     패널이 읽는 "플러그인 기본 표준"(references/sql-standard.md)은 서비스가 자기 폴더(host.dir)에서 직접 읽어 준다.
// 번들(build.mjs 가 이 파일을 service.mjs 한 파일로 낸다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** 패널이 부르는 이름 → 앱 호출 표의 메서드. 권한은 manifest permissions(project · projectWrite)로 패널과 같게 검사된다 */
export const RELAY = {
  readFile: 'project.readFile',
  fileInfo: 'project.fileInfo',
  writeFile: 'project.writeFile',
  removeFile: 'project.removeFile',
  openFile: 'project.openFile',
  projectInfo: 'project.info',
  settingsSummary: 'settings.summary',
  settingsCheck: 'settings.check',
  settingsOpen: 'settings.open',
}

/** 플러그인 기본 표준 — zip 을 만들 때 --standard 로 넣거나 묶기 전에 그 자리에 둔 문서(없을 수 있다) */
export const BUNDLED_STANDARD = 'skills/sql-tuning/references/sql-standard.md'
const MAX_BYTES = 512 * 1024

export default (host) =>
  class SqlTuning extends host.Service {
    constructor(ctx) {
      super(ctx)
      // manifest 의 옛 mcp 선언과 같은 모양 — 값은 설정 칸(${storage:<키>})과 비밀 칸(${secret:password})을 앱이 채운다
      host.mcp.register({
        command: 'server/sql-tuning.mjs',
        env: {
          SQL_TUNING_DB: '${storage:db}',
          SQL_TUNING_HOST: '${storage:host}',
          SQL_TUNING_PORT: '${storage:port}',
          SQL_TUNING_SERVICE: '${storage:service}',
          SQL_TUNING_USER: '${storage:user}',
          SQL_TUNING_PASSWORD: '${secret:password}',
          SQL_TUNING_SCHEMA: '${storage:schema}',
          SQL_TUNING_POOL: '4',
        },
        idleMs: 600000,
      })

      host.skills.register({ name: 'sql-tuning', dir: 'skills/sql-tuning' })

      // service.call 은 실패하면 서비스가 던진 글을 패널에 주지 않고 service-failed 로만 알린다 — 패널이 오류 코드(path-unsafe · no-settings …)로
      // 안내를 고르므로 코드를 값에 실어 돌려준다: { ok: true, value } | { ok: false, code }
      for (const [name, method] of Object.entries(RELAY)) {
        this.expose(name, async (params, { directory }) => {
          try {
            return { ok: true, value: (await host.call(method, params, { directory })) ?? null }
          } catch (error) {
            return { ok: false, code: typeof error?.code === 'string' ? error.code : 'io-failed' }
          }
        })
      }

      // 스킬이 서비스가 올린 것이라 skills.readFile 로는 못 읽는다 — 자기 폴더의 파일을 직접 읽는다(skills.readFile 과 같은 { text } 모양)
      this.expose('bundledFile', async () => {
        try {
          const text = await readFile(path.join(host.dir, BUNDLED_STANDARD), 'utf8')
          return text.length > MAX_BYTES ? { ok: false, code: 'file-too-large' } : { ok: true, value: { text } }
        } catch {
          return { ok: false, code: 'io-failed' }
        }
      })
    }
  }
