// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
// 설치형 서비스 번들(.mjs)을 쓸 때 가져다 쓰는 타입 — cordis 를 설치하지 않아도 된다. 번들은 `export default (host: ServiceHost) => class extends host.Service { … }` 모양이다.
// manifest(plugin.json)는 JSON 이라 이 파일이 못 본다 — plugin-service.schema.json 이 편집기에서 맞춰 주고, 앱은 설치 때 다시 검사한다.

/** 이 파일이 아는 호스트 API 버전 — manifest `service.api` 는 1 이상 이 값 이하의 정수 */
export declare const SERVICE_API_LATEST: 1

/** manifest `service.inject` 와 ctx.get 에 쓸 수 있는 앱 서비스 키 */
export type ServiceInjectKey = 'projects' | 'usage'

/** manifest `service.events` 와 ctx.on 에 쓸 수 있는 소식 이름 — 패널 소식과 같은 이름 한 벌 */
export type ServiceEventName = 'chat.turnEnded' | 'project.filesChanged' | 'usage.changed'

/** 소식마다 서비스가 받는 값. 프로젝트별 서비스는 directory 가 늘 있다(프로젝트를 모르는 소식은 받지 못한다) — scope "app" 서비스는 프로젝트를 모를 수 있어 없을 수 있다 */
export interface ServiceEventMap {
  /** 앱 안의 이름 chat/turn-ended · 필요한 권한 chat · 켜진 프로젝트의 소식만 받는다 */
  'chat.turnEnded': { directory?: string; conversationId: string; outcome: 'done' | 'interrupted' | 'failed' }
  /** 앱 안의 이름 llm/tool-done (쓰기·고치기) · 필요한 권한 project · 켜진 프로젝트의 소식만 받는다 */
  'project.filesChanged': { directory?: string; paths: string[]; truncated?: boolean }
  /** 앱 안의 이름 usage/changed · 필요한 권한 usage · 프로젝트 정보 없음 — manifest scope "app" 서비스만 받는다 */
  'usage.changed': {}
}

/** host.call 로 부를 수 있는 앱 호출 표의 메서드 — 패널이 쓰는 이름과 같고, 권한은 manifest permissions 로 패널과 같게 검사한다 */
export type ServiceCallMethod = 'storage.get' | 'storage.set' | 'storage.delete' | 'secrets.set' | 'secrets.delete' | 'network.fetch' | 'network.connection' | 'network.setConnection' | 'project.info' | 'project.readFile' | 'project.openFile' | 'project.openTabs' | 'project.pickPath' | 'project.changedFiles' | 'project.listDir' | 'project.findFiles' | 'project.countFiles' | 'project.fileInfo' | 'project.writeFile' | 'project.removeFile' | 'settings.summary' | 'settings.check' | 'chat.compose' | 'chat.open' | 'chat.current' | 'chat.exists' | 'chat.titles' | 'tools.run' | 'mcp.call' | 'mcp.status' | 'usage.summary' | 'panel.notify' | 'panel.fullscreen' | 'settings.open' | 'skills.readFile' | 'skills.writeFile' | 'skills.deleteFile'

/** host.call 이 던지는 오류 — code 는 패널 통로와 같은 오류 코드(permission-missing · not-on · no-project · method-unknown · no-window · network-denied …), origin 은 network 오류가 알려 주는 주소 */
export interface ServiceCallError extends Error {
  readonly code: string
  readonly origin?: string
}

/** inject 한 앱 서비스의 좁힌 모양 */
export interface ServiceInjectMap {
  projects: { folders(): Promise<string[]>; ownerOf(directory: string): Promise<{ path: string } | undefined> }
  usage: { summary(): unknown }
}

