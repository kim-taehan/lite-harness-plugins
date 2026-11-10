// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts · docQuery.ts · docStore.ts · docMemory.ts · docCall.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
import type { ExposedCall, ServiceBase, ServiceGrammar, ServiceCallMethod, ServiceContext, ServiceDbUsage, ServiceEventMap, ServiceEventName, ServiceHost, ServiceInjectKey, ServiceMcpServer, ServiceToolCall } from './litecode-service.js'

export interface FakeHostOptions {
  /** 기본 'project' — manifest scope 와 같다 */
  scope?: 'app' | 'project'
  /** manifest 의 service.events */
  events?: readonly ServiceEventName[]
  /** manifest 의 service.inject */
  inject?: readonly ServiceInjectKey[]
  /** inject 한 앱 서비스를 흉내 낸 값 */
  services?: Partial<Record<ServiceInjectKey, unknown>>
  /** host.settings 가 돌려줄 값 */
  settings?: Record<string, unknown>
  /** host.call 이 메서드별로 돌려줄 값 — 앞문(허용 목록 · scope 의 not-on)은 진짜 호스트와 같고, 여기 없는 허용 메서드는 io-failed 로 던진다 */
  calls?: Partial<Record<ServiceCallMethod, (params: unknown, options: { directory?: string }) => unknown>>
  /** 사용자가 허용한 주소(origin) — 주면 host.fetch(network.fetch)가 이 목록 밖 주소에 진짜 앱처럼 consent-required(ServiceCallError.origin 에 그 주소)로 던진다.
   *  안 주면 주소를 따지지 않는다. 시험 중 allowOrigin 으로 늘린다 */
  allowedOrigins?: readonly string[]
  /** host.db 의 한도를 줄여 시험한다(예: totalBytes 를 작게 해 db-full 을 만든다) — 기본은 진짜 앱의 한도 */
  dbLimits?: Partial<ServiceDbUsage['limits']>
  id?: string
  /** host.dir 이 돌려줄 플러그인 설치 폴더 경로 — 기본 '/fake/plugin' (시험용 폴더로) */
  dir?: string
}

export interface FakeHost {
  host: ServiceHost
  ctx: ServiceContext
  /** 번들의 기본 내보내기로 서비스를 만든다 */
  mount(factory: (host: ServiceHost) => new (ctx: ServiceContext) => ServiceBase): ServiceBase
  /** 그 프로젝트에서 켜졌다 — projectOn 을 부른다(scope: "app" 은 안 부른다) */
  enableProject(directory: string): void
  /** 꺼졌다 — projectOn 이 돌려준 해제 함수를 부른다 */
  disableProject(directory: string): void
  /** projectOn 을 불러 둔 프로젝트 */
  projectsOn(): string[]
  /** 사용자가 그 주소를 허용한 것처럼 목록에 더한다 — allowedOrigins 를 줬을 때, 다음 host.fetch 부터 통한다 */
  allowOrigin(origin: string): void
  /** 앱이 소식을 냈다 — 받기로 선언한 서비스에, 켜진 프로젝트 것만 준다 */
  emit<K extends ServiceEventName>(name: K, payload?: Partial<ServiceEventMap[K]> & { directory?: string }): Promise<void>
  /** 패널의 service.call 처럼 expose 한 메서드를 부른다 — 결과는 JSON 으로 오간 값(undefined 는 null) */
  call(name: string, params?: unknown, call?: ExposedCall): Promise<unknown>
  names(): string[]
  /** host.panel.emit 으로 밀어 보낸 소식 — 값은 JSON 으로 복사된 것, 상한을 넘은 것은 버려져 없다 */
  pushes(): { event: string; data: unknown; directory?: string }[]
  /** host.locale.register 로 올려 둔 언어 팩 — 해제하면 빠진다 */
  locales(): { language: string; label: string; messages: Record<string, string>; version?: string }[]
  /** host.grammars.register 로 올려 둔 문법(scope "app" 만 올린다) — 해제하면 빠진다 */
  grammars(): ServiceGrammar[]
  /** host.skills.register · agents.register 로 올려 둔 것 — 해제하면 빠진다 */
  skills(): ({ name: string } & ({ content: string } | { path: string } | { dir: string }))[]
  agents(): ({ name: string } & ({ content: string } | { path: string }))[]
  /** host.lsp.register 로 올려 둔 언어 서버 */
  lspServers(): { languageId: string; extensions: string[]; command: string }[]
  /** host.call 로 부른 것의 기록 — 허용 앞문을 지난 것만 */
  calls: { method: string; params: unknown; directory?: string }[]
  /** host.tools.register 로 올려 둔 AI 도구 — AI 에 보이는 이름(`<id>_<이름>`). 해제하거나 서비스를 내리면 빠진다 */
  tools(): { name: string; description: string; inputSchema: Record<string, unknown> }[]
  /** AI 가 그 도구를 부른 것처럼 run 을 부른다 — 그 프로젝트에서 서비스가 켜져 있어야 한다(아니면 던진다) */
  callTool(name: string, args: Record<string, unknown>, call: ServiceToolCall): Promise<string>
  /** host.mcp.register 로 선언해 둔 MCP 서버 — 가짜 host 는 띄우지 않는다 */
  mcpServers(): ServiceMcpServer[]
  /** host.settings 가 돌려주는 값 */
  settings: Record<string, unknown>
  /** 서비스를 내린다 — 해제 함수 · ctx.effect 정리 · 소식 구독 해제 */
  dispose(): Promise<void>
}

export declare function createFakeHost(options?: FakeHostOptions): FakeHost
