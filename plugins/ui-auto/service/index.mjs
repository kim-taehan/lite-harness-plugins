// UI-AUTO 서비스 — 앱 안에서 도는 껍데기. 일은 별도 프로세스 MCP 서버(server/ui-auto.mjs — Playwright MCP 중계 · 증적 읽기 · 패널 수행 · 보고서 HTML/PDF)가 한다.
// 서비스는 그 서버와 스킬 다섯을 올리고, 패널이 service.call 로 묻는 것을 서버 도구(mcp.call)로 넘기며, 패널 수행 중에는 진행을 읽어 패널로 밀어 보낸다.
// 비밀번호는 서비스가 읽지 못한다 — 설정의 secret 칸 + 서버 env 의 ${secret:password} 로 서버 프로세스에만 간다.
// 프로젝트별(scope project) — 프로젝트 폴더(directory)마다 서버가 따로 뜨고 진행 감시도 따로 돈다.

/** 진행을 서버에서 읽는 간격 */
const WATCH_MS = 1000
const FIRST_WATCH_MS = 400
const SKILLS = ['ui-auto', 'ui-auto-evidence', 'ui-auto-run', 'ui-auto-tc', 'ui-auto-ask', 'ui-auto-guide']
const PANEL_TOOLS = ['list', 'detail', 'replay', 'progress', 'stop', 'view', 'pdf', 'shot', 'report', 'guide_read', 'delete']

