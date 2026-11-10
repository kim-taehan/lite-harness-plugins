// UI 테스트 서비스 (0.7.0) — 앱 안에서 도는 코드. 일은 별도 프로세스 MCP 서버(server/ui-test.mjs, playwright-core)가 하고,
// 서비스는 그 서버를 host.mcp.register 로 올리고 부르는 껍데기다: 패널이 service.call 로 묻는 것을 서버 도구(mcp.call)로 넘기고, 수행 중에는 진행을 서버에서 읽어 패널로 밀어 보낸다(폴링 대신).
// 기록 저장소(host.db)는 서버가 쓴다 — 이 번들은 DB 클라이언트를 가져오지 않고, 목록 · 상세 · 삭제는 서버 도구를 부른다(계약: README "패널 ↔ 서비스").
// 번들(build.mjs 가 service.mjs 한 파일로 묶는다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다. 비밀번호는 서비스가 읽지 못한다 —
// plugin.json settings 의 secret 칸 + 서버 env 의 ${secret:password} 로 서버 프로세스에만 간다(서비스는 host.call('secrets.get') 자체를 못 부른다).
//
// 프로젝트별(scope project) — 패널이 부른 프로젝트 폴더(directory)마다 서버가 따로 뜨고 진행 감시도 따로 돈다.

/** 진행을 서버에서 읽는 간격 */
const WATCH_MS = 1000
/** 수행을 시작하고 첫 진행을 읽기까지 — 서버가 수행 상태를 만들 시간 */
const FIRST_WATCH_MS = 400
/** 패널이 서버 도구 run 에 넘길 수 있는 인자 — 시나리오를 고르는 말(scenarios · screen · request · failed)과 결과서 방식 · 브라우저 창 */
const RUN_KEYS = ['scenarios', 'screen', 'request', 'failed', 'headed']
/** 패널 기본값을 담는 저장 칸 키 */
const PREFS_KEY = 'prefs'

