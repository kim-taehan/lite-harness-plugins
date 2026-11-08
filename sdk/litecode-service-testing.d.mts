// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
import type { ExposedCall, ServiceBase, ServiceCallMethod, ServiceContext, ServiceEventMap, ServiceEventName, ServiceHost, ServiceInjectKey, ServiceMcpServer, ServiceToolCall } from './litecode-service.js'

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
  id?: string
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
  /** 앱이 소식을 냈다 — 받기로 선언한 서비스에, 켜진 프로젝트 것만 준다 */
  emit<K extends ServiceEventName>(name: K, payload?: Partial<ServiceEventMap[K]> & { directory?: string }): Promise<void>
  /** 패널의 service.call 처럼 expose 한 메서드를 부른다 — 결과는 JSON 으로 오간 값(undefined 는 null) */
  call(name: string, params?: unknown, call?: ExposedCall): Promise<unknown>
  names(): string[]
  /** host.panel.emit 으로 밀어 보낸 소식 — 값은 JSON 으로 복사된 것, 상한을 넘은 것은 버려져 없다 */
  pushes(): { event: string; data: unknown; directory?: string }[]
  /** host.locale.register 로 올려 둔 언어 팩 — 해제하면 빠진다 */
  locales(): { language: string; label: string; messages: Record<string, string>; version?: string }[]
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
