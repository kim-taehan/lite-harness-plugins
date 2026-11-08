# 플러그인 서비스 작성 안내

플러그인이 패널을 닫아도 계속 도는 코드(소식을 받아 쌓기, 프로젝트가 켜질 때 자원 잡기)가 필요하면 **서비스**로 만든다. 코드를 가진 플러그인은 서비스 한 길이다(결정 기록: 이슈 #1614).
언어 팩·문법 팩·skills·agents 같은 데이터형과 별도 프로세스가 맞는 `tools`·`mcp`·`lsp` 선언은 서비스 없이 그대로 쓴다.

## 이 폴더의 파일

| 파일 | 쓰임 |
|---|---|
| `litecode-service.d.ts` | 번들을 쓸 때 타입. cordis 를 설치하지 않아도 된다 |
| `plugin-service.schema.json` | `plugin.json` 편집기 완성·경고(inject·events·api 값, `service` 권한 짝) |
| `litecode-service-testing.mjs` · `.d.mts` | 앱 없이 번들을 시험하는 가짜 host |

모두 **생성물**이라 손으로 고치지 않는다. 원본은 `shared/extensions/serviceApi.ts`(허용 목록·소식 표)와 `serviceHostCore.ts`·`serviceHostFake.ts`이고, `node scripts/generate-plugin-sdk.mjs` 가 만든다. 원본과 어긋나면 `tests/unit/scripts/generate-plugin-sdk.test.ts` 가 실패한다.
플러그인 저장소는 옆의 `../desktop/docs/plugin-sdk/` 를 복사해 쓴다(desktop 은 두기만 하고 쓰지 않는다).

## 서비스 번들 만들기

`plugin.json`:

```json
{
  "id": "my-plugin",
  "version": "0.1.0",
  "litecode": "<이 기능이 들어간 앱 최소 버전>",
  "scope": "project",
  "entry": "panel.html",
  "permissions": ["service", "chat"],
  "service": { "main": "service.mjs", "api": 1, "inject": ["projects"], "events": ["chat.turnEnded"] }
}
```

- `service` 와 `service` 권한은 **같이만** 쓴다. `main` 은 플러그인 폴더 안의 `.mjs` 한 파일이다.
- `api` 는 호스트 API 버전(지금 1). 앱이 모르는 큰 값이면 설치가 거절된다. 앱 최소 버전은 기존 최상위 `litecode` 를 쓴다.
- `scope` 를 생략하면 프로젝트별(켠 프로젝트의 소식만 받는다). 앱 전체는 `"app"`.
- 기본은 꺼져 있고, 켤 때 사용자가 동의한다.

번들은 **cordis 를 가져오지 않는다.** 호스트가 넘기는 `host` 로 만든다(`import type` 은 된다).

```ts
import type { ServiceBundle, ServiceContext } from './litecode-service'

const bundle: ServiceBundle = (host) =>
  class TurnCounter extends host.Service {
    static inject = ['projects'] as const // manifest 의 service.inject 와 같게
    private readonly turns = new Map<string, number>()

    constructor(ctx: ServiceContext) {
      super(ctx)
      ctx.on('chat.turnEnded', ({ directory, outcome }) => {
        if (directory === undefined || outcome !== 'done') return
        this.turns.set(directory, (this.turns.get(directory) ?? 0) + 1)
      })
      this.expose('count', (_params, { directory }) => ({ turns: directory === undefined ? 0 : (this.turns.get(directory) ?? 0) }))
    }
  }

export default bundle
```

- 생성자에서 던지면 그 서비스는 올라오지 않고 `failed` 로 남는다(다른 서비스는 간다). 선언하지 않은 소식을 `ctx.on` 하면 던진다.
- 번들은 **한 파일**이고 올릴 때 앱이 그 바이트를 자료 폴더의 사본(`.service-cache/<해시>.mjs`)으로 옮겨 올린다. 그래서 `import.meta.url` · `import.meta.dirname` 기준의 상대 경로나 옆 파일 import 는 설치 폴더를 가리키지 않는다 — 자산(wasm · JSON 등)은 host 가 알려 주는 플러그인 폴더(`host.dir`)에서 읽는다.
- 빌드는 한 파일 ESM 이다 — `esbuild --bundle --format=esm --platform=node` 로 `service.mjs` 를 만든다. cordis 를 가져오지 않으니 external 설정은 필요 없다.
- 코드와 `plugin.json` 은 따로 적는다 — 타입이 코드 쪽(`ctx.on` 이름, `inject`)을 잡아 주고, `plugin-service.schema.json` 이 JSON 쪽을 잡아 준다. 둘이 어긋나면 올릴 때 분명한 오류가 난다.

## 상태는 어디에 두나

패널과 서비스가 같은 값을 따로 쓰면 나중에 쓴 쪽이 이긴다. 둘 중 하나를 고른다.

1. **권장: 서비스가 상태를 들고, 패널은 `service.call` 로만 읽는다.** 패널은 그 상태를 자기 저장소에 쓰지 않는다.
2. 둘 다 써야 하면 **키를 나눈다.** 서비스 몫과 패널 몫이 같은 키를 쓰지 않게 한다.

패널이 부르는 길은 `service.call`(`{ name, params }`)과 `service.list` 다. 서비스가 내려가 있거나 그 프로젝트에서 꺼져 있으면 실패 코드(`service-off` · `not-on`)가 오니, 패널은 화면용 마지막 값을 자기 키에 따로 둘 수 있다. `expose` 한 값은 JSON 으로 오가므로 함수·순환 값은 줄 수 없다.
서비스용 영구 저장소(`host.storage`)는 아직 없다 — 호스트에 생기면 이 안내와 가짜 host 에 같이 더한다. 지금은 서비스 안에 메모리로 들고, 필요한 만큼만 `host.settings()` 의 설정 칸을 쓴다.

## 프로젝트 자원은 projectOn · ctx.effect 로 되돌린다

- `projectOn(directory)`: 그 프로젝트에서 서비스가 **켜졌을 때** 불린다(`scope: "app"` 서비스에는 불리지 않는다). 돌려준 함수를 프로젝트가 꺼질 때, 서비스가 내려갈 때 부른다. 타이머·감시·연결은 여기서 잡고 그 함수로 놓는다.
- `ctx.effect(() => () => 정리)`: 서비스 자신의 정리다. 서비스가 내려갈 때(끄기·다시 설치·앱 종료) 불린다. `ctx.on` 으로 건 소식은 번들이 해제 함수를 안 불러도 같이 풀린다.
- 정리는 **1초 안에** 끝낸다. 안 끝나면 호스트가 기다리지 않고 넘어간다(앱 종료 8초 기한을 지키려고). 던져도 다른 서비스·앱에는 새지 않는다.

## 되올림 예산 (번들 크기)

설치·다시 설치·켜기마다 번들을 새로 읽어 올린다. Node 가 모듈을 주소별로 기억해서 읽을 때마다 번들 하나만큼 메모리가 남는다(실측: 350KB 번들 20번 되올림에 힙 약 18MB).

- 번들은 **작게** 만든다. 한 파일이 **4MB 를 넘으면** 올라오지 않는다.
- 무거운 라이브러리를 통째로 묶지 않는다. 읽기·올리기는 5초 안에 끝나야 한다(최상위 `await` 가 안 끝나면 실패).

## 받을 수 있는 소식

소식 이름은 **패널의 소식과 같은 한 벌**이다. 서비스에서만 쓰는 이름은 없다.

| 이름 | 앱 안의 이름 | 받는 값 | 필요한 권한 | 프로젝트 정보 |
|---|---|---|---|---|
| `chat.turnEnded` | `chat/turn-ended` | `{ directory?, conversationId, outcome }` | `chat` | 대화가 있으면 그 작업 폴더. 모르면 프로젝트별 서비스는 못 받는다 |
| `project.filesChanged` | `llm/tool-done`(쓰기·고치기를 0.5초 묶음으로) | `{ directory?, paths, truncated? }` | `project` | 등록한 프로젝트 경로(worktree 포함) |
| `usage.changed` | `usage/changed` | `{}` | `usage` | 없음 — `scope: "app"` 서비스만 |

- 프로젝트별 서비스는 **켜진 프로젝트의 소식만** 받고, 프로젝트를 모르는 소식은 버려진다(닫힌 채 실패).
- `llm/tool-done` 은 도구 인자·결과가 새므로 직접 주지 않는다. 파일 변경은 `project.filesChanged` 로만 받는다.
- 쓸 수 있는 앱 서비스(`inject`·`ctx.get`)는 `projects` · `usage` 뿐이다(읽기용).

## 앱 기능 부르기 — host.call

파일·비밀·저장·대화·알림·mcp 같은 일은 패널이 쓰는 **호출 표를 그대로** 부른다. 새 API 가 아니라 같은 이름이고, 권한 검사(`plugin.json` 의 `permissions`)와 오류 코드도 패널과 같다.

```ts
const info = await host.call('project.info', {}, { directory }) // permissions 에 "project" 가 있어야 한다
await host.call('storage.set', { key: 'last', value: Date.now() }, { directory })
```

- 성공하면 값, 실패하면 `error.code` 를 가진 오류를 던진다(`permission-missing` · `not-on` · `no-project` · `method-unknown` · `no-window` · `network-denied` …).
- 프로젝트별(`scope: "project"`) 서비스는 `directory` 가 필요하고 그 프로젝트(worktree 폴더 포함)에서 켜져 있어야 한다. 아니면 `not-on`. 앱 전체(`"app"`) 서비스는 폴더 없이도 부른다.
- `chat.compose` · `chat.open` · `project.openFile` 은 **그 프로젝트 창이 해 준다**(앱이 창에 보내고 답을 기다린다). `chat.current` · `project.openTabs` 는 창이 값을 돌려준다. 창이 없거나 답이 없으면 `no-window` 로 거절된다.
- `panel.fullscreen`(`{ on }`) 은 그 프로젝트 오른쪽 패널에서 **이 플러그인 탭이 보이는 탭일 때** 전체 화면으로 키우고(null), `settings.open` 은 **이 플러그인 탭이 보일 때** 그 탭 위에 설정 폼을 띄워 닫힐 때 `{ saved }` 를 준다(manifest `settings` 가 있어야 한다). 보이는 탭이 없으면 조용히 성공하지 않고 `no-window` 로 거절된다.
- `network.fetch` 는 허용 목록에 있는 주소만 된다. 새 주소의 동의 띠는 서비스에는 없어서 `network-denied` 로 거절된다 — 주소는 패널·설정에서 먼저 허용한다.
- `project.pickPath` 는 부모 창 없는 파일 고르기 창을 띄운다.
- **부를 수 없는 것**: `panel.args`(패널이 파일 메뉴로 넘겨받은 값을 읽는 것 — 서비스에는 받을 탭이 없다), `events.subscribe`(서비스는 `ctx.on`), `service.call` · `service.list`(자기 자신).

## AI 도구와 MCP 서버 — host.tools · host.mcp

`permissions` 에 `"service"` 만 있으면 된다(서비스는 이미 앱과 같은 권한으로 돈다 — `tools` · `mcp` 권한은 manifest 선언이 앱에게 프로그램을 돌리게 할 때 따로 받는 것이라 여기에는 필요 없다).

```ts
// AI 도구 — 이름은 AI 에 `<플러그인 id>_search` 로 보이고, 서비스가 켜진 프로젝트에서만 보인다
const off = host.tools.register({
  name: 'search',
  description: 'Search the index.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  run: async (args, call) => `result for ${args.q} in ${call.directory}`, // call.conversation 은 알 수 있을 때만
})

// 별도 프로세스 MCP 서버 — manifest 의 mcp 와 같은 모양 · 같은 길. 오래 걸리는 일 · 비밀을 서비스 밖에서 돌릴 때
host.mcp.register({ command: 'bin/server.js', args: ['${dataDir}'], env: { TOKEN: '${secret:token}' } })
```

- 도구 이름은 소문자·숫자·`-`·`_`(첫 글자 소문자, 40자 이하). 같은 이름을 두 번 올리거나 manifest `tools` 에 이미 있는 이름이면 던진다. 모양이 틀려도 던진다.
- 서비스가 내려가면 올린 도구와 서버 선언은 모두 걷힌다. 돌려준 함수로 먼저 걷을 수도 있다.
- MCP 서버는 플러그인에 하나다(manifest 에 `mcp` 가 있으면 못 올린다). 실행 파일은 설치 폴더 기준이고 첫 도구 호출 때 뜨며 쉬면 내려간다.

`host.mcp.register` 로 올린 서버는 manifest `mcp` 선언과 같은 길로 다뤄진다 — 단, 서비스가 떠서 `register` 를 부른 동안만 있다.

- **AI 도구 이름**: 서버가 알려 준 도구가 `attach` 에 따라 보인다. 기본(`litecode`)은 앱 MCP 한 곳 안에 `<플러그인 id>_<도구>` 로 올라 AI 에는 `litecode_<플러그인 id>_<도구>` 로 보인다. `attach: 'server'` 이면 플러그인 id 이름의 MCP 서버로 따로 붙고 도구 이름은 서버가 준 그대로라 AI 에는 `<플러그인 id>_<도구>` 로 보인다(사용자가 같은 이름의 서버를 이미 만들어 두었으면 `litecode` 쪽으로 붙는다. 플러그인 id 가 `litecode` 면 `server` 는 못 쓴다). `panelTools` 와 `settingsCheck` 도구는 AI 에 안 보인다.
- **`host.call('mcp.call' | 'mcp.status')`**: `permissions` 의 `service` 만으로 **자기 서비스가 올린 서버**를 부른다(`mcp` 권한 불필요, manifest `mcp` 선언 불필요). 서버를 올리기 전에는 `permission-missing`. 다른 플러그인의 서버는 부를 수 없다. `mcp.call` 은 서버의 어느 도구든 부르고(`panelTools` 와 무관), 결과는 `{ text, isError }`.
- **`[연결 확인]`(`settingsCheck`)**: manifest 에 `settings` · `settingsCheck`(도구 이름)를 두고 `service` 권한이 있으면 manifest `mcp` 없이도 쓸 수 있다. 서버를 올린 뒤의 설치된 플러그인(패널 · 설정 폼 · `settings.check`)에서 그 서버로 확인한다. **설치 2단계 폼은 서비스가 아직 안 떠 있어서** 서버 선언을 알 수 없어 `[연결 확인]` 을 쓰지 못한다(설치 뒤 설정 화면에서 된다).
- **비밀 값**: 서비스는 비밀을 읽지 못한다 — `host.call('secrets.get')` 은 서비스에서 `method-unknown` 이다(`secrets.set` · `secrets.delete` 는 된다). 비밀을 쓰는 서비스의 유일한 길은 manifest `settings` 에 `type: "secret"` 칸을 선언하고, 서버 `env` 에 `${secret:키}` 를 적어 자식 프로세스에만 넘기는 것이다. 패널도 서버 `env`(manifest · 서비스 등록 모두)의 `${secret:}` 키와 `secret` 설정 칸의 키는 `secrets.get` 으로 읽지 못한다(`secret-write-only`).

## 패널에 밀어 보내기 — host.panel.emit

서비스가 **자기 플러그인의 패널**에 소식을 보낸다(다른 플러그인 패널에는 가지 않는다). 폴링이 필요 없다.

```ts
host.panel.emit('progress', { done: 3, total: 10 }) // 서비스 → 패널
host.panel.emit('progress', { done: 4, total: 10 }, { directory }) // 그 프로젝트의 패널에만
```

패널은 기존 `events.subscribe` 로 받는다 — 이름에 `service.` 가 붙고(앱 소식 이름과 겹치지 않는다) 권한은 `service` 다.

```js
await litecode.call('events.subscribe', { events: ['service.progress'] })
// 받는 메시지: { litecode: 1, event: 'service.progress', data: { done: 3, total: 10 } }
```

- 값은 JSON 으로 오가는 것만(순환·BigInt 는 던진다), 64KB 이하(넘으면 던진다). 초당 20번을 넘으면 **말없이 버린다** — 마지막 값이 중요하면 서비스가 모아서 보낸다.
- 서비스가 내려간 뒤의 보내기는 버려진다.

## 바깥 요청 — host.fetch

```ts
const response = await host.fetch('https://api.example.com/items', { method: 'GET' })
const items = JSON.parse(await response.text())
```

`host.call('network.fetch')` 를 `Response` 로 감싼 것이라 규칙이 같다: `permissions` 에 `network` 가 있어야 하고, 사용자가 허용한 주소만 되며(없으면 `network-denied`, `error.origin` 에 주소 — 패널로 알려 주면 된다), GET · POST(글 본문), 헤더는 `content-type` 만 온다. 프로젝트별(`scope: "project"`) 서비스는 `host.call` 처럼 `{ directory }` 가 필요하다(`host.fetch(url, { directory })`).

**설치 검사가 번들을 훑는다.** 번들 글자에 `fetch(` · `new WebSocket` · `node:http` · `https` · `http2` · `net` · `tls` · `dns` · `dgram` · `undici` 를 쓴 흔적이 있으면 설치가 거절된다(`service-network-direct`). 올릴 때도 같은 점검을 한다. 글자 점검이라 완전하지 않고(일부러 가린 코드는 못 잡는다), 반대로 `fetch(` 라는 이름의 메서드도 걸릴 수 있다 — 그때는 이름을 바꾼다.

## 앱 없이 가짜 host 로 시험하기

```ts
import { createFakeHost } from './litecode-service-testing.mjs'
import bundle from './service.mjs' // 또는 빌드 전 소스

const fake = createFakeHost({ scope: 'project', events: ['chat.turnEnded'], inject: ['projects'] })
fake.enableProject('/work/a') // projectOn 을 진짜처럼 부른다
fake.mount(bundle)
await fake.emit('chat.turnEnded', { directory: '/work/a', conversationId: 'c1', outcome: 'done' })
await fake.emit('chat.turnEnded', { directory: '/work/b' }) // 켜지지 않은 프로젝트 — 버려진다
expect(await fake.call('count', undefined, { directory: '/work/a' })).toEqual({ turns: 1 })
fake.disableProject('/work/a') // projectOn 이 돌려준 해제 함수를 부른다
await fake.dispose() // 해제 함수·ctx.effect 정리·소식 구독 해제
```

가짜 host 는 진짜 호스트와 **같은 논리**(소식을 켜진 프로젝트로 거르기, 프로젝트를 모르는 소식 버리기, 선언 밖 소식 거절)를 쓰고, 같은 시나리오 표가 같은 결과를 내는지 desktop 테스트가 확인한다. 다만 이런 것은 흉내 내지 않는다.

- 프로젝트 폴더의 worktree 작업 폴더를 등록 프로젝트로 알아보는 일(진짜 호스트만).
- 패널 통로가 하는 `not-on` 검사(그 프로젝트에서 꺼진 서비스를 패널이 부르면 실패) — `fake.call` 은 부르는 대로 부른다.
- `host.call` 의 값: 앞문(허용 목록 · `scope` 의 `not-on`)만 진짜와 같고, 돌려줄 값은 `createFakeHost({ calls: { 'project.info': () => … } })` 로 준다. 권한(`permissions`)·창 응답은 흉내 내지 않는다. 부른 기록은 `fake.calls`.
- `host.tools` · `host.mcp`: 가짜 host 는 이름·모양 검사와 올림·걷기만 같다. 도구는 `fake.tools()` · `fake.callTool(이름, 인자, { directory })`(그 프로젝트에서 켜진 때만), 서버는 `fake.mcpServers()` 로 보고 띄우지는 않는다.
- `host.panel.emit` 은 패널에 가지 않고 `fake.pushes()` 에 쌓인다(이름 검사 · JSON 복사 · 64KB · 초당 20번은 진짜와 같다).
- `static inject` 가 manifest 밖 키를 쓰는지 따지는 일.
- 1초 정리 기한·읽기 기한.

## 안 되는 것

- **허용 밖 서비스**: `inject`·`ctx.get` 은 `projects` · `usage` 만이다. 설정·모델·엔진·계정·기능 묶음 서비스·다른 플러그인의 서비스는 설치 때 거절되고, 코드에서 닿으려 해도 `ctx` 에 없다.
- **`ctx` 의 나머지**: `root` · `emit` · `scope` · `fiber` 는 없다. 쓸 수 있는 것은 `on` · `get` · `effect` · `logger` 와 시간 도우미(`setTimeout` · `setInterval` · `sleep`)다.
- **직접 네트워크 요청**: 서비스는 앱과 같은 프로세스에서 같은 권한으로 돈다. 번들이 `fetch` 를 직접 부르는 것은 **호스트가 런타임에 막지 못한다.** 그래서 바깥 요청은 `host.fetch` 로만 하게 하고, 설치 검사가 번들의 글자로 직접 요청 흔적을 거절한다(완전하지 않다). 최종 강제는 해시 고정 · 기본 꺼짐 · 동의 · 서명 · 코드 리뷰가 맡는다.
- 허용 목록은 보안 경계가 아니라 **실수를 막는 가드레일**이다. 보안은 출처 확인·기본 꺼짐·동의·해시로 지킨다.