export default (host) =>
  class UiAuto extends host.Service {
    /** directory → 진행 감시 타이머 */
    watchers = new Map()

    constructor(ctx) {
      super(ctx)
      // AI 에는 litecode_ui-auto_<도구> 로 보인다(스킬이 쓰는 이름). 패널 전용 도구는 AI 에 안 보인다
      host.mcp.register({
        command: 'server/ui-auto.mjs',
        env: {
          UI_AUTO_BASE_URL: '${storage:baseUrl}',
          UI_AUTO_BROWSER: '${storage:browser}',
          UI_AUTO_WINDOW: '${storage:window}',
          UI_AUTO_USER: '${storage:user}',
          UI_AUTO_PASSWORD: '${secret:password}',
          UI_AUTO_LOGIN_PATH: '${storage:loginPath}',
          UI_AUTO_USER_FIELD: '${storage:userField}',
          UI_AUTO_PASSWORD_FIELD: '${storage:passwordField}',
          UI_AUTO_LOGIN_BUTTON: '${storage:loginButton}',
          UI_AUTO_TESTDATA: '${storage:testdata}',
          UI_AUTO_STATE_DIR: '${projectDataDir}',
        },
        idleMs: 1_800_000,
        timeoutMs: 600_000,
        panelTools: PANEL_TOOLS,
      })
      for (const name of SKILLS) host.skills.register({ name, dir: `skills/${name}` })
      // /ui-auto 가 부르는 도구(AI 에 ui-auto_panel) — 오른쪽 패널에 UI-AUTO 탭을 연다. 처음 한 번은 앱이 사용자에게 허락을 묻고, 10초 안에 또 부르면 거절된다
      host.tools.register({
        name: 'panel',
        description: 'Open the UI-AUTO tab in the right panel of the app (page list, flow map, TC list, evidence reports). Call it when the user runs /ui-auto or asks to see the UI-AUTO panel.',
        inputSchema: { type: 'object', properties: {} },
        run: async (_args, { directory }) => {
          try {
            await host.call('panel.open', {}, { directory })
            return 'UI-AUTO 패널을 열었습니다.'
          } catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'failed'
            return code === 'panel-open-off' ? '사용자가 패널 열기를 꺼 두었습니다 — 오른쪽 패널의 + 메뉴에서 UI-AUTO 를 직접 열어 달라고 안내하세요.' : `패널을 열지 못했습니다 (${code}) — 오른쪽 패널의 + 메뉴에서 UI-AUTO 를 열어 달라고 안내하세요.`
          }
        },
      })
      ctx.effect(() => () => {
        for (const timer of this.watchers.values()) clearTimeout(timer)
        this.watchers.clear()
      })

      this.expose('list', async (_params, call) => JSON.parse(await this.tool('list', {}, call)))
      this.expose('detail', async (params, call) => JSON.parse(await this.tool('detail', { tc: String(record(params).tc ?? '') }, call)))
      this.expose('stop', async (_params, call) => JSON.parse(await this.tool('stop', {}, call)))
      this.expose('progress', async (_params, call) => {
        const progress = JSON.parse(await this.tool('progress', {}, call))
        if (progress?.running) this.watch(call.directory, FIRST_WATCH_MS)
        return progress
      })
      // 패널 수행 — 서버가 시작만 알리고 돌아온다. 진행은 감시가 밀어 보낸다
      this.expose('run', async (params, call) => {
        if (!call.directory) throw new Error('no-project')
        const tcs = Array.isArray(record(params).tcs) ? record(params).tcs.map(String) : []
        const result = JSON.parse(await this.tool('replay', { tcs }, call))
        if (result?.started) this.watch(call.directory, FIRST_WATCH_MS)
        return result
      })
      // 보고서 · 가이드 보기 — 서버가 md 에서 HTML 을 새로 만들고, 앱 미리보기로 연다
      this.expose('open', async (params, call) => {
        const made = JSON.parse(await this.tool('view', docArgs(params), call))
        await host.call('project.openFile', { path: made.path }, { directory: call.directory })
        return made
      })
      // PDF 로 저장 — 서버가 PDF 를 만들고 project.exportFile 로 사용자가 고른 곳에 복사한다. 실패는 값으로: { saved, name } · { saved: false } · { saved: false, code }
      this.expose('exportPdf', async (params, call) => {
        let made
        try {
          made = JSON.parse(await this.tool('pdf', docArgs(params), call))
        } catch (error) {
          return { saved: false, code: 'pdf-failed', message: error instanceof Error ? error.message : String(error) }
        }
        try {
          const saved = await host.call('project.exportFile', { path: made.path, name: made.name }, { directory: call.directory })
          return saved?.saved === true ? { saved: true, name: saved.name ?? made.name } : { saved: false }
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'failed'
          return { saved: false, code: code === 'method-unknown' ? 'unsupported' : code }
        }
      })
      // 새 대화에 요청 — [AI 에게 맡기기] · [TC 뽑기] · [가이드 만들기]
      this.expose('ask', (params, { directory }) => host.call('chat.compose', { text: String(record(params).text ?? ''), send: record(params).send !== false }, { directory }))
      this.expose('shot', async (params, call) => JSON.parse(await this.tool('shot', { path: String(record(params).path ?? '') }, call)))
      this.expose('report', async (params, call) => JSON.parse(await this.tool('report', { id: String(record(params).id ?? '') }, call)))
      this.expose('guide', async (params, call) => JSON.parse(await this.tool('guide_read', { id: String(record(params).id ?? '') }, call)))
      // TC 삭제 — 패널이 확인을 받은 뒤 부른다. 상태를 폐기로(번호는 다시 쓰지 않는다), script 가 true 면 스크립트 파일도
      this.expose('delete', async (params, call) => JSON.parse(await this.tool('delete', { tc: String(record(params).tc ?? ''), script: record(params).script === true }, call)))
      this.expose('openLessons', (_params, { directory }) => host.call('project.openFile', { path: '.litecode/ui-auto/lessons-learned.md' }, { directory }))
      // 테스트 가이드 — 그 TC 의 가장 새 성공 보고서로 서버가 만든다(LLM 없이)
      this.expose('makeGuide', async (params, call) => JSON.parse(await this.tool('guide', { tc: String(record(params).tc ?? '') }, call)))
      this.expose('fullscreen', (params, { directory }) => host.call('panel.fullscreen', { on: record(params).on === true }, { directory }))
      this.expose('settings', (_params, { directory }) => host.call('settings.open', {}, { directory }))
    }

    async tool(name, args, { directory }) {
      const result = await host.call('mcp.call', { tool: name, args }, { directory })
      if (result?.isError) throw new Error(result.text)
      return result?.text ?? ''
    }

    emit(name, data, directory) {
      try {
        host.panel.emit(name, data, { directory })
      } catch (error) {
        this.ctx.logger.warn(`panel.emit ${name}`, error)
      }
    }

    /** 수행이 끝날 때까지 진행을 읽어 패널로 밀어 보낸다 (프로젝트마다 하나) */
    watch(directory, delay) {
      if (!directory || this.watchers.has(directory)) return
      const tick = async () => {
        this.watchers.delete(directory)
        let progress
        try {
          progress = JSON.parse(await this.tool('progress', {}, { directory }))
        } catch {
          return
        }
        this.emit('progress', progress, directory)
        if (progress?.running) this.watchers.set(directory, setTimeout(tick, WATCH_MS))
      }
      this.watchers.set(directory, setTimeout(tick, delay))
    }
  }

function docArgs(params) {
  const value = record(params)
  return { kind: value.kind === 'guide' ? 'guide' : 'report', id: String(value.id ?? '') }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
