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
          UI_TEST_REPORT_DIR: '${storage:reportDir}',
          UI_TEST_DATA_DIR: '${dataDir}',
        },
        idleMs: 1_800_000,
        timeoutMs: 1_800_000,
        panelTools: ['progress', 'stop', 'shot'],
      })
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
      // 앱 기능 — 패널은 앱 통로를 직접 쓰지 않고 서비스를 거친다
      this.expose('openFile', (params, { directory }) => host.call('project.openFile', { path: record(params).path }, { directory }))
      this.expose('ask', (params, { directory }) => host.call('chat.compose', { text: record(params).text, send: true }, { directory }))
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