export interface ServiceLogger {
  (name: string): ServiceLogger
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/** 번들이 받는 ctx — 이 밖(root · emit · 선언 안 한 서비스 …)은 없다 */
export interface ServiceContext {
  /** 선언한(manifest service.events) 소식만 — 돌려준 함수로 그만 받는다. 선언 밖 이름은 던진다(서비스가 올라가지 않는다) */
  on<K extends ServiceEventName>(name: K, handler: (data: ServiceEventMap[K]) => unknown): () => void
  /** 선언한(manifest service.inject) 서비스만 */
  get<K extends ServiceInjectKey>(key: K): ServiceInjectMap[K] | undefined
  /** 서비스가 내려갈 때 부르는 정리 함수를 돌려주는 곳 — `ctx.effect(() => () => clearInterval(timer))` */
  effect(setup: () => (() => unknown) | void): unknown
  logger: ServiceLogger
  readonly projects?: ServiceInjectMap['projects']
  readonly usage?: ServiceInjectMap['usage']
}

/** 부른 쪽이 알려 주는 것 — 패널이 부르면 그 프로젝트 폴더. 모르면 없다 */
export interface ExposedCall {
  directory?: string
}
export type ExposedMethod = (params: unknown, call: ExposedCall) => unknown

/** 서비스 바탕 클래스 — host.Service */
export declare class ServiceBase {
  constructor(ctx: ServiceContext)
  readonly ctx: ServiceContext
  /** 쓸 앱 서비스 키 — manifest 의 service.inject 와 같게. `static inject = ['projects'] as const` */
  static inject?: readonly ServiceInjectKey[]
  /** 패널이 service.call 로 부를 수 있는 메서드를 낸다 — 서비스가 내려가면 같이 사라진다 */
  expose(name: string, fn: ExposedMethod): void
  /** 선택: 그 프로젝트에서 켜졌다. 돌려준 함수를 꺼질 때(서비스가 내려갈 때도) 부른다. scope: "app" 서비스에는 불리지 않는다 */
  projectOn?(directory: string): (() => void) | void
}

/** 번들이 받는 host */
export interface ServiceHost {
  Service: typeof ServiceBase
  id: string
  /** 그 프로젝트에서 이 서비스가 켜졌나 — scope: "app" 이면 늘 true */
  enabledIn(directory: string): Promise<boolean>
  /** 지금 켜진 프로젝트 폴더 목록 */
  projects(): Promise<string[]>
  /** 그 프로젝트의 설정 칸 값 — 비밀 값은 주지 않는다 */
  settings(directory?: string): Promise<Record<string, unknown>>
  /** 언어 팩(번역 글)을 앱에 올린다 — scope: "app" 서비스만(아니면 던진다). 서비스가 내려가면 걷힌다. 내장 사전에 없는 키 · 너무 긴 값은 앱이 말없이 버린다 */
  locale: { register(pack: { language: string; label: string; messages: Record<string, string>; version?: string }): () => void }
  /** 스킬(.md 지침)을 올린다 — content 는 frontmatter(name 이 name 과 같고 description 이 있는)를 가진 SKILL.md 글, path 는 플러그인 폴더 기준 .md, dir 은 플러그인 폴더 기준 스킬 폴더(SKILL.md 필수 — references/ 같은 딸린 파일도 통째로 놓인다, 폴더 밖 · 링크 · 너무 큰 파일 · 너무 많은 파일은 던진다). 이름은 소문자·숫자·- (2~41자). 같은 서비스에서 이름이 겹치거나 틀리면 던진다.
   *  서비스가 켜지지 않은 프로젝트의 턴에서는 숨고, 서비스가 내려가면 걷힌다 */
  skills: { register(skill: { name: string } & ({ content: string } | { path: string } | { dir: string })): () => void }
  /** 에이전트(.md)를 올린다 — 모양은 skills 와 같고 frontmatter 는 사용자 에이전트(.litecode/agents)와 같은 형식(name 이 같아야 한다). 같은 이름이면 사용자·프로젝트 에이전트가 이긴다.
   *  서비스가 켜지지 않은 프로젝트에서는 막히고, 서비스가 내려가면 걷힌다 */
  agents: { register(agent: { name: string } & ({ content: string } | { path: string })): () => void }
  /** 언어 서버를 올린다 — manifest lsp 항목과 같은 모양 · 같은 검사(command 는 플러그인 폴더 기준). 서비스가 켜지지 않은 프로젝트에서는 띄우지 않고, 내려가면 걷힌다. 같은 서비스에서 languageId · 확장자가 겹치면 던진다 */
  lsp: {
    register(server: { languageId: string; extensions: string[]; command: string; args?: string[]; env?: Record<string, string>; initializationOptions?: unknown; settings?: unknown; idleMs?: number }): () => void
  }
  /** 앱의 호출 표를 그대로 부른다 — 성공하면 값, 실패하면 ServiceCallError. 프로젝트별(scope "project") 서비스는 directory 가 있어야 하고 그 프로젝트에서 켜져 있어야 한다(아니면 not-on).
   *  chat.compose · chat.open · project.openFile · panel.fullscreen · settings.open 은 그 프로젝트의 창이 해 주고(창이 없거나 보이는 그 플러그인 탭이 없으면 no-window), chat.current · project.openTabs 는 창이 값을 돌려준다.
   *  빠진 것: panel.args · events.subscribe(ctx.on 을 쓴다) · service.call · service.list */
  call(method: ServiceCallMethod, params?: unknown, options?: { directory?: string }): Promise<unknown>
  /** 자기 패널(같은 플러그인)에 소식을 밀어 보낸다 — 이름은 `service.<name>` 이 되고, 패널은 `events.subscribe(['service.<name>'])`(service 권한)로 받는다.
   *  directory 를 주면 그 프로젝트의 패널에만. 값은 JSON 으로 오가는 것만(아니면 던진다) · 64KB 이하(넘으면 던진다) · 초당 20번(넘으면 말없이 버린다). 이름은 글자로 시작하는 64자 이하(글자 · 숫자 · _ . -) */
  panel: { emit(name: string, data: unknown, options?: { directory?: string }): void }
  /** 바깥으로 요청하는 안내된 길 — host.call('network.fetch') 를 Response 로 감쌌다: manifest 의 network 권한과 사용자가 허용한 주소만(없으면 ServiceCallError network-denied), GET · POST(글 본문), 헤더는 content-type 만. 프로젝트별(scope "project") 서비스는 host.call 처럼 init.directory 가 필요하다.
   *  직접 fetch · WebSocket · node:http · https · http2 · net · tls · dns · dgram 은 설치 검사가 거절한다(글자 점검이라 완전하지 않다 — 서비스는 앱과 같은 프로세스라 최종 강제는 해시 고정 · 동의 · 리뷰 몫) */
  fetch(url: string | URL, init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; directory?: string }): Promise<Response>
  /** AI 도구를 앱에 올린다 — 이름은 AI 에 `<플러그인 id>_<이름>` 으로 보이고, 그 프로젝트에서 서비스가 켜진 때만 보인다. 이름이 겹치거나 모양이 틀리면 던진다. 서비스가 내려가면 걷힌다 */
  tools: { register(tool: ServiceTool): () => void }
  /** 별도 프로세스 MCP 서버를 선언한다 — manifest 의 mcp 와 같은 모양 · 같은 규칙(설치 폴더 기준 실행 파일, 자리표시). 플러그인에 서버는 하나. 오래 걸리는 일 · 비밀을 서비스 밖에서 돌릴 때 쓴다. 서비스가 내려가면 걷힌다 */
  mcp: { register(server: ServiceMcpServer): () => void }
}

