[← 가이드 목록](../README.md)

# 서비스 플러그인 만들기

패널을 닫아 둬도 앱 안에서 계속 도는 코드를 플러그인에 싣습니다. 앱 소식 받기 · 상태 쌓기 · AI 도구 올리기가 이 길입니다. 코드를 가진 플러그인은 서비스 한 길로 가는 중입니다(결정 기록: desktop 이슈 #1614).

*약 30분 · 권한: service(+ 쓰는 앱 기능) · 빌드: build.mjs*

## 처음 만든다면 — 5분 시작

서비스 플러그인(코드를 가진 플러그인)을 처음부터 끝까지 한 번 돌려 봅니다.

1. **`dev` 에서 브랜치를 땁니다.** `git switch dev && git pull && git switch -c feat/<이름>` — PR 은 `dev` 로 보내고 `main` 에는 직접 올리지 않습니다(`main` · `dev` 직접 push 는 훅이 막습니다. [작업 흐름](https://github.com/kim-taehan/lite-harness-plugins/blob/dev/.claude/rules/workflow.md)).
2. **뼈대를 만듭니다.** `npm ci`(처음 한 번) 뒤 `npm run new-plugin -- <id> --name "<이름>" [--scope app|project]`. `plugins/<id>/` 에 `plugin.json` · `service/index.mjs` · `build.mjs` · 패널 `index.html` · `tests/service.test.ts` · `README.md` 가 생기고, 새 id 는 `categories.json` 에 `unlisted` 로 적혀 release 에 실수로 나가지 않습니다.
3. **앱 없이 시험합니다.** `npm test -- --project <id>` — 가짜 host 로 서비스를 시험합니다.
4. **앱에 연결해 고칩니다.** `node plugins/<id>/build.mjs --dir` 로 `build/<id>/` 를 낸 뒤, 앱의 설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결] 로 그 폴더를 연결합니다(개발 모드는 개발 실행 `npm run dev` 나 플러그인 개발자용 설치본에서만 있습니다). 고친 뒤 `build.mjs --dir` 를 다시 돌리면 앱이 1초 조용해진 뒤 다시 읽습니다. 막히면 [막혔을 때](troubleshooting.md).
5. **올립니다.** 커밋 전에 `/convention-review` 로 표준과 대조하고, PR 을 `dev` 로 보냅니다(`gh pr create --base dev`). 목록에 내는 배포는 승격 때 따로 합니다 — [저장소로 내보내기](publish.md).

자세한 설명은 아래 각 절에 있습니다.

## 만들 것

실제 플러그인 [token-pet(빛톨 키우기)](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/token-pet)의 코드를 단계마다 발췌하며 같은 모양을 만듭니다. 따라 만들 때는 이름만 바꿔 쓰세요.

- **서비스**가 사용량 소식(`usage.changed`)을 받아 먹이를 계산하고 저장합니다. 패널이 닫혀 있어도 쌓입니다.
- **패널**은 서비스에 `service.call` 로 묻고, 서비스가 밀어 보내는 `service.update` 소식으로 다시 그립니다.
- **AI 도구** `persona` · `say` 를 서비스가 직접 올립니다(별도 서버 프로세스 없음).

## 준비물

- [첫 패널 플러그인](first-panel.md)을 읽었으면 좋습니다 (manifest 규칙 · zip 설치)
- Node.js 22+ 와 이 저장소 (`npm ci` — esbuild · vitest 가 들어 있습니다)
- 앱의 서비스 지원 버전 (서비스를 모르는 앱은 `service` 선언을 모르는 필드로 보고 설치를 거절합니다)

## 서비스가 무엇이고 언제 쓰나

서비스는 플러그인 zip 에 들어 있는 **번들 한 파일**(`service.mjs`)입니다. 앱이 켜 있는 동안 앱 프로세스 안에서 올라와 돌고, 끄거나 지우면 내려갑니다. 패널(iframe)과 달리 탭이 열려 있지 않아도 삽니다.

| 이런 일이면 | 이렇게 |
|---|---|
| 화면만 그린다 (순수 UI) | 서비스 없이 패널만 — [첫 패널 가이드](first-panel.md) |
| 패널을 닫아도 소식을 받아 쌓는다 · 프로젝트가 켜질 때 자원을 잡는다 | **서비스** |
| AI 가 부르는 가벼운 도구 | 서비스의 `host.tools.register` |
| 오래 걸리는 일 · 비밀 · 네이티브 드라이버 | 서비스가 **별도 프로세스 MCP 서버**를 등록 — [MCP 가이드](mcp-plugin.md) |

서비스는 앱과 **같은 프로세스에서 같은 권한으로** 돕니다. 동기 무한 루프 하나가 앱 전체를 멈출 수 있고, 허용 목록은 실수를 막는 가드레일이지 보안 경계가 아닙니다. 보안은 출처 확인 · 해시 · 동의가 맡으니, 오래 걸리는 일은 서비스에 넣지 말고 MCP 서버로 뺍니다.

## 1. plugin.json

`plugins/token-pet/plugin.json` (details 는 줄임)

```json
{
  "id": "token-pet",
  "name": "빛톨 키우기",
  "description": "AI 에 쓴 토큰만큼 자라는 도트 몬스터 — 누르거나 말을 걸면 성격대로 대답합니다",
  "version": "0.3.0",
  "entry": "index.html",
  "scope": "app",
  "permissions": ["service", "usage", "chat"],
  "skills": ["skills/token-pet"],
  "service": { "main": "service.mjs", "api": 1, "events": ["usage.changed"] }
}
```

| 필드 | 규칙 |
|---|---|
| `service` | 선언과 `service` 권한은 **같이만** — 한쪽만 있으면 거절(`service-mismatch`). `main` 은 플러그인 폴더 안의 `.mjs` **한 파일** |
| `service.api` | 호스트 API 버전(1 이상 정수). 앱이 아는 값보다 크면 거절(`service-incompatible`) |
| `service.inject` | 읽을 앱 서비스 키 — `projects` · `usage` 뿐(읽기용) |
| `service.events` | 받을 앱 소식 — 아래 [4번](#4-앱-소식-받기)의 이름만, 필요한 권한이 같이 있어야 합니다 |
| `scope` | 서비스 플러그인은 생략하면 프로젝트별입니다. 새 플러그인은 표준 20번에 따라 꼭 적습니다. 프로젝트 정보가 없는 소식(`usage.changed`)을 받으려면 `"app"` |
| `permissions` | `service` + 서비스가 `host.call` 로 부르는 기능의 권한(패널과 같은 표 — `usage` · `chat` · `project` 등, AI 에게 묻기는 `llm`) + 받는 소식의 권한 |
| `litecode` | 선택. 이 기능이 들어간 앱 최소 버전 |
| 쓰지 못하는 것 | `type: "locale"` · `"grammar"` 와 `service` 는 같이 못 씁니다 |

`mcp` · `tools` 권한은 서비스가 `host.tools` · `host.mcp` 로 올릴 때는 필요 없습니다(서비스 권한 하나로 됩니다).

`plugin.json` 은 편집기에서 `sdk/plugin-service.schema.json` 으로 맞출 수 있습니다. 모르는 필드는 설치 거절입니다(표준 3번).

## 2. 서비스 번들

진입점은 `export default (host) => class … extends host.Service` 한 함수입니다. 번들은 **cordis 를 가져오지 않습니다** — 필요한 것은 모두 앱이 넘기는 `host` 로 옵니다. 타입은 `sdk/litecode-service.d.ts` 한 파일입니다(`import type` 만 됩니다).

`plugins/token-pet/service/index.mjs` (발췌 — 전체는 원본)

```js
import '../game.js'
import '../persona.js'

const G = globalThis.TOKEN_PET_GAME
/** 사용량 소식을 놓쳐도 이 시간마다 한 번은 읽는다 */
const SAFETY_POLL_MS = 60_000

export default (host) =>
  class TokenPet extends host.Service {
    state = G.fresh()
    /** 사용량 읽기를 한 줄로 세운다 — 기준(baseline)이 겹쳐 두 번 먹이지 않게 */
    queue = Promise.resolve()

    constructor(ctx) {
      super(ctx)
      this.loaded = this.load()
      this.first = this.loaded.then(() => this.poll())
      ctx.on('usage.changed', () => void this.poll())
      const timer = setInterval(() => void this.poll(), SAFETY_POLL_MS)
      ctx.effect(() => () => clearInterval(timer))
      …
```

- **생성자에서 던지면** 그 서비스는 올라오지 않고 `failed` 로 남습니다(다른 서비스는 갑니다). 선언하지 않은 소식을 `ctx.on` 하면 던집니다.
- 쓸 수 있는 `ctx` 는 `on` · `get` · `effect` · `logger` 와 시간 도우미(`setTimeout` · `setInterval` · `sleep`)입니다. `root` · `emit` · `scope` · `fiber` 는 없습니다.
- `host` 로 오는 것: `host.Service` · `host.id` · `host.call` · `host.panel` · `host.tools` · `host.mcp` · `host.fetch` · `host.settings` · `host.enabledIn` · `host.projects` · `host.locale` · `host.skills` · `host.agents` · `host.lsp` · `host.db`(호스트 API 2 앱만 — [3-1](#3-1-문서-저장소--hostdb)).
- 게임 규칙 같은 공유 코드(`game.js`)는 `import` 하면 번들에 같이 묶입니다. 한 파일이어야 하므로 **옆 파일을 실행 때 읽는 코드**(`import.meta.url` · `import.meta.dirname` 기준 경로)는 쓰지 못합니다 — 앱이 번들 바이트를 자료 폴더의 사본에서 올리기 때문입니다.

## 3. 상태는 서비스가 들고 패널은 읽는다

패널과 서비스가 같은 값을 따로 쓰면 나중에 쓴 쪽이 이깁니다. 하나를 고릅니다.

1. **권장 — 서비스가 상태를 들고, 패널은 `service.call` 로만 읽습니다.** 패널은 그 상태를 자기 저장소에 쓰지 않습니다. token-pet 이 이 방식입니다(패널이 예전에 쓰던 `storage` 키 `state` 를 서비스가 그대로 이어받아 키우던 빛톨이 이어집니다).
2. 둘 다 써야 하면 **키를 나눕니다.** 서비스 몫과 패널 몫이 같은 키를 쓰지 않게 합니다.

작은 영구 값은 `host.call('storage.get' | 'storage.set', { key, … })` 로 패널과 같은 저장 칸에 두고(JSON, 전체 64KB), 설정 칸 값은 `host.settings()` 로 읽습니다. 목록으로 쌓고 조건으로 찾고 지워야 하는 자료(이력 · 색인 · 상태)는 문서 저장소 `host.db` 에 둡니다(아래 [3-1](#3-1-문서-저장소--hostdb)). 서비스가 내려가 있거나 그 프로젝트에서 꺼져 있으면 패널이 받는 실패 코드(`service-off` · `not-on`)에 대비해, 패널은 화면용 마지막 값을 자기 키에 따로 둘 수 있습니다.

### 3-1. 문서 저장소 — host.db

플러그인마다 따로 쓰는 JSON 문서 저장소입니다(**베타**, 호스트 API 2 — desktop #1701). 자세한 규칙은 `sdk/README.md` 의 "문서 저장소 — host.db", 타입은 `sdk/litecode-service.d.ts` 가 정본입니다.

```js
const at = { directory } // 프로젝트별(scope: "project") 서비스는 늘 넘긴다
await host.db.set('runs', runId, { suite: 'login', at: Date.now(), ok: true }, at)
const doc = await host.db.get('runs', runId, at) // 없으면 null
const page = await host.db.query('runs', { where: [{ field: 'suite', op: '=', value: 'login' }], orderBy: { field: 'at', dir: 'desc' }, limit: 20 }, at)
// { docs: [{ id, doc }], cursor? } — cursor 가 있으면 다음 호출에 그대로 넘긴다
await host.db.batch([{ op: 'set', collection: 'runs', id: newId, doc }, { op: 'delete', collection: 'runs', id: oldId }], at) // 원자적, 최대 50 연산
const { bytes, docs, limits } = await host.db.usage(at)
```

- **서비스 전용입니다.** 패널은 `service.call` 로 서비스에 맡기고, `host.mcp.register` 로 올린 **MCP 서버 프로세스는 `host` 가 없어 따로 클라이언트로 씁니다**(아래). 권한은 따로 없습니다(`storage` 와 같은 급).
- **범위:** 플러그인마다 따로, 프로젝트별 서비스는 프로젝트(실제 경로)마다 또 따로입니다. 플러그인을 지우면 같이 지워지고 업데이트 · 재설치로는 지워지지 않습니다.
- **한도:** 문서 하나 256KB · 컬렉션 20개 · 컬렉션당 문서 50,000개 · 플러그인 총 200MB · `list`/`query` 한 번 최대 200개(기본 50) · `batch` 50 연산. 넘으면 `ServiceCallError` 의 `code`(`doc-too-big` · `collection-limit` · `collection-full` · `db-full`). 그 밖에 `params-invalid` · `no-project` · `not-on`.
- **조건:** `=` `!=` `<` `<=` `>` `>=` `in` `prefix`(모두 AND), 정렬 필드 하나, `cursor` 로 이어 읽기(건너뛰기가 아니라 마지막 값 뒤부터).
- **느려지는 때:** 색인 선언이 없습니다. id 순 `list` 와 조건 · 정렬 없는 `query` 는 기본키를 타 문서가 많아도 1ms 안쪽이지만, 조건이나 `orderBy` 를 주면 컬렉션을 훑어 크기에 비례합니다(문서 ~1KB 5만 개 34~58ms, ~2KB 면 쪽당 약 200ms). **조회는 앱 메인 프로세스에서 동기로 돌아 그동안 앱 전체가 멈춥니다.** 큰 컬렉션은 id 를 시각으로 시작하게 지어(`2026-11-10T09-00-00_<번호>`) `list` 의 id 순이 곧 시간순이 되게 하고, `query` 를 연달아 부르지 않습니다.
- **깨지면 빈 채로 다시 시작합니다**(앱이 옆으로 치움). 그래서 다시 만들 수 있는 색인 · 이력 · 상태만 둡니다. 사람이나 AI 가 쓴 원본(시나리오 · 결과서)은 지금처럼 파일입니다.
- **옛 앱에는 없습니다.** `service.api: 2` 를 적으면 옛 앱(api 1)에서 설치가 거절됩니다(`service-incompatible`). 옛 앱에서도 돌아야 하면 `api: 1` 로 두고 `if (host.db)` 로 확인해 대체 길로 물러납니다.
- **서버(MCP) 프로세스에서 쓰기**(desktop #1707, 베타): 서비스가 `host.mcp.register` 로 올린 서버를 앱이 띄울 때 환경변수 `LITECODE_DB_URL` · `LITECODE_DB_TOKEN` 을 준다(앱 안 `127.0.0.1` 중계, 서버를 처음 부를 때 늦게 열림). 번호표는 **플러그인 + 그 서버의 프로젝트 폴더** 의 저장소에만 닿고 서버가 사는 동안만 유효하다. `sdk/litecode-db-client.mjs` 를 **서버 번들 옆에** 두고 쓴다(서비스 번들과 한 파일로 묶지 않는다 — 설치 검사가 `fetch(` 를 거절한다).
  ```js
  import { createDbClient } from './litecode-db-client.mjs'
  const db = createDbClient() // 환경변수가 없으면 undefined — 앱 밖 직접 실행 · CI · 옛 앱 · 프로젝트 없이 도구 목록만 물을 때
  if (db) await db.set('runs', runId, { at: Date.now(), ok: true }) // directory 인자는 없다(번호표가 정함)
  else { /* 파일 같은 대체 길 */ }
  ```
  `db.get/set/delete/list/query/batch/usage` 는 서비스의 `host.db` 와 같은 모양 · 한도 · 오류 코드다. 오류는 `DbClientError`(`.code`): 서비스와 같은 코드에 `unauthorized`(서버가 내려간 뒤 · 번호표 틀림) · `rate-limited` · `request-too-large` · `unreachable` · `aborted`. 토큰당 초당 1,000번이 넘으면 클라이언트가 `Retry-After` 만큼 기다려 최대 3번 다시 시도하니, 문서를 하나씩 수천 번 부르지 말고 `list`/`query`/`batch` 를 쓴다.
- **주의:** 서버가 자식 프로세스를 띄울 때 환경변수를 그대로 넘기지 않는다(토큰이 따라간다 — 필요한 것만 골라 넘긴다). 로그 · 오류에 토큰을 찍지 않는다. 앱 안에서 AI 가 도구를 불러 서버가 쓰는 종단 확인과 Windows 는 desktop 에서도 확인하지 못했다.
- 가짜 host(`createFakeHost`)가 같은 `host.db` 를 메모리로 흉내 냅니다(한도 시험은 `createFakeHost({ dbLimits: { totalBytes: 1000 } })`).

## 4. 앱 소식 받기

소식 이름은 **패널의 소식과 한 벌**입니다. 서비스에서만 쓰는 이름은 없습니다. `plugin.json` 의 `service.events` 에 적은 것만 `ctx.on` 할 수 있습니다.

| 이름 | 받는 값 | 필요한 권한 | 프로젝트 정보 |
|---|---|---|---|
| `chat.turnEnded` | `{ directory?, conversationId, outcome }` (`done` · `interrupted` · `failed`) | `chat` | 대화가 있으면 그 작업 폴더. 모르면 프로젝트별 서비스는 못 받음 |
| `project.filesChanged` | `{ directory?, paths, truncated? }` (쓰기 · 고치기 도구가 쓴 파일, 0.5초 묶음) | `project` | 등록한 프로젝트 경로(worktree 포함) |
| `usage.changed` | `{}` | `usage` | 없음 — `scope: "app"` 서비스만 |

- **프로젝트별 서비스는 켜진 프로젝트의 소식만** 받고, 프로젝트를 모르는 소식은 버려집니다(닫힌 채 실패).
- 도구 인자 · 결과가 새지 않도록 `llm/tool-done` 은 직접 주지 않습니다. 파일 변경은 `project.filesChanged` 로만 받습니다.
- 소식은 놓칠 수 있다고 보고, token-pet 처럼 느린 안전 폴링(60초)을 하나 두면 안전합니다. 폴링 타이머는 `ctx.effect` 로 걷습니다(아래 [8번](#8-정리와-크기)).

## 5. 앱 기능 부르기 — host.call

파일 · 저장 · 대화 · 설정 · mcp 같은 일은 패널이 쓰는 **호출 표를 그대로** 부릅니다. 새 API 가 아니라 같은 이름이고, 권한 검사(`permissions`)와 오류 코드도 패널과 같습니다.

`plugins/token-pet/service/index.mjs` (발췌)

```js
// 말 걸기 — 새 대화에 "빛톨아, " 를 채워 연다
this.expose('talk', (_params, { directory }) => host.call('chat.compose', { text: '빛톨아, ', send: false }, { directory }))

// 전체 화면 — 서비스가 그 패널 탭에 열고 닫는다(패널이 보이는 탭일 때만 된다)
this.expose('fullscreen', (params, { directory }) => host.call('panel.fullscreen', { on: params?.on === true }, { directory }))
```

- 성공하면 값, 실패하면 `error.code` 를 가진 오류를 던집니다(`permission-missing` · `not-on` · `no-project` · `method-unknown` · `no-window` · `network-denied` …).
- 프로젝트별(`scope: "project"`) 서비스는 `{ directory }` 가 필요하고 그 프로젝트에서 켜져 있어야 합니다(아니면 `not-on`). 앱 전체(`"app"`) 서비스는 폴더 없이도 부릅니다.
- `chat.compose` · `chat.open` · `project.openFile` · `panel.fullscreen` · `settings.open` 은 **그 프로젝트 창이 해 줍니다**. 창이 없거나 그 플러그인 탭이 보이는 탭이 아니면 조용히 성공하지 않고 `no-window` 로 거절됩니다.
- 바깥 요청은 `host.fetch`(`host.call('network.fetch')` 를 `Response` 로 감쌈)로만 합니다 — `network` 권한과 사용자가 허용한 주소만 됩니다.
- **서비스에서 못 부르는 것:** `secrets.get`(`method-unknown`), `panel.args`, `events.subscribe`(대신 `ctx.on`), `service.call` · `service.list`(자기 자신).

### 5-0. 프로젝트 밖으로 저장 — project.exportFile

결과서 · PDF 처럼 **프로젝트 안에 만들어 둔 파일 하나**를 사용자가 저장 창에서 고른 곳에 내보냅니다(desktop #1711, 호스트 API 2 — 옛 앱에는 없음).

```js
// 서버가 프로젝트 안(예: ui-tests/_reports/<수행>/report.pdf)에 PDF 를 만들어 두고 그 경로를 서비스에 돌려주면, 서비스가 부른다
const result = await host.call('project.exportFile', { path: 'ui-tests/_reports/20261110T110500_01/report.pdf', name: '결과서.pdf' }, { directory })
// { saved: true, name: '결과서.pdf' }  또는 사용자가 취소하면 { saved: false }
```

- **서비스 전용입니다.** 패널과 MCP 서버 프로세스는 부르지 못합니다 — 패널은 `service.call` 로 맡기고, 서버는 파일을 만든 뒤 경로를 서비스에 넘깁니다. 새 권한은 없고 `project` 권한이면 됩니다.
- `path` 는 프로젝트 폴더 기준 상대 경로, `name` 은 저장 창에 보일 제안 이름입니다(경로 구분자 · 제어 문자 · Windows 불가 문자는 앱이 지우고 80자로 줄이되 확장자는 남깁니다).
- **사용자가 고른 경로 한 곳에만** 씁니다 — 플러그인이 목적지를 정할 수 없고, 돌려받는 것도 저장된 파일의 **이름뿐**입니다(고른 전체 경로는 알려 주지 않습니다).
- **원본 조건:** 프로젝트 안의 일반 파일이어야 하고(`..` · 절대 경로 · 밖을 가리키는 링크 · 디렉터리 · 특수 파일은 거절) 100MB 이하입니다. 사용자가 고른 뒤 복사 직전에 원본을 다시 검사하고, 목적지 폴더의 임시 파일에 쓴 뒤 이름을 바꿔 넣으므로 중간에 실패해도 기존 파일이 잘리지 않습니다.
- **실패 코드:** `params-invalid` · `no-project` · `not-file`(일반 파일이 아니거나 없음) · `path-outside` · `too-big` · `busy`(같은 플러그인의 저장 창이 이미 열려 있음 — 동시에 하나) · `export-limit`(분당 6번 초과) · `io-failed` · `not-on` · `permission-missing`.
- **옛 앱 대응:** 이 호출이 없는 앱에서는 실패가 나므로 저장 버튼을 숨기거나 안내합니다.
- 가짜 host 에서는 `createFakeHost({ calls: { 'project.exportFile': () => ({ saved: true, name: 'report.pdf' }) } })` 로 흉내 냅니다.

### 5-1. AI 에게 한 번 묻기 — llm.ask

서비스가 앱의 기본 모델에 **글 하나를 묻고 답 글을 받는** 호출입니다(요약 · 분류 · 짧은 글 만들기). 대화 턴을 만들지 않고, AI 는 도구를 쓰지 못하고 글로만 답합니다. **베타**입니다.

`plugins/<id>/service/index.mjs` (예)

```js
// 실패 코드를 사용자가 읽을 말로 — 서비스가 돌려주고 패널이 그대로 보여 준다
const ASK_MESSAGES = {
  'llm-off': 'AI 사용이 꺼져 있어요 — 설정 › 플러그인에서 이 플러그인의 "AI 에게 묻기" 를 켜 주세요',
  'no-model': '앱에 기본 모델이 정해져 있지 않아요',
  'llm-limit': '잠시 뒤에 다시 해 주세요 — 한 번에 2개, 1분에 10번까지예요',
  'llm-timeout': 'AI 가 60초 안에 답하지 않았어요',
  'llm-failed': 'AI 가 답하지 못했어요',
  'prompt-too-long': '묻는 글이 너무 길어요(32KB까지) — 줄여서 다시 해 주세요',
  'answer-too-long': '답이 너무 길어요(32KB 넘음) — 더 짧게 답하게 해 주세요',
  'permission-missing': '이 플러그인에 "llm" 권한이 없어요 — 다시 설치해 권한을 허락해 주세요',
  'no-project': '프로젝트 폴더를 알 수 없어요',
}

this.expose('summarize', async (params, { directory }) => {
  try {
    const { text } = await host.call('llm.ask', { prompt: `다음 글을 세 줄로 요약해 줘:\n${params.text}` }, { directory })
    return { ok: true, text }
  } catch (error) {
    return { ok: false, message: ASK_MESSAGES[error.code] ?? 'AI 에게 묻지 못했어요' }
  }
})
```

- **권한:** manifest `permissions` 에 `llm` 을 적습니다(없으면 `permission-missing`). 설치 동의 창에 권한 설명이 보입니다. 서비스 전용이라 **패널(iframe)은 부르지 못합니다** — 패널은 `service.call` 로 서비스에 맡깁니다.
- **directory:** 그 프로젝트 폴더를 `{ directory }`(세 번째 인자)로 넘깁니다. 없으면 `no-project` 입니다. 앱 전체(`scope: "app"`) 서비스도 같습니다 — 등록된 프로젝트 폴더를 `directory` 로 주면 씁니다. `expose` 메서드는 부른 패널의 `{ directory }` 를 두 번째 인자로 받으니 그대로 넘기면 됩니다.
- **모델:** 앱의 기본 모델이고 고를 수 없습니다.
- **막아 둔 것과 실패 코드** — 위 예처럼 코드마다 사용자에게 보일 말을 정해 둡니다:

| 코드 | 언제 |
|---|---|
| `no-model` | 앱에 기본 모델이 없음 |
| `llm-off` | 사용자가 설정 › 플러그인 카드의 "AI 에게 묻기" 를 끔(기본은 켜짐) |
| `llm-limit` | 플러그인마다 1분에 10번 초과, 또는 동시 3개째(동시에는 2개까지) |
| `prompt-too-long` · `answer-too-long` | 묻는 글 · 답이 32KB 초과 |
| `llm-timeout` | 60초 안에 답이 없음 |
| `llm-failed` | AI 가 답하지 못함 |

- **주의:** 실패 · 시간 초과도 횟수에 셉니다 — 실패하면 바로 다시 부르는 반복문을 만들지 않습니다. 32KB 는 크기 상한일 뿐 **AI 사용 비용의 상한이 아닙니다**. 큰 자료는 쪼개서 묻습니다. 사용자의 대화와 같은 모델 · 게이트웨이를 나눠 쓰므로 꼭 필요할 때만 부릅니다.
- **시험:** 가짜 host 에서는 `createFakeHost({ calls: { 'llm.ask': () => ({ text: '…' }) } })` 로 흉내 냅니다. 실패 코드를 처리하는 쪽은 `calls` 에서 `Object.assign(new Error('x'), { code: 'llm-off' })` 를 던지게 해 봅니다(아래 [앱 없이 시험하기](#10-앱-없이-시험하기)).

## 6. 패널과 말하기 — service.call · panel.emit

서비스는 패널이 부를 메서드를 `expose` 로 내고, 패널은 `service.call` 로 부릅니다. 서비스가 패널에 알릴 일은 `host.panel.emit` 으로 밀어 보냅니다. 폴링이 필요 없습니다.

`plugins/token-pet/service/index.mjs` (발췌)

```js
// 패널이 service.call 로 부르는 것 — 두 번째 인자 { directory? } 는 부른 패널의 프로젝트(모르면 없음)
this.expose('state', async () => {
  await this.first
  return this.snapshot()
})

/** 패널에 지금 모습을 밀어 보낸다 — extra.event(먹이 · 부화 · 진화 · 졸업) 가 있으면 패널이 반응을 한다 */
push(extra = {}) {
  host.panel.emit('update', { ...this.snapshot(), ...extra })
}
```

`plugins/token-pet/index.html` (발췌 — 패널)

```js
const serviceCall = (name, params) => call('service.call', { name, params })   // call() 은 첫 패널 가이드의 앱 통로

// 서비스가 밀어 보낸 소식 — 이름에 service. 가 붙는다
function onEvent(event, data) {
  if (event === 'service.update') apply(data)
}
…
;(async () => {
  try { await call('events.subscribe', { events: ['service.update'] }) } catch { /* 권한 없음 */ }
  try { apply(await serviceCall('state')) } catch (error) {
    document.getElementById('error').textContent = '빛톨 서비스가 켜져 있지 않습니다 — 설정 › 기능 › 플러그인에서 빛톨 키우기를 켜 주세요.'
  }
})()
```

- 패널이 받는 답은 앱 통로의 보통 모양입니다: `{ litecode: 1, id, ok: true, result }` 또는 `{ …, ok: false, error }`. `service.call` 의 `result` 가 서비스가 돌려준 값이고, 서비스가 던지면 패널에는 코드 `service-failed` 만 갑니다(글은 로그에만).
- `expose` 한 값은 JSON 으로 오가므로 함수 · 순환 값은 줄 수 없습니다. 서비스가 켜져 있지 않으면 `service-off`, 그 프로젝트에서 꺼져 있으면 `not-on`, 이름이 없으면 `service-unknown` 입니다.
- 패널이 오류 **코드**로 안내를 고르게 하려면 서비스가 코드를 값에 실어 돌려줍니다. sql-tuning 이 이 방식입니다(`{ ok: true, value } | { ok: false, code }`).
- `host.panel.emit(name, data, { directory? })` — 이름에 `service.` 가 붙어 패널이 `events.subscribe(['service.<이름>'])` 로 받습니다(권한 `service`). 값은 JSON 으로 오가는 것만, 64KB 이하(넘으면 던짐), 초당 20번을 넘으면 **말없이 버립니다** — 마지막 값이 중요하면 서비스가 모아서 보냅니다. 서비스가 내려간 뒤의 보내기는 버려집니다.
- 패널은 구독이 iframe 이 살아 있는 동안만이라 **시작할 때마다 구독**하고 `state` 를 한 번 묻습니다.

## 7. AI 도구 — host.tools 와 host.mcp

**가벼운 도구**는 서비스가 직접 올립니다. 권한은 `service` 하나면 됩니다.

`plugins/token-pet/service/index.mjs` (발췌)

```js
host.tools.register({
  name: 'persona',
  description:
    "Get the user's current pet (빛톨): its name, species, stage, nature, today's food and mood, and the speaking rules for its voice. Call this before answering as the pet.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => {
    await this.first
    return this.persona()
  },
})
```

- AI 에는 `<플러그인 id>_<도구>`(여기서 `token-pet_persona`)로 보이고, 서비스가 켜진 프로젝트에서만 보입니다(`scope: "app"` 이면 늘). 이름은 소문자·숫자·`-`·`_`, 첫 글자 소문자, 40자 이하이고 같은 이름을 두 번 올리거나 manifest `tools` 와 겹치면 던집니다.
- `run(args, { directory, conversation? })` 이 돌려준 글이 모델에게 갑니다. 던지면 그 메시지가 실패로 갑니다. 도구 설명은 모델이 읽는 글이라 **영어**로 씁니다.
- 돌려준 함수로 먼저 걷을 수 있고, 서비스가 내려가면 모두 걷힙니다.
- 이 도구를 쓰는 스킬은 도구 이름을 위 규칙대로 적습니다(`skills/token-pet/SKILL.md` 가 `token-pet_persona` 를 부릅니다).

**오래 걸리는 일 · 비밀 · 네이티브 드라이버**는 서비스가 별도 프로세스 MCP 서버를 등록합니다 — `host.mcp.register({ command, args?, env?, idleMs?, timeoutMs?, panelTools?, attach? })`. manifest `mcp` 와 같은 모양 · 같은 길이고 플러그인에 서버는 하나입니다. 비밀은 설정 `secret` 칸 + `${secret:키}` → `env` 로만 자식 프로세스에 가고, 도구 이름은 기본 `litecode_<id>_<도구>`(`attach: "server"` 면 `<id>_<도구>`)입니다. 자세한 것은 [MCP 가이드](mcp-plugin.md).

## 8. 정리와 크기

- **`ctx.effect(() => () => 정리)`** — 서비스 자신의 정리입니다. 끄기 · 다시 설치 · 앱 종료 때 불립니다. 타이머 · 감시는 여기서 걷습니다. `ctx.on` 으로 건 소식은 해제 함수를 안 불러도 같이 풀립니다.
- **`projectOn(directory)`** — 프로젝트별 서비스가 그 프로젝트에서 **켜졌을 때** 불립니다(`scope: "app"` 에는 불리지 않음). 돌려준 함수를 프로젝트가 꺼질 때, 서비스가 내려갈 때 부릅니다. 프로젝트 몫 자원(타이머 · 캐시 · 열린 파일)은 여기서 잡고 그 함수로 놓습니다.
- 정리는 **1초 안에** 끝냅니다. 안 끝나면 호스트가 기다리지 않고 넘어갑니다(앱 종료 8초 기한을 지키려고). 던져도 다른 서비스 · 앱에는 새지 않습니다.
- **번들은 한 파일, 4MB 이하**입니다(넘으면 올라오지 않음). 올릴 때 읽기는 5초 안에 끝나야 합니다(최상위 `await` 가 안 끝나면 실패).
- **되올림 메모리**: 설치 · 다시 설치 · 켜기마다 번들을 새로 읽어 올리는데, Node 가 모듈을 주소별로 기억해 읽을 때마다 번들 하나만큼 메모리가 남습니다(실측: 350KB 번들 20번에 힙 약 18MB). 번들을 작게 만들고 무거운 라이브러리는 통째로 묶지 않습니다. 개발 모드로 자주 고칠 때도 같습니다 — 가끔 앱을 다시 띄웁니다.

## 9. build.mjs 로 묶기

서비스 원본과 공유 스크립트를 esbuild 로 `service.mjs` 한 파일로 묶습니다. cordis 를 가져오지 않으니 external 설정은 필요 없습니다. `--dir` 을 받아 zip 과 같은 내용을 `build/<id>/` 폴더로 내야 합니다(표준 17번) — 앱의 개발 모드에서 이 폴더를 연결해 바로 확인합니다([첫 패널 가이드의 4번](first-panel.md#4-고치면서-바로-확인하기)).

`plugins/token-pet/build.mjs` (발췌)

```js
await build({
  entryPoints: [path.join(here, 'service/index.mjs')],
  outfile: path.join(stage, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
for (const name of ['plugin.json', 'index.html', 'game.js', 'persona.js', 'skills']) cpSync(path.join(here, name), path.join(stage, name), { recursive: true })
const out = path.join(root, 'build', process.argv.includes('--dir') ? 'token-pet' : 'token-pet.zip')
```

터미널 (저장소 맨 위에서)

```sh
node plugins/token-pet/build.mjs          # → build/token-pet.zip
node plugins/token-pet/build.mjs --dir    # → build/token-pet/ (개발 모드에서 연결할 폴더)
```

- 패널이 `<script src>` 로 싣는 파일(`game.js` · `persona.js`)은 zip 에 따로 넣습니다. 서비스가 `import` 한 것은 번들 안에 있으니 zip 에 또 넣을 필요가 없습니다.
- 번들 글자에 `fetch(` · `new WebSocket` · `node:http` · `https` · `net` · `tls` · `dns` · `undici` 같은 직접 네트워크 흔적이 있으면 설치가 거절됩니다(`service-network-direct`). 바깥 요청은 `host.fetch` 로만 합니다(폐쇄망 원칙, 표준 7번). 이름이 `fetch` 인 메서드도 걸릴 수 있으니 그때는 이름을 바꿉니다.

## 10. 앱 없이 시험하기

`sdk/litecode-service-testing.mjs` 의 `createFakeHost` 가 진짜 호스트와 **같은 논리**(소식을 켜진 프로젝트로 거르기 · 프로젝트를 모르는 소식 버리기 · 선언 밖 소식 거절)를 흉내 냅니다. `sdk/` 는 desktop 의 `docs/plugin-sdk/` 를 복사한 **생성물**이라 손으로 고치지 않습니다. 서비스는 앱이 올리는 묶음과 같게 **esbuild 로 묶어서** 시험합니다.

`plugins/token-pet/tests/service.test.ts` (발췌)

```ts
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const fake = createFakeHost({
  id: 'token-pet',
  scope: 'app',
  events: ['usage.changed'],
  calls: {                                         // host.call 이 돌려줄 값 — 여기 없는 메서드는 io-failed
    'storage.get': (params) => store.get((params as { key: string }).key) ?? null,
    'storage.set': (params) => void store.set((params as { key: string }).key, (params as { value: unknown }).value),
    'usage.summary': () => summary(usage.tokens, usage.cacheRead),
  },
})
fake.mount(bundle)
await fake.emit('usage.changed')                   // 앱이 소식을 냈다
expect(fake.names().sort()).toEqual(['fullscreen', 'setBg', 'state', 'talk'])
expect(fake.tools().map((t) => t.name).sort()).toEqual(['token-pet_persona', 'token-pet_say'])
const pushes = fake.pushes().filter((p) => p.event === 'service.update')   // host.panel.emit 으로 밀어 보낸 것
```

| 쓰는 곳 | 하는 일 |
|---|---|
| `fake.mount(bundle)` | 번들의 기본 내보내기로 서비스를 만든다 |
| `fake.emit(이름, 값)` · `fake.call(이름, 인자, { directory })` | 앱 소식 · 패널의 `service.call` 을 흉내 낸다 |
| `fake.callTool(이름, 인자, { directory })` · `fake.tools()` · `fake.mcpServers()` | `host.tools` · `host.mcp` 로 올린 것을 본다(서버는 띄우지 않는다) |
| `fake.pushes()` · `fake.calls` | `host.panel.emit` 한 것 · `host.call` 한 기록 |
| `fake.enableProject(dir)` · `fake.disableProject(dir)` | `projectOn` 을 진짜처럼 부른다 |
| `fake.dispose()` | 해제 함수 · `ctx.effect` 정리 · 소식 구독 해제 |

흉내 내지 않는 것: worktree 폴더를 등록 프로젝트로 알아보는 일 · 패널 통로의 `not-on` 검사 · 권한(`permissions`) 검사 · 창 응답 · 1초 정리 기한 · `static inject` 가 manifest 밖 키를 쓰는지. **앱이 서비스를 올리고 패널이 실제로 주고받는 것은 앱에서 확인**합니다. 테스트는 `npm test -- --project <id>` 입니다.

## 11. 설치하고 켜기

1. 설정 › 기능 › 플러그인 › [플러그인 추가 (zip)] 으로 `build/<id>.zip` 을 고릅니다.
2. 설치 확인창에 권한과 "앱 안에서 직접 실행됩니다" 안내가 보입니다. 서비스는 기본이 꺼져 있고 켤 때 사용자가 동의하는데, **확인창에서 출처를 확인하고 동의한 뒤 설치하면 그 자리에서 켜집니다.**
3. 올릴 때마다 번들 바이트의 sha256 을 설치 때 기록과 대조합니다. 디스크에서 몰래 바뀐 파일은 올리지 않습니다.
4. 업데이트에서 **권한 · `inject` · `events` · `api` · `scope` 가 바뀌거나 서비스를 새로 담으면 다시 동의**를 받습니다(그때까지 꺼짐). 이전 방식(옛 manifest)으로 깔린 플러그인을 같은 id 의 서비스 플러그인으로 바꿀 때도 같습니다.
5. 개발 모드(폴더 연결)는 재동의 없이 이어 갑니다. 서비스 플러그인은 원본이 아니라 **빌드한 폴더**를 연결합니다.

## 못 하는 것 · 함정

| 안 되는 것 | 이유 · 대신 |
|---|---|
| `inject` · `ctx.get` 에 `projects` · `usage` 밖의 키 | 설정 · 모델 · 엔진 · 계정 · 기능 묶음 서비스 · 다른 플러그인의 서비스는 설치 때 거절되고 `ctx` 에 없다 |
| `host.call('secrets.get')` | 서비스는 비밀을 읽지 못한다. 비밀은 설정 `secret` 칸 + `${secret:}` → MCP 서버 `env` 로만 |
| 옆 파일 읽기 · `import.meta.url` 기준 경로 | 번들은 한 파일이고 자료 폴더의 사본에서 올라온다 |
| 서비스에서 직접 `fetch` · WebSocket · `node:http` | 호스트가 런타임에 막지는 못하지만 설치 검사가 글자로 거절한다. `host.fetch` 를 쓴다 |
| 안 끝나는 정리 · 동기 무한 루프 | 정리는 1초 뒤 버려지고, 동기 루프는 앱 전체를 멈춘다. 오래 걸리는 일은 MCP 서버로 |
| 서비스에서 AI 를 직접 부르기 | 대화를 열어 입력창을 채우는 것(`chat.compose`)까지. 대답은 스킬 + AI 도구가 한다 |
| 패널이 안 보일 때 `panel.fullscreen` · `settings.open` | 보이는 탭이 아니면 `no-window` |

## 정리

서비스 하나로 소식 받기 · 상태 쌓기 · 패널과 말하기 · AI 도구까지 담은 플러그인을 만들고, 한 파일로 묶어 가짜 host 로 시험했습니다. token-pet 의 [원본](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/token-pet)이 이 가이드의 전체 모양입니다.

## 다음

- [MCP 플러그인 만들기](mcp-plugin.md) — 오래 걸리는 일 · 비밀을 별도 프로세스로
- [첫 패널 플러그인](first-panel.md) — 패널 쪽 (가운데 탭 · 파일 우클릭 · 같은 zip 의 파일)
- [막혔을 때 — 오류 원인 · 해결](troubleshooting.md) — 설치 거절 · 호출 실패 코드
- [저장소로 내보내기](publish.md) — `dev` 에서 브랜치 · 올리기 · 버전 · `npm run release -- --changed`