export default (host) =>
  class UiTest extends host.Service {
    /** directory → 진행을 감시하는 타이머 */
    watchers = new Map()

    constructor(ctx) {
      super(ctx)
      // 실행기 서버 — 앱이 따로 띄우고(첫 도구 호출 때) 쉬면 내린다. 설정 칸 값은 ${storage:}, 비밀번호는 ${secret:} 로 서버 env 에 간다.
      // 서버 도구는 AI 에 litecode_ui-test_<도구> 로 보이고(스킬이 쓰는 이름 그대로), progress · stop · shot · delete · detail · reindex · pdf 는 패널(서비스) 전용이다
      host.mcp.register({
        command: 'server/ui-test.mjs',
        env: {
          UI_TEST_BASE_URL: '${storage:baseUrl}',
          UI_TEST_BROWSER: '${storage:browser}',
          UI_TEST_USER: '${storage:user}',
          UI_TEST_PASSWORD: '${secret:password}',
          UI_TEST_BACKEND_DIRS: '${storage:backendDirs}',
          UI_TEST_DATA_DIR: '${dataDir}',
        },
        idleMs: 1_800_000,
        timeoutMs: 1_800_000,
        panelTools: ['progress', 'stop', 'shot', 'delete', 'detail', 'reindex', 'pdf'],
      })
      // 스킬 — SKILL.md 와 references/ 가 통째로 올라간다(zip 의 skills/ui-test). 서비스가 켜진 프로젝트의 대화에서만 보인다
      host.skills.register({ name: 'ui-test', dir: 'skills/ui-test' })
      ctx.effect(() => () => {
        for (const timer of this.watchers.values()) clearTimeout(timer)
        this.watchers.clear()
      })

      // 서버 도구 — 목록 · 상세 · 삭제 · 맞추기는 서버가 JSON 글로 답하고 서비스가 풀어서 돌려준다(패널은 다시 풀지 않는다)
      this.expose('list', async (params, call) => JSON.parse(await this.tool('list', { json: true, ...pick(params, ['scenarios', 'screen', 'request', 'failed', 'cursor']) }, call)))
      this.expose('detail', async (params, call) => JSON.parse(await this.tool('detail', { id: record(params).id }, call)))
      this.expose('reindex', async (_params, call) => JSON.parse(await this.tool('reindex', {}, call)))
      this.expose('shot', (params, call) => this.tool('shot', pick(params, ['run', 'name']), call))
      this.expose('stop', (_params, call) => this.tool('stop', {}, call))
      // 진행 — 지금 상태를 돌려주고, 수행 중이면 감시를 이어 간다(패널을 다시 열었을 때)
      this.expose('progress', async (_params, call) => {
        const text = await this.tool('progress', {}, call)
        if (running(text)) this.watch(call.directory, FIRST_WATCH_MS)
        return JSON.parse(text)
      })
      // 실행 — 서버의 run 은 끝날 때까지 돌아오지 않으므로 기다리지 않고 시작만 알린다. 진행은 감시가 밀어 보내고, 시작이 실패하면 runError 소식으로 알린다
      this.expose('run', (params, call) => {
        if (!call.directory) throw new Error('no-project')
        const { directory } = call
        this.tool('run', pick(params, RUN_KEYS), call).catch((error) => this.emit('runError', { message: error instanceof Error ? error.message : String(error) }, directory))
        this.watch(directory, FIRST_WATCH_MS)
        return { started: true }
      })
      // 기본값(환경 팝업 · 실행 묻기) — 프로젝트별 저장 칸에 둔다. 서비스에는 영구 저장소가 없어 host.call('storage.*') 를 쓴다.
      // headed(브라우저 창 보이게 — 기본 false = 화면 없이) · output(실행 뒤 산출물: report | both)
      this.expose('prefs', async (params, { directory }) => {
        const current = record(await host.call('storage.get', { key: PREFS_KEY }, { directory }))
        const set = record(record(params).set)
        const next = { ...current }
        if (typeof set.headed === 'boolean') next.headed = set.headed
        if (set.output === 'report' || set.output === 'both') next.output = set.output
        if (next.headed === current.headed && next.output === current.output) return current
        await host.call('storage.set', { key: PREFS_KEY, value: next }, { directory })
        return next
      })
      // 삭제 — 시나리오들(scenarios) 또는 화면 · 요청 그룹(screen · request). 패널이 확인을 받은 뒤 부르는 패널 전용 도구(AI 에는 노출하지 않는다)
      this.expose('delete', async (params, call) => JSON.parse(await this.tool('delete', pick(params, ['scenarios', 'screen', 'request']), call)))
      // 가이드형 결과물 — 서버가 수행 기록으로 guide.html 을 쓰고 경로를 돌려준다
      this.expose('guide', async (params, call) => JSON.parse(await this.tool('guide', { run: record(params).run, json: true }, call)))
      // PDF 로 저장 — 서버(pdf 도구)가 프로젝트 안에 PDF 를 만들고, 서비스가 project.exportFile 로 사용자가 고른 곳에 복사한다(서비스만 부를 수 있다 — 호스트 API 2).
      // 던지면 패널에는 코드 service-failed 만 가므로 실패는 값으로 돌려준다: { saved: true, name } · 취소 { saved: false } · 실패 { saved: false, code, message? }
      // code: busy · export-limit · permission-missing · unsupported(옛 앱 — 알 수 없는 호출) · pdf-failed(서버가 PDF 를 못 만듦 — 브라우저 등) · 그 밖의 앱 오류 코드 그대로
      this.expose('exportPdf', async (params, call) => {
        const { directory } = call
        let made
        try {
          made = JSON.parse(await this.tool('pdf', pick(params, ['run', 'kind', 'scenario']), call))
        } catch (error) {
          return { saved: false, code: 'pdf-failed', message: error instanceof Error ? error.message : String(error) }
        }
        try {
          const saved = await host.call('project.exportFile', { path: made.path, name: made.name }, { directory })
          return saved?.saved === true ? { saved: true, name: saved.name ?? made.name } : { saved: false }
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'failed'
          return { saved: false, code: code === 'method-unknown' ? 'unsupported' : code }
        }
      })
      // 앱 기능 — 패널은 앱 통로를 직접 쓰지 않고 서비스를 거친다
      this.expose('openFile', (params, { directory }) => host.call('project.openFile', { path: record(params).path }, { directory }))
      // send: false 면 새 대화의 입력창만 채우고 보내지 않는다(변경 요청처럼 사용자가 이어 쓸 때)
      this.expose('ask', (params, { directory }) => host.call('chat.compose', { text: record(params).text, send: record(params).send !== false }, { directory }))
    }

    /** 서버 도구 하나를 부른다 — 실패(isError)면 던진다 */
    async tool(name, args, { directory }) {
      const result = await host.call('mcp.call', { tool: name, args }, { directory })
      if (result?.isError) throw new Error(result.text)
      return result?.text ?? ''
    }

    emit(name, data, directory) {
      try {
        host.panel.emit(name, data, { directory })
      } catch (error) {
        // 64KB 를 넘는 등 — 진행이면 패널이 직접 읽어 가게 알리기만 한다
        this.ctx.logger.warn(`panel.emit ${name}`, error)
        if (name === 'progress') host.panel.emit('progress', { running: true, stale: true }, { directory })
      }
    }

    /** 수행이 끝날 때까지 진행을 읽어 패널로 밀어 보낸다 (프로젝트마다 하나) */
    watch(directory, delay) {
      if (!directory || this.watchers.has(directory)) return
      const tick = async () => {
        this.watchers.delete(directory)
        let text
        try {
          text = await this.tool('progress', {}, { directory })
        } catch {
          return // 서버가 내려갔다 — 패널이 다시 열 때 이어 간다
        }
        let progress
        try {
          progress = JSON.parse(text)
        } catch {
          return
        }
        this.emit('progress', progress, directory)
        if (progress?.running) this.watchers.set(directory, setTimeout(tick, WATCH_MS))
      }
      this.watchers.set(directory, setTimeout(tick, delay))
    }
  }

/** 허용한 키만 — 패널이 모르는 인자를 서버 도구에 흘리지 않는다 */
function pick(value, keys) {
  const from = record(value)
  return Object.fromEntries(keys.filter((key) => from[key] !== undefined).map((key) => [key, from[key]]))
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function running(text) {
  try {
    return JSON.parse(text)?.running === true
  } catch {
    return false
  }
}
