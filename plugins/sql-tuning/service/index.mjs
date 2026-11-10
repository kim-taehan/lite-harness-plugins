// SQL 튜닝 서비스 (0.14.0) — 앱 안에서 도는 얇은 코드. 하는 일 셋:
//  1. DB 를 읽는 MCP 서버(server/sql-tuning.mjs)를 앱에 등록한다 — 일은 별도 자식 프로세스가 한다(오래 걸리는 쿼리 · DB 비밀번호를 앱 프로세스 밖에 둔다).
//     DB 비밀번호는 서비스가 읽지 않는다: ${secret:password} 자리표시로 서버 프로세스의 환경 변수로만 간다.
//  2. 패널이 service.call 한 통로로 앱에 닿게 중계한다(표준 문서 읽기 · 쓰기 · 설정 요약 · 연결 확인 …) — 같은 이름 · 같은 권한 검사의 host.call.
//  4. 결과서 목록 색인(host.db 의 reports) — 파일(결과서 폴더의 meta.json)이 정본이고 색인은 다시 만들 수 있다. 패널이 열릴 때 · project.filesChanged 중 결과서 폴더
//     (새 .litecode/plugins/sql-tuning/reports · 옛 sql-tuning-reports)의 소식이 올 때 두 폴더를 훑어 색인을 맞추고(reindex), 패널에 `reports` 소식을 전달한다 — 튜닝 이력 목록이 저절로 갱신되게.
//     패널은 `reports` 로 색인을 읽는다(서비스 전용 host.db 를 패널이 직접 못 쓰므로).
//  3. 스킬(skills/sql-tuning — SKILL.md 와 references/)을 host.skills.register 로 올린다. 패널이 읽는 "플러그인 기본 표준"(references/sql-standard.md)은
//     host.skills.readFile 로 읽어 준다(사용자가 얹은 글이 먼저, 없으면 스킬 폴더에 든 원래 파일).
// 번들(build.mjs 가 이 파일을 service.mjs 한 파일로 낸다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다.