/** host.tools.register 에 주는 AI 도구 */
export interface ServiceTool {
  /** 소문자·숫자·`-`·`_`, 첫 글자 소문자, 40자 이하 */
  name: string
  /** 모델이 읽는 설명 — 영어 */
  description: string
  /** JSON Schema — `type: "object"` */
  inputSchema: Record<string, unknown>
  /** 돌려준 글이 모델에게 간다. 던지면 그 메시지가 실패로 간다 */
  run(args: Record<string, unknown>, call: ServiceToolCall): string | Promise<string>
}

/** 도구를 부른 곳 */
export interface ServiceToolCall {
  /** 부른 프로젝트 폴더 */
  directory: string
  /** 부른 대화(알 수 있을 때만) */
  conversation?: string
}

/** host.mcp.register 에 주는 선언 — manifest 의 mcp 와 같다 */
export interface ServiceMcpServer {
  /** 설치 폴더 기준 실행 파일 */
  command: string
  /** 자리표시: ${extensionDir} · ${dataDir} · ${projectDataDir} */
  args?: string[]
  /** 자리표시: 위 셋에 ${storage:<키>} · ${secret:<키>} 까지 */
  env?: Record<string, string>
  /** 이 시간(ms) 호출이 없으면 서버를 내린다 — 기본 10분 */
  idleMs?: number
  /** 도구 호출 기한(ms) — 기본 5분 */
  timeoutMs?: number
  /** 패널만 부르는 도구 이름 — AI 에는 안 보인다 */
  panelTools?: string[]
  /** 'server': 플러그인 id 이름의 MCP 서버로 따로 붙인다 */
  attach?: 'litecode' | 'server'
}

/** 번들 진입점 — `export default (host) => class extends host.Service { … }` */
export type ServiceBundle = (host: ServiceHost) => new (ctx: ServiceContext) => ServiceBase
