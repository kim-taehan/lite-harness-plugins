// UI 테스트 서비스 (0.3.0) — 앱 안에서 도는 코드. 일은 별도 프로세스 MCP 서버(server/ui-test.mjs, playwright-core)가 하고,
// 서비스는 그 서버를 host.mcp.register 로 올리고 부르는 껍데기다: 패널이 service.call 로 묻는 것을 서버 도구(mcp.call)로 넘기고, 수행 중에는 진행을 서버에서 읽어 패널로 밀어 보낸다(폴링 대신).
// 번들(build.mjs 가 service.mjs 한 파일로 묶는다)은 cordis 를 가져오지 않고 앱이 넘긴 host 로 만든다. 비밀번호는 서비스가 읽지 못한다 —
// plugin.json settings 의 secret 칸 + 서버 env 의 ${secret:password} 로 서버 프로세스에만 간다(서비스는 host.call('secrets.get') 자체를 못 부른다).
//
// 프로젝트별(scope project) — 패널이 부른 프로젝트 폴더(directory)마다 서버가 따로 뜨고 진행 감시도 따로 돈다.

/** 진행을 서버에서 읽는 간격 */
const WATCH_MS = 1000
/** 수행을 시작하고 첫 진행을 읽기까지 — 서버가 수행 상태를 만들 시간 */
const FIRST_WATCH_MS = 400
/** 패널 기본값을 담는 저장 칸 키 */
const PREFS_KEY = 'prefs'

export default (host) =>
  class UiTest extends host.Service {
    /** directory → 진행을 감시하는 타이머 */
    watchers = new Map()

    constructor(ctx) {
      super(ctx)
      // 실행기 서버 — 앱이 따로 띄우고(첫 도구 호출 때) 쉬면 내린다. 설정 칸 값은 ${storage:}, 비밀번호는 ${secret:} 로 서버 env 에 간다.
      // 서버 도구는 AI 에 litecode_ui-test_<도구> 로 보이고(스킬이 쓰는 이름 그대로), progress · stop · shot 은 패널(서비스) 전용이다
      host.mcp.register({
        command: 'server/ui-test.mjs',
        env: {
          UI_TEST_BASE_URL: '${storage:baseUrl}',
          UI_TEST_BROWSER: '${storage:browser}',
          UI_TEST_USER: '${storage:user}',
          UI_TEST_PASSWORD: '${secret:password}',
          UI_TEST_BACKEND_DIRS: '${storage:backendDirs}',
          UI_TEST_DIR: '${storage:testDir}',
          UI_TEST_DATA_DIR: '${dataDir}',
        },
        idleMs: 1_800_000,
        timeoutMs: 1_800_000,
        panelTools: ['progress', 'stop', 'shot', 'delete'],
      })
      // 스킬 — SKILL.md 와 references/ 가 통째로 올라간다(zip 의 skills/ui-test). 서비스가 켜진 프로젝트의 대화에서만 보인다
      host.skills.register({ name: 'ui-test', dir: 'skills/ui-test' })
      ctx.effect(() => () => {
        for (const timer of this.watchers.values()) clearTimeout(timer)
        this.watchers.clear()
      })

      // 서버 도구 — 글(text)을 그대로 돌려준다. 패널이 JSON 으로 읽는다
      this.expose('list', (params, call) => this.tool('list', { json: true, ...record(params) }, call))
      this.expose('shot', (params, call) => this.tool('shot', record(params), call))
      this.expose('stop', (_params, call) => this.tool('stop', {}, call))
      // 진행 — 지금 상태를 돌려주고, 수행 중이면 감시를 이어 간다(패널을 다시 열었을 때)
      this.expose('progress', async (_params, call) => {
        const text = await this.tool('progress', {}, call)
        if (running(text)) this.watch(call.directory, FIRST_WATCH_MS)
        return text
      })
      // 수행 — 서버의 run 은 끝날 때까지 돌아오지 않으므로 기다리지 않고 시작만 알린다. 진행은 감시가 밀어 보내고, 시작이 실패하면 runError 소식으로 알린다
      this.expose('run', (params, call) => {
        if (!call.directory) throw new Error('no-project')
        const { directory } = call
        this.tool('run', record(params), call).catch((error) => this.emit('runError', { message: error instanceof Error ? error.message : String(error) }, directory))
        this.watch(directory, FIRST_WATCH_MS)
        return { started: true }
      })
      // 기본값(환경 팝업) — 프로젝트별 저장 칸에 둔다. 서비스에는 영구 저장소가 없어 host.call('storage.*') 를 쓴다. headed(브라우저 창 보이게 — 기본 false = 화면 없이) · output(수행 뒤 산출물: report | both)
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
      // 삭제 — 시나리오 하나(scenario) 또는 묶음 전체. 패널이 확인을 받은 뒤 부르는 패널 전용 도구(AI 에는 노출하지 않는다)
      this.expose('delete', (params, call) => this.tool('delete', record(params), call))
      // 가이드형 결과물 — 서버가 수행 기록으로 guide.html 을 쓰고 경로를 돌려준다
      this.expose('guide', (params, call) => this.tool('guide', record(params), call))
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