/** 패널이 부르는 이름 → 앱 호출 표의 메서드. 권한은 manifest permissions(project · projectWrite)로 패널과 같게 검사된다 */
export const RELAY = {
  listDir: 'project.listDir',
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

/** 플러그인 기본 표준 — 스킬 폴더 안 경로. zip 을 만들 때 --standard 로 넣거나 묶기 전에 그 자리에 둔 문서(없을 수 있다) */
export const BUNDLED_STANDARD = 'references/sql-standard.md'

/** 프로젝트 안에 남기는 파일의 폴더(프로젝트 기준) — server/report.ts 의 PLUGIN_DIR 와 같다 */
export const PLUGIN_DIR = '.litecode/plugins/sql-tuning'
/** 새 결과서가 쌓이는 폴더 — server/report.ts 의 REPORT_DIR 와 같다 */
export const REPORTS_FOLDER = `${PLUGIN_DIR}/reports`
/** 0.13 까지 결과서를 쓰던 옛 폴더 — 읽기 · 삭제만 한다. server/report.ts 의 LEGACY_REPORT_DIR 와 같다 */
export const LEGACY_REPORTS_FOLDER = 'sql-tuning-reports'
/** 목록 색인 컬렉션 — id 는 결과서 폴더 이름(시각이라 id 순 list 가 시간순) */
export const REPORTS_COLLECTION = 'reports'

const FOLDER_NAME = /^\d{8}-\d{6}(-\d+)?$/
const LIST_PAGE = 200 // host.db list 한 번 최대
const MAX_PAGES = 50 // 색인 읽기 상한(1만 건) — 넘으면 앞쪽(오래된 것)만 본다
const READ_BATCH = 10 // meta.json 을 한 번에 이만큼씩 읽고 사이에 앱에 숨 돌릴 틈을 준다
const MAX_READ = 100 // 한 번의 reindex 가 읽는 meta.json 상한 — 최신부터, 나머지는 다음 차례
const DB_BATCH = 50 // host.db batch 한 번 최대 연산

/** meta.json 이 목록에 쓸 만한 모양인지 — index.html 패널의 parseMeta 와 같은 기준 */
function metaOf(text) {
  if (typeof text !== 'string' || text.length > 200 * 1024) return undefined
  try {
    const meta = JSON.parse(text)
    if (meta?.v !== 1 || (meta.verdict !== 'ok' && meta.verdict !== 'hold') || typeof meta.target !== 'string' || !(Date.parse(meta.at) > 0)) return undefined
    return meta
  } catch {
    return undefined
  }
}

const codeOf = (error) => (typeof error?.code === 'string' ? error.code : 'io-failed')

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
        // 패널만 부르는 도구 — AI 의 도구 목록에는 보이지 않는다(결과서 삭제는 사용자가 패널에서 확인한 뒤에만)
        panelTools: ['delete_report'],
      })

      host.skills.register({ name: 'sql-tuning', dir: 'skills/sql-tuning' })

      // 한 프로젝트에서 reindex 는 한 번에 하나 — 겹치면 아직 시작 안 한 다음 한 번에 합쳐진다(소식이 몰려도 훑기는 한 번씩)
      const flights = new Map()
      const reindexed = (directory) => {
        const flight = flights.get(directory) ?? flights.set(directory, { tail: Promise.resolve() }).get(directory)
        if (flight.waiting) return flight.waiting
        const turn = flight.tail.catch(() => undefined).then(() => ((flight.waiting = undefined), reindex(directory)))
        flight.waiting = turn
        flight.tail = turn
        return turn
      }

      /** 두 결과서 폴더를 훑어 색인(reports)을 맞춘다 — 없는 줄 추가(meta.json 을 읽어서) · 사라진 폴더의 줄 삭제 · 같은 것은 쓰기 0번. 목록 전체와 잘렸는지를 돌려준다 */
      const reindex = async (directory) => {
        const at = { directory }
        const existing = await listIndex(at)
        const rows = new Map(existing.map(({ id, doc }) => [id, doc]))
        const found = new Map() // id → legacy
        const complete = { false: false, true: false } // 그 위치를 끝까지 읽었나 — 못 읽었거나 잘렸으면 그쪽 색인 줄은 지우지 않는다
        let truncated = false
        for (const legacy of [true, false]) {
          // 새 위치가 나중이라 같은 이름이면 새 위치가 이긴다
          const listing = await listFolder(legacy ? LEGACY_REPORTS_FOLDER : REPORTS_FOLDER, directory)
          if (!listing) continue
          for (const name of listing.names) found.set(name, legacy)
          complete[legacy] = !listing.truncated
          truncated ||= listing.truncated
        }
        const todo = [...found].filter(([id, legacy]) => rows.get(id)?.legacy !== legacy || rows.get(id)?.hasMeta !== true).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, MAX_READ)
        const writes = []
        for (let from = 0; from < todo.length; from += READ_BATCH) {
          const part = await Promise.all(
            todo.slice(from, from + READ_BATCH).map(async ([id, legacy]) => {
              const folder = legacy ? LEGACY_REPORTS_FOLDER : REPORTS_FOLDER
              const text = await host.call('project.readFile', { path: `${folder}/${id}/meta.json` }, at).catch(() => undefined)
              const meta = metaOf(text)
              return { id, legacy, doc: meta ? { ...meta, legacy, hasMeta: true } : { legacy, hasMeta: false } }
            }),
          )
          for (const { id, legacy, doc } of part) {
            const before = rows.get(id)
            if (before && before.legacy === legacy && before.hasMeta === doc.hasMeta && (!doc.hasMeta || JSON.stringify(before) === JSON.stringify(doc))) continue
            rows.set(id, doc)
            writes.push({ op: 'set', collection: REPORTS_COLLECTION, id, doc })
          }
        }
        for (const [id, doc] of [...rows]) {
          if (found.has(id) || !complete[doc.legacy === true]) continue
          rows.delete(id)
          writes.push({ op: 'delete', collection: REPORTS_COLLECTION, id })
        }
        for (let from = 0; from < writes.length; from += DB_BATCH) await host.db.batch(writes.slice(from, from + DB_BATCH), at)
        return { rows: [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, doc]) => ({ id, doc })), truncated }
      }

      /** 색인 전체(id 순 = 시간순) — list 는 쪽마다 최대 200, cursor 로 이어 읽는다. 정렬 · 조건 query 는 컬렉션을 훑으며 앱을 멈추니 쓰지 않는다 */
      const listIndex = async (at) => {
        const all = []
        let cursor
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await host.db.list(REPORTS_COLLECTION, { limit: LIST_PAGE, ...(cursor && { cursor }) }, at)
          all.push(...result.docs)
          cursor = result.cursor
          if (!cursor) break
        }
        return all
      }

      /** 폴더 안 결과서 이름(<날짜>-<시각>[-n] 모양의 폴더만) — 폴더가 없으면 빈 목록, 못 읽으면 undefined */
      const listFolder = async (folder, directory) => {
        try {
          const listing = await host.call('project.listDir', { path: folder }, { directory })
          return { names: (listing?.entries ?? []).filter((entry) => entry.dir && FOLDER_NAME.test(entry.name)).map((entry) => entry.name), truncated: listing?.truncated === true }
        } catch (error) {
          const info = await host.call('project.fileInfo', { path: folder }, { directory }).catch(() => 'unknown')
          if (info === null || info === undefined) return { names: [], truncated: false } // 폴더가 아직 없다(튜닝한 적 없음)
          ctx.logger.warn(`reports reindex: cannot read ${folder}`, error)
          return undefined
        }
      }

      // 결과서 폴더가 바뀌면(AI 가 만들었거나 사용자가 지움) 색인을 맞추고 그 프로젝트의 패널에 알린다 — 다른 파일 소식은 거른다. 많이 바뀌어 잘린 소식(truncated)은 알 수 없으니 맞춘다
      ctx.on('project.filesChanged', async (event) => {
        const paths = Array.isArray(event?.paths) ? event.paths : []
        const mine = paths.some((path) => typeof path === 'string' && [REPORTS_FOLDER, LEGACY_REPORTS_FOLDER].some((folder) => `/${path.replaceAll('\\', '/')}/`.includes(`/${folder}/`)))
        if (!mine && event?.truncated !== true) return
        if (typeof event?.directory === 'string') await reindexed(event.directory).catch((error) => ctx.logger.warn('reports reindex', error))
        try {
          host.panel.emit('reports', { truncated: event?.truncated === true }, { directory: event?.directory })
        } catch (error) {
          ctx.logger.warn('panel.emit reports', error)
        }
      })

      // 튜닝 이력 — 색인에서 최신 limit 건(최신 먼저). reindex 가 참이면 먼저 폴더를 훑어 맞춘다(패널이 열릴 때 · [새로 고침]). 소식을 받아 읽을 때는 서비스가 이미 맞췄다
      this.expose('reports', async (params, { directory }) => {
        const limit = Number.isInteger(params?.limit) && params.limit > 0 ? Math.min(params.limit, 200) : 30
        try {
          const synced = params?.reindex === true ? await reindexed(directory) : { rows: await listIndex({ directory }), truncated: false }
          const rows = synced.rows.slice(-limit).reverse()
          return { ok: true, value: { rows, total: synced.rows.length, truncated: synced.truncated } }
        } catch (error) {
          return { ok: false, code: codeOf(error) }
        }
      })

      // service.call 은 실패하면 서비스가 던진 글을 패널에 주지 않고 service-failed 로만 알린다 — 패널이 오류 코드(path-unsafe · no-settings …)로
      // 안내를 고르므로 코드를 값에 실어 돌려준다: { ok: true, value } | { ok: false, code }
      for (const [name, method] of Object.entries(RELAY)) {
        this.expose(name, async (params, { directory }) => {
          try {
            return { ok: true, value: (await host.call(method, params, { directory })) ?? null }
          } catch (error) {
            return { ok: false, code: codeOf(error) }
          }
        })
      }

      // 결과서 삭제 — 파일 권한이 있는 서버가 지운다(앱의 project.removeFile 은 .litecode/*.md 만 지운다). 새 · 옛 위치 어느 쪽이든 서버가 찾는다. 서버 오류 글 `코드: 설명` 의 코드를 패널에 돌려준다
      this.expose('deleteReport', async (params, { directory }) => {
        const id = params && typeof params === 'object' ? params.id : undefined
        if (typeof id !== 'string' || !id) return { ok: false, code: 'bad-id' }
        try {
          const result = await host.call('mcp.call', { tool: 'delete_report', args: { id } }, { directory })
          const failed = result?.isError ? String(result.text ?? '').split(':')[0]?.trim() || 'io-failed' : undefined
          // 폴더가 지워졌거나 이미 없으면 색인 줄도 지운다(서버가 지웠어도 한 번 더 — 없는 줄을 지우는 것은 괜찮다)
          if (failed === undefined || failed === 'not-found') await host.db.delete(REPORTS_COLLECTION, id, { directory }).catch(() => undefined)
          if (failed) return { ok: false, code: failed }
          return { ok: true, value: result?.text ?? '' }
        } catch (error) {
          return { ok: false, code: codeOf(error) }
        }
      })

      // 플러그인 기본 표준 — skills.readFile 과 같은 { text } 모양. 없으면 null(패널은 "플러그인 기본 없음")
      this.expose('bundledFile', async () => {
        try {
          const text = await host.skills.readFile('sql-tuning', BUNDLED_STANDARD)
          return { ok: true, value: typeof text === 'string' && text ? { text } : null }
        } catch (error) {
          return { ok: false, code: codeOf(error) }
        }
      })
    }
  }
