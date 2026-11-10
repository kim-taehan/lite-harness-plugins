# 플러그인 서비스 작성 안내

플러그인이 패널을 닫아도 계속 도는 코드(소식을 받아 쌓기, 프로젝트가 켜질 때 자원 잡기)가 필요하면 **서비스**로 만든다. 코드를 가진 플러그인은 서비스 한 길이다(결정 기록: 이슈 #1614).
예외는 없다 — 언어 팩·문법 팩·스킬·에이전트·AI 도구·MCP 서버·언어 서버도 서비스가 `host.*.register` 로 올린다. 옛 manifest 선언 길(`locale` · `grammars` · `tools` · `mcp` · `lsp` · `skills` · `agents` · `type`)과 권한 `tools` · `mcp` · `lsp` 는 **폐지됐다**(이슈 #1642) — manifest 에 적으면 모르는 필드 · 모르는 권한으로 설치가 거절된다.

## 이 폴더의 파일

| 파일 | 쓰임 |
|---|---|
| `litecode-service.d.ts` | 번들을 쓸 때 타입. cordis 를 설치하지 않아도 된다 |
| `plugin-service.schema.json` | `plugin.json` 편집기 완성·경고(inject·events·api 값, `service` 권한 짝) |
| `litecode-service-testing.mjs` · `.d.mts` | 앱 없이 번들을 시험하는 가짜 host |
| `litecode-db-client.mjs` · `.d.mts` | 서비스가 올린 MCP 서버 프로세스에서 `host.db` 를 쓰는 클라이언트(서버 번들용) |

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

패널이 부르는 길은 `service.call`(`{ name, params }`)과 `service.list` 다(그 밖에 화면 전용 표면 `panel.fullscreen` · `settings.open` · `panel.notify` · `panel.args` · `chat.current` 와 소식 받기 `events.subscribe`). 서비스가 내려가 있거나 그 프로젝트에서 꺼져 있으면 실패 코드(`service-off` · `not-on`)가 오니, 패널은 화면용 마지막 값을 자기 키에 따로 둘 수 있다. `expose` 한 값은 JSON 으로 오가므로 함수·순환 값은 줄 수 없다.
서비스가 이력·요약·상태를 오래 남기려면 문서 저장소 `host.db`(아래 "문서 저장소 — host.db")를 쓴다. 작은 값 몇 개는 `host.settings()` 의 설정 칸이나 `host.call('storage.get' · 'storage.set')`(64KB)로도 충분하다.

## 프로젝트 자원은 projectOn · ctx.effect 로 되돌린다

- `projectOn(directory)`: 그 프로젝트에서 서비스가 **켜졌을 때** 불린다(`scope: "app"` 서비스에는 불리지 않는다). 돌려준 함수를 프로젝트가 꺼질 때, 서비스가 내려갈 때 부른다. 타이머·감시·연결은 여기서 잡고 그 함수로 놓는다.
- `ctx.effect(() => () => 정리)`: 서비스 자신의 정리다. 서비스가 내려갈 때(끄기·다시 설치·앱 종료) 불린다. `ctx.on` 으로 건 소식은 번들이 해제 함수를 안 불러도 같이 풀린다.
- 정리는 **1초 안에** 끝낸다. 안 끝나면 호스트가 기다리지 않고 넘어간다(앱 종료 8초 기한을 지키려고). 던져도 다른 서비스·앱에는 새지 않는다.

## 되올림 예산 (번들 크기)

설치·다시 설치·켜기마다 번들을 새로 읽어 올린다. Node 가 모듈을 주소별로 기억해서 읽을 때마다 번들 하나만큼 메모리가 남는다(실측: 350KB 번들 20번 되올림에 힙 약 18MB).

- 번들은 **작게** 만든다. 한 파일이 **4MB 를 넘으면** 올라오지 않는다.
- 무거운 라이브러리를 통째로 묶지 않는다. 읽기·올리기는 5초 안에 끝나야 한다(최상위 `await` 가 안 끝나면 실패).

## 받을 수 있는 소식

서비스가 받는 앱 소식 이름은 `chat.turnEnded` · `project.filesChanged` · `usage.changed` 뿐이다. 패널에는 앱 소식을 보내지 않는다 — 앱 기능은 서비스가 받아 패널에 `host.panel.emit` 으로 넘긴다.

| 이름 | 앱 안의 이름 | 받는 값 | 필요한 권한 | 프로젝트 정보 |
|---|---|---|---|---|
| `chat.turnEnded` | `chat/turn-ended` | `{ directory?, conversationId, outcome }` | `chat` | 대화가 있으면 그 작업 폴더. 모르면 프로젝트별 서비스는 못 받는다 |
| `project.filesChanged` | `llm/tool-done`(쓰기·고치기를 0.5초 묶음으로) | `{ directory?, paths, truncated? }` | `project` | 등록한 프로젝트 경로(worktree 포함) |
| `usage.changed` | `usage/changed` | `{}` | `usage` | 없음 — `scope: "app"` 서비스만 |

- 프로젝트별 서비스는 **켜진 프로젝트의 소식만** 받고, 프로젝트를 모르는 소식은 버려진다(닫힌 채 실패).
- `llm/tool-done` 은 도구 인자·결과가 새므로 직접 주지 않는다. 파일 변경은 `project.filesChanged` 로만 받는다.
- 쓸 수 있는 앱 서비스(`inject`·`ctx.get`)는 `projects` · `usage` 뿐이다(읽기용).

## 앱 기능 부르기 — host.call

파일·비밀·저장·대화·알림·mcp 같은 일은 앱의 **호출 표를 그대로** 부른다. 새 API 가 아니라 같은 이름이고, 권한 검사(`plugin.json` 의 `permissions`)와 오류 코드도 같다. 패널은 이 표를 직접 부르지 못한다 — 패널이 부를 수 있는 것은 `service.call` · `service.list` · `events.subscribe` 와 화면 전용 표면(`panel.fullscreen` · `settings.open` · `panel.notify` · `panel.args` · `chat.current`)뿐이다.

```ts
const info = await host.call('project.info', {}, { directory }) // permissions 에 "project" 가 있어야 한다
await host.call('storage.set', { key: 'last', value: Date.now() }, { directory })
```

- 성공하면 값, 실패하면 `error.code` 를 가진 오류를 던진다(`permission-missing` · `not-on` · `no-project` · `method-unknown` · `no-window` · `network-denied` …).
- 프로젝트별(`scope: "project"`) 서비스는 `directory` 가 필요하고 그 프로젝트(worktree 폴더 포함)에서 켜져 있어야 한다. 아니면 `not-on`. 앱 전체(`"app"`) 서비스는 폴더 없이도 부른다.
- `chat.compose` · `chat.open` · `project.openFile` 은 **그 프로젝트 창이 해 준다**(앱이 창에 보내고 답을 기다린다). `chat.current` · `project.openTabs` 는 창이 값을 돌려준다. 창이 없거나 답이 없으면 `no-window` 로 거절된다.
- `panel.fullscreen`(`{ on }`) 은 그 프로젝트 오른쪽 패널에서 **이 플러그인 탭이 보이는 탭일 때** 전체 화면으로 키우고(null), `settings.open` 은 **이 플러그인 탭이 보일 때** 그 탭 위에 설정 폼을 띄워 닫힐 때 `{ saved }` 를 준다(manifest `settings` 가 있어야 한다). 보이는 탭이 없으면 조용히 성공하지 않고 `no-window` 로 거절된다.
- `panel.open`(`{}`) 은 **이 플러그인 탭을 오른쪽 패널에 열거나 앞으로 가져온다**(null). 권한은 필요 없다 — 대신 사용자를 방해하지 않게 막아 둔다. ① 그 프로젝트 창이 보이고 있어야 한다(아니면 `no-window`). ② 사용자가 설정 > 플러그인 카드의 "패널 자동 열기" 를 끄면 `panel-open-off`(기본은 켜짐). ③ 같은 플러그인이 10초 안에 또 부르면 `panel-open-limit`(한 번만 연다). 횟수는 플러그인 하나에 하나(프로젝트가 둘이어도 같이 센다)이고, 창이 없어 못 연(`no-window`) 호출은 세지 않는다. ④ 사용자가 글을 쓰는 중(입력 칸 · 다른 플러그인 탭 안)이면 포커스는 빼앗지 않고 탭만 앞으로 온다. 가운데 탭(`placement: "center"`) 플러그인은 오른쪽 패널 탭이 없어 `no-window` 가 된다. 패널(iframe)은 이 호출을 쓸 수 없다(서비스 전용). 사용자가 닫아 둔 오른쪽 패널도 다시 열리고, 앱이 배경에 있어도 열린다. 이 코드들은 가짜 host 에서 `createFakeHost({ calls: { 'panel.open': () => { … } } })` 로 흉내 낸다.
- `llm.ask`(`{ prompt }`) 는 **앱의 기본 모델에 한 번 묻고 답 글을 받는다**(`{ text }`). manifest `permissions` 에 `llm` 이 있어야 하고(없으면 `permission-missing`), 모델은 고를 수 없다. AI 는 도구를 쓰지 못하고 글로만 답한다. 그 프로젝트 폴더를 `directory` 로 넘겨야 한다(없으면 `no-project`) — 앱 전체 서비스도 같다. 막아 두는 것: 기본 모델이 없으면 `no-model`, 사용자가 설정 > 플러그인 카드의 "AI 에게 묻기" 를 끄면 `llm-off`(기본은 켜짐), 플러그인마다 1분에 10번을 넘으면 `llm-limit`, 질문이 32KB 를 넘으면 `prompt-too-long`, 답이 32KB 를 넘으면 `answer-too-long`, 60초 안에 답이 없으면 `llm-timeout`, AI 가 답하지 못하면 `llm-failed`. 플러그인마다 동시에 2개까지(넘으면 `llm-limit`). 실패·시간 초과도 횟수에 센다. 질문·답 32KB 는 크기 상한일 뿐 AI 사용 비용의 상한이 아니다. 패널(iframe)은 부를 수 없다. 베타로 시작한다.
- `network.fetch` 는 허용 목록에 있는 주소만 된다. 새 주소는 이번 요청을 `consent-required`(`error.origin` 에 주소)로 거절하고 그 플러그인의 **허용 대기**에 올린다 — 설정 > 플러그인 카드에 [허용][거부] 가 보이고, 허용하면 다음 호출부터 통한다. 사용자가 거부한 주소·가득 찬 대기(주소 10개)·새 주소를 너무 자주 요청해 막힌 경우(플러그인당 한 시간에 새 주소 10개)는 `network-denied` 이다(거부한 주소는 앱을 다시 켤 때까지 다시 올리지 않는다). 가짜 host 는 `createFakeHost({ allowedOrigins: [...] })` 를 주면 그 목록 밖 주소에 `consent-required` 를 내고, `fake.allowOrigin(주소)` 로 사용자가 허용한 것처럼 바꿀 수 있다.
- `project.pickPath` 는 부모 창 없는 파일 고르기 창을 띄운다.
- `project.exportFile`(`{ path, name? }`) 은 **프로젝트 안 파일 하나를 사용자가 저장 창에서 고른 프로젝트 밖 한 곳에 복사한다**(`{ saved: true, name }`, 사용자가 취소하면 `{ saved: false }`). `path` 는 프로젝트 폴더 기준 상대 경로이고 `project` 권한이 필요하다(새 권한 없음). 호출 모양: `host.call('project.exportFile', { path: 'reports/result.pdf', name: '결과서.pdf' }, { directory })`.
  - **PDF 는 플러그인이 만든다.** 앱은 PDF 를 만들어 주지 않는다 — 서버 프로세스가 `page.pdf` 같은 것으로 프로젝트 안에 파일을 만들어 두고 그 **프로젝트 안 경로**를 서비스에 넘기면, 서비스가 이 호출로 저장 창을 띄운다. 내용을 직접 넘기는 방식은 없다. **서버(MCP) 프로세스에서는 이 호출을 못 부른다** — host 는 서비스만 갖는다.
  - 목적지는 사용자가 저장 창에서 고른 한 곳뿐이다(덮어쓰기 확인은 OS 창). 플러그인이 목적지를 정할 수 없고, `name` 은 **제안 이름**일 뿐이다 — 경로 구분자·제어 문자·Windows 에서 못 쓰는 글자(`\ / : * ? " < > |`)는 지우고, 80자로 줄이고, 남는 것이 없으면 원본 파일 이름을 쓴다. 저장 창의 확장자 필터는 원본 확장자에서 만든다.
  - **고른 전체 경로는 돌려주지 않는다.** 프로젝트 밖 경로(홈 폴더·사용자 이름)가 플러그인에 새지 않도록 `name` 에 저장된 파일 이름만 준다.
  - 원본은 `project.readFile` 과 같은 검사를 받는다 — 프로젝트 실제 위치 안의 **일반 파일**이어야 한다. `..`·절대 경로·프로젝트 밖으로 나가는 심볼릭 링크는 `path-outside`, 없음·폴더·특수 파일·링크는 `not-file`, 100MB 를 넘으면 `too-big`. 내용은 메모리에 올리지 않고 복사한다(`readFile` 의 256KB 한도와 상관없다).
  - 실패 코드: `params-invalid` · `not-file` · `path-outside` · `too-big` · `no-project`(`directory` 없음) · `permission-missing` · `busy`(같은 플러그인의 저장 창이 이미 떠 있다 — 한 번에 하나) · `export-limit`(플러그인마다 1분에 6번을 넘음 — 창이 뜬 횟수만 센다) · `io-failed`(복사 실패 — 디스크·권한, 저장 창을 못 띄운 경우) · `not-on`(프로젝트별 서비스가 그 프로젝트에서 꺼짐). 사용자가 끄는 설정 칸은 없다 — 창이 뜨고 사용자가 고르는 것이 동의다. 패널(iframe)은 부를 수 없다(서비스 전용). 베타로 시작한다.
  - 가짜 host 에서는 `createFakeHost({ calls: { 'project.exportFile': () => ({ saved: true, name: '결과서.pdf' }) } })` 로 흉내 낸다(저장 창 취소는 `() => ({ saved: false })`). 부른 인자는 `fake.calls` 로 본다.
- **부를 수 없는 것**: `panel.args`(패널이 파일 메뉴로 넘겨받은 값을 읽는 것 — 서비스에는 받을 탭이 없다), `events.subscribe`(서비스는 `ctx.on`), `service.call` · `service.list`(자기 자신).

## 스킬 — host.skills

```ts
// 글 · .md 파일 · 폴더 중 하나로 올린다 (경로는 플러그인 폴더 기준)
host.skills.register({ name: 'my-skill', content: '---\nname: my-skill\ndescription: …\n---\n본문' })
host.skills.register({ name: 'my-skill', path: 'skills/my-skill.md' })
const off = host.skills.register({ name: 'review-guide', dir: 'skills/review-guide' }) // SKILL.md 와 references/ 같은 딸린 파일이 든 폴더
```

- `dir` 폴더에는 `SKILL.md` 가 있어야 하고(frontmatter 의 `name` 이 올리는 이름과 같고 `description` 이 있어야 한다), 안의 파일은 하위 폴더까지 통째로 앱 스킬 폴더(`<이름>/`)에 놓인다 — 모델이 `references/…` 를 읽는다.
- 플러그인 폴더 밖 경로 · 링크(경로 중간이나 폴더 안 포함) · 파일 하나 512KB 초과 · 2000개 초과는 던진다. 이름은 소문자·숫자·`-`(2~41자), 같은 서비스에서 이름이 겹쳐도 던진다. 다른 출처가 같은 이름을 먼저 놓았으면 그쪽이 이긴다.
- 서비스가 켜지지 않은 프로젝트의 턴에서는 스킬이 숨고, 서비스가 내려가면 놓인 폴더도 걷힌다. 엔진은 도는 턴이 끝난 뒤 목록을 다시 읽는다.
- 서비스가 올린 스킬에 문서를 얹으려면 아래 `host.skills` 의 덧씌움 메서드를 쓴다.

### 사용자 문서를 스킬에 얹기 — host.skills.readFile · writeFile · deleteFile

`register({ dir })` 로 올린 폴더형 스킬의 `references/` 같은 하위 경로에 사용자가 준 문서(예: 사내 표준)를 얹는다. 모델은 스킬 폴더의 그 경로를 읽는다.

```ts
await host.skills.writeFile('review-guide', 'references/company-rules.md', text, { directory }) // 프로젝트별 서비스는 directory 가 필요하다
const now = await host.skills.readFile('review-guide', 'references/company-rules.md') // 얹은 글, 없으면 스킬 폴더에 든 원래 파일, 둘 다 없으면 undefined
await host.skills.deleteFile('review-guide', 'references/company-rules.md', { directory }) // 원래 파일(있으면)로 돌아간다
```

- 이 서비스가 `dir` 로 올린 스킬에만 된다. 경로는 `references/guide.md` 처럼 하위 폴더를 낀 `.md`(2~4단) — 폴더 밖(`..`) · 절대 경로 · `SKILL.md` · 다른 확장자는 `ServiceCallError`(`params-invalid`)다.
- 글은 비어 있지 않고 512KB 이하(`file-too-large`), 얹은 파일은 스킬마다 2000개까지(`storage-full`).
- 얹은 파일은 앱이 플러그인 자료 폴더에 두어 플러그인 업데이트 · 서비스 재시작 · 껐다 켬에도 남는다(플러그인을 지우면 같이 지워진다). 앱 스킬 폴더가 다시 만들어져도 스킬 폴더의 같은 경로 위에 다시 얹힌다. 서비스가 내려가 있는 동안에는 스킬도 얹은 파일도 모델에게 안 보인다.
- 스킬 폴더는 앱 전체의 것이라 얹은 문서도 프로젝트별이 아니다. scope `"project"` 서비스는 쓰기 · 지우기에 `directory` 가 있어야 하고 그 프로젝트에서 켜져 있어야 한다(아니면 `not-on`). 새 권한은 필요 없다.
- 바뀌면 엔진은 도는 턴이 끝난 뒤 스킬을 다시 읽는다. 가짜 host 는 얹은 글을 메모리에만 두고, 스킬 폴더에 든 원래 파일은 읽지 않는다.

## AI 도구와 MCP 서버 — host.tools · host.mcp

`permissions` 에 `"service"` 만 있으면 된다(서비스는 이미 앱과 같은 권한으로 돈다 — 옛 `tools` · `mcp` · `lsp` 권한은 폐지됐다, #1642).

```ts
// AI 도구 — 이름은 AI 에 `<플러그인 id>_search` 로 보이고, 서비스가 켜진 프로젝트에서만 보인다
const off = host.tools.register({
  name: 'search',
  description: 'Search the index.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  run: async (args, call) => `result for ${args.q} in ${call.directory}`, // call.conversation 은 알 수 있을 때만
})

// 별도 프로세스 MCP 서버 — 오래 걸리는 일 · 비밀을 서비스 밖에서 돌릴 때
host.mcp.register({ command: 'bin/server.js', args: ['${dataDir}'], env: { TOKEN: '${secret:token}' } })
```

- 도구 이름은 소문자·숫자·`-`·`_`(첫 글자 소문자, 40자 이하). 같은 이름을 두 번 올리면 던진다. 모양이 틀려도 던진다.
- 서비스가 내려가면 올린 도구와 서버 선언은 모두 걷힌다. 돌려준 함수로 먼저 걷을 수도 있다.
- MCP 서버는 플러그인에 하나다. 실행 파일은 설치 폴더 기준이고 첫 도구 호출 때 뜨며 쉬면 내려간다.

`host.mcp.register` 로 올린 서버는 서비스가 떠서 `register` 를 부른 동안만 있다.

- **AI 도구 이름**: 서버가 알려 준 도구가 `attach` 에 따라 보인다. 기본(`litecode`)은 앱 MCP 한 곳 안에 `<플러그인 id>_<도구>` 로 올라 AI 에는 `litecode_<플러그인 id>_<도구>` 로 보인다. `attach: 'server'` 이면 플러그인 id 이름의 MCP 서버로 따로 붙고 도구 이름은 서버가 준 그대로라 AI 에는 `<플러그인 id>_<도구>` 로 보인다(사용자가 같은 이름의 서버를 이미 만들어 두었으면 `litecode` 쪽으로 붙는다. 플러그인 id 가 `litecode` 면 `server` 는 못 쓴다). `panelTools` 와 `settingsCheck` 도구는 AI 에 안 보인다.
- **`host.call('mcp.call' | 'mcp.status')`**: `permissions` 의 `service` 만으로 **자기 서비스가 올린 서버**를 부른다(`mcp` 권한 불필요). 서버를 올리기 전에는 `permission-missing`. 다른 플러그인의 서버는 부를 수 없다. `mcp.call` 은 서버의 어느 도구든 부르고(`panelTools` 와 무관), 결과는 `{ text, isError }`.
- **서비스가 올리는 실행 파일**: `host.mcp.register` · `host.lsp.register` 로 올리는 동봉 바이너리·셸 스크립트(`.mjs` 가 아닌 것)는 **zip 안에서 실행 비트를 가져야** 한다. 설치는 zip 에 실행 비트가 있던 일반 파일만 그대로 살리고(0o755), 없던 파일은 그대로 둔다. 심볼릭 링크와 플러그인 폴더 밖 경로는 지금처럼 거절한다.
- **`[연결 확인]`(`settingsCheck`)**: manifest 에 `settings` · `settingsCheck`(도구 이름)를 두고 `service` 권한이 있으면 쓸 수 있다. 서버를 올린 뒤의 설치된 플러그인(패널 · 설정 폼 · `settings.check`)에서 그 서버로 확인한다. **설치 2단계 폼은 서비스가 아직 안 떠 있어서** 서버 선언을 알 수 없어 `[연결 확인]` 을 쓰지 못한다(설치 뒤 설정 화면에서 된다).
- **비밀 값**: 서비스는 비밀을 읽지 못한다 — `host.call('secrets.get')` 은 서비스에서 `method-unknown` 이다(`secrets.set` · `secrets.delete` 는 된다). 비밀을 쓰는 서비스의 유일한 길은 manifest `settings` 에 `type: "secret"` 칸을 선언하고, 서버 `env` 에 `${secret:키}` 를 적어 자식 프로세스에만 넘기는 것이다. 패널도 서버 `env`(manifest · 서비스 등록 모두)의 `${secret:}` 키와 `secret` 설정 칸의 키는 `secrets.get` 으로 읽지 못한다(`secret-write-only`).

## 패널에 밀어 보내기 — host.panel.emit

서비스가 **자기 플러그인의 패널**에 소식을 보낸다(다른 플러그인 패널에는 가지 않는다). 폴링이 필요 없다.

```ts
host.panel.emit('progress', { done: 3, total: 10 }) // 서비스 → 패널
host.panel.emit('progress', { done: 4, total: 10 }, { directory }) // 그 프로젝트의 패널에만
```

패널은 `events.subscribe` 로 받는다 — 이름에 `service.` 가 붙고 권한은 `service` 다. 앱 소식 이름은 받을 수 없다(`event-unknown`).

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

`host.call('network.fetch')` 를 `Response` 로 감싼 것이라 규칙이 같다: `permissions` 에 `network` 가 있어야 하고, 사용자가 허용한 주소만 되며(없으면 `consent-required`, `error.origin` 에 주소 — 허용 대기에 올라 사용자가 카드에서 정한다. 거부했으면 `network-denied`), GET · POST(글 본문), 헤더는 `content-type` 만 온다. 프로젝트별(`scope: "project"`) 서비스는 `host.call` 처럼 `{ directory }` 가 필요하다(`host.fetch(url, { directory })`).

**설치 검사가 번들을 훑는다.** 번들 글자에 `fetch(` · `new WebSocket` · `node:http` · `https` · `http2` · `net` · `tls` · `dns` · `dgram` · `undici` 를 쓴 흔적이 있으면 설치가 거절된다(`service-network-direct`). 올릴 때도 같은 점검을 한다. 글자 점검이라 완전하지 않고(일부러 가린 코드는 못 잡는다), 반대로 `fetch(` 라는 이름의 메서드도 걸릴 수 있다 — 그때는 이름을 바꾼다.

## 문서 저장소 — host.db

이력·요약·상태처럼 목록으로 쌓고 조건으로 찾고 지워야 하는 자료를 두는 곳이다(**베타** — 한도는 써 보며 조정한다). 작은 값 몇 개는 `storage`(64KB 하나)로 충분하다. 이 저장소는 `storage` 를 대체하지 않는다.

```ts
await host.db.set('runs', runId, { suite: 'login', at: Date.now(), ok: true }, { directory })
const doc = await host.db.get('runs', runId, { directory }) // 없으면 null
await host.db.delete('runs', runId, { directory })

// 조건 조회 — 최신순 20개
const page = await host.db.query('runs', {
  where: [{ field: 'suite', op: '=', value: 'login' }, { field: 'at', op: '>=', value: since }],
  orderBy: { field: 'at', dir: 'desc' },
  limit: 20,
}, { directory })
// { docs: [{ id, doc }], cursor? } — cursor 가 있으면 더 있다
await host.db.list('runs', { limit: 50, cursor: page.cursor }, { directory }) // id 순 목록

// 한꺼번에 — 원자적: 하나라도 안 되면 아무것도 안 된다(최대 50 연산)
await host.db.batch([
  { op: 'set', collection: 'runs', id: newId, doc },
  { op: 'delete', collection: 'runs', id: oldestId },
], { directory })

const { bytes, docs, collections, limits } = await host.db.usage({ directory }) // db-full 이 나기 전에 스스로 오래된 것을 지운다
```

`host.db.get` · `set` · `delete` · `list` · `query` · `batch` · `usage` 는 `host.call('db.get' …)` 위의 얇은 막이다(`host.fetch` 와 같다). **서비스 전용**이라 패널은 직접 부르지 못한다 — 패널은 `service.call` 로 서비스에 맡긴다. `host.mcp.register` 로 올린 MCP 서버 프로세스(별도 프로세스)는 `host` 가 없으니 아래 "서버(MCP) 프로세스에서 쓰기" 의 클라이언트로 쓴다. 권한은 따로 없다(`storage` 와 같은 급).

**범위.** 플러그인마다 따로 — 다른 플러그인의 문서는 열 길이 없다. `scope: "project"` 서비스는 프로젝트(실제 경로)마다 또 따로이고 `{ directory }` 가 있어야 한다(없으면 `host.call` 과 같이 `not-on`). `scope: "app"` 서비스는 하나다. 프로젝트 폴더를 옮기면 새 프로젝트로 보인다(다른 프로젝트별 자료와 같은 한계).

**문서와 이름.** 문서는 JSON 객체다(`{ … }`, 배열·글·숫자 하나는 안 된다). 컬렉션 이름은 `A-Za-z0-9_.-` 64자 이하, 문서 id 는 같은 글자로 128자 이하. 컬렉션은 문서를 처음 쓸 때 생기고 문서가 하나도 없으면 없는 것으로 센다. `set` 은 같은 id 를 통째로 바꾼다. 없는 문서를 `delete` 해도 오류가 아니다.

**조건.** 연산자는 `=` `!=` `<` `<=` `>` `>=` `in` `prefix` 뿐이고 조건은 모두 AND 다(부분 일치 `contains` 는 없다 — 느린 전체 훑기를 부르기 쉽다). 필드는 점 경로(`meta.size`, 깊이 5까지, 마디는 글자나 `_` 로 시작하는 `A-Za-z0-9_`)이고 값은 글·숫자·참거짓이다.
- 필드가 없거나 `null`·객체·배열이면 어떤 조건에도 맞지 않는다(`!=` 도). 값의 종류가 다르면(글 필드에 숫자 조건) 맞지 않는다.
- 글은 코드 포인트 순으로 비교하고, 참거짓은 `=` `!=` `in` 만 쓴다. `in` 은 같은 종류의 값 100개까지, `prefix` 는 글 필드의 앞부분(대소문자 구분).
- 정렬은 필드 하나(`orderBy`) — 값이 없는 문서가 먼저, 그다음 숫자·참거짓, 글 순이고 같으면 id 순이다. 정렬을 안 주면 id 순. 조건은 10개까지.
- `limit` 기본 50 · 최대 200. 더 있으면 결과에 `cursor` 가 온다 — 다음 호출에 그대로 넘기되(같은 조건·같은 `orderBy` 로) 뜻은 모르는 글로 다룬다. 건너뛰기가 아니라 "마지막으로 본 정렬 값·id 바로 뒤"에서 이어 읽어서, 쪽을 넘겨도 쪽마다 느려지지 않고 이어 보는 사이 문서가 바뀌어도 겹치지 않는다(이미 지나온 자리에 새로 생긴 문서는 이번 이어 보기에 안 보인다). `cursor` 는 4096자까지라, 정렬 필드가 아주 긴 글이면 이어 보기가 `params-invalid` 로 막힌다 — 정렬 필드는 짧은 값(시각·숫자·이름)으로 둔다.
- **느려지는 때.** 이 저장소에는 색인 선언이 없다. id 순 `list` 와 정렬·조건이 없는 `query` 는 기본키 색인을 타서 문서가 많아도 1ms 안쪽이지만, **조건이나 정렬(`orderBy`)을 주면 그 컬렉션을 훑으므로 컬렉션 크기(문서 수 × 문서 크기)에 비례해 느려진다.** 앱에서 잰 값(문서 ~1KB): 1만 개 7ms · 5만 개 34ms(다음 쪽 58ms) · 10만 개 66ms(다음 쪽 135ms), 문서 ~2KB 5만 개 105ms(다음 쪽 200ms). 조건을 10개 걸면 몇 배 더 걸린다. **조회는 앱의 메인 프로세스에서 동기로 돌아서, 그 시간 동안 앱의 다른 일(대화 스트림 등)도 같이 멈춘다** — 쪽당 최대 약 200ms(문서 ~2KB 기준). 호출 횟수·시간 제한은 아직 없으니 `query` 를 연달아 부르지 말고, 큰 컬렉션은 `list` 로 쪽을 나눠 읽는다. 컬렉션이 크면 정렬·조건 `query` 대신 `list`(id 순)를 쓰거나, 서비스가 id 를 시간순으로 지어(`2026-11-10T09-00-00_<번호>`처럼 앞에 시각) id 순 그대로가 최신·오래된 순이 되게 한다.

**한도와 오류.** 넘으면 `ServiceCallError` 의 `code` 로 온다.

| 한도 | 값 | 오류 코드 |
| --- | --- | --- |
| 문서 하나(JSON 글자의 UTF-8 바이트) | 256KB | `doc-too-big` |
| 컬렉션 수(플러그인·프로젝트당) | 20개 | `collection-limit` |
| 컬렉션당 문서 수 | 50,000개 | `collection-full` |
| 플러그인 총 용량(모든 프로젝트 몫의 합, 문서 바이트 합) | 200MB | `db-full` |
| `list`·`query` 한 번 / `batch` 한 번 | 최대 200개 / 50 연산 | `params-invalid` |

그 밖에 인자 모양이 틀리면(이름·필드·연산자·값 종류·한도 밖 limit) `params-invalid`, 서비스가 꺼져 있거나 지워지는 중이면 `not-on`, 프로젝트별 서비스에 프로젝트가 없으면 `no-project`. 총 용량은 가득 차도 값을 줄이는 쓰기와 지우기는 된다. 같은 값을 `host.db.usage()` 가 알려 준다(`bytes` 는 플러그인 전체, `docs`·`collections` 는 그 프로젝트 몫, `limits` 에 한도).

**지우기와 깨짐.** 플러그인을 지우면 자료 폴더째 사라진다. 업데이트·재설치로는 지우지 않는다. 저장소 파일이 깨지면(앱을 켤 때 열다가, 또는 쓰는 중에 발견해도) 앱이 `db.sqlite.corrupt-<시각>` 으로 옆으로 치우고 빈 채로 시작한다 — 쓰는 중에 발견한 호출은 `io-failed` 로 한 번 끝나고 다음 호출부터 정상이다. 치운 파일은 최근 2개만 남긴다. 그래서 여기에는 "다시 만들 수 있는 색인·이력·상태"만 둔다.

**옛 앱에는 없다.** 이 저장소는 호스트 API 2 부터 있다(`SERVICE_API_LATEST` = 2). 옛 앱(api 1)의 `host` 에는 `db` 가 없고(`.d.ts` 에서 선택 필드), 그런 앱에 `service.api: 2` 를 적은 플러그인은 설치가 거절된다(`service-incompatible`). 옛 앱에서도 돌아야 하면 `service.api` 를 1 로 두고 `host.db` 가 있나 보고(`if (host.db)`) 파일 같은 대체 길로 물러난다.

## 서버(MCP) 프로세스에서 쓰기

`host.mcp.register` 로 올린 서버는 AI 가 도구를 직접 부르거나 CI 에서 돌아 서비스를 거치지 않는다. 이력·결과 요약을 그 서버가 만들고 읽는다면 같은 저장소를 서버 프로세스에서도 쓸 수 있다(**베타**).

앱이 `127.0.0.1` 에서만 받는 작은 중계를 두고, 서버를 띄울 때 환경변수 두 개를 준다 — `LITECODE_DB_URL`(주소) · `LITECODE_DB_TOKEN`(번호표). 번호표는 **이 플러그인 + 이 서버가 맡은 프로젝트 폴더** 의 저장소에만 닿는다(서비스의 `host.db(…, { directory })` 와 같은 몫). 서버를 띄울 때마다 새 번호표이고, 서버가 내려가면(쉬어서 내려감 · 플러그인 끔 · 지움 · 업그레이드 · 앱 종료) 곧바로 쓸 수 없게 된다. 도구 목록만 묻느라 잠깐 띄우는 서버(프로젝트 없음)에는 주지 않는다.

`docs/plugin-sdk/litecode-db-client.mjs`(타입 `.d.mts`)를 서버 번들 옆에 복사해 쓴다. 의존성이 없고 Node 22 의 `fetch` 한 겹이다. 서비스의 `host.db` 와 같은 코드·모양·오류 코드이고, 서버는 `directory` 를 주지 않는다(번호표가 정한다).

```js
import { createDbClient } from './litecode-db-client.mjs'

const db = createDbClient() // 환경변수가 없으면 undefined
if (db) {
  await db.set('runs', runId, { suite: 'login', at: Date.now(), ok: true })
  const { docs } = await db.query('runs', { orderBy: { field: 'at', dir: 'desc' }, limit: 20 })
} else {
  // 앱 밖에서 돈다(CI · 직접 실행) 또는 옛 앱 — 파일 같은 대체 길로 물러난다
}
```

- **환경변수가 없으면** `createDbClient()` 는 `undefined` 를 준다(던지지 않는다). 앱 밖에서 도는 CI · 옛 앱 · 프로젝트 없이 뜬 서버가 그렇다 — 파일 같은 대체 길을 유지한다.
- **오류**는 `DbClientError`(`error.code`)로 던진다. 서비스의 `host.db` 와 같은 코드(`params-invalid` · `not-on` · `no-project` · `doc-too-big` · `collection-limit` · `collection-full` · `db-full` · `io-failed`)에 중계 쪽 코드가 더해진다: `unauthorized`(번호표가 틀리거나 서버가 내려간 뒤) · `rate-limited` · `request-too-large` · `unreachable`(앱에 닿지 않음) · `bad-reply`. 서비스가 꺼졌거나 지워지는 중이면 `not-on` 이다.
- **한도**는 서비스와 같다(위 표). 중계가 더하는 것: 요청 본문 512KB(문서 하나의 한도 256KB 의 두 배 — `batch` 는 크면 나눠 보낸다) · 동시 연결 64개 · 헤더를 5초, 요청을 10초 안에 못 보내는 느린 연결은 끊는다(점검이 1초 주기라 최대 1초 늦을 수 있다).
- **속도**: 토큰당 초당 1,000번, 넘으면 429(`rate-limited`)이고 `Retry-After`(초)로 다음 구간까지의 시간을 알려 준다. 클라이언트는 `rate-limited` 에서만 그 시간(최대 1.5초)만큼 기다렸다가 **자동으로 최대 3번** 다시 시도하고, 그래도 안 되면 `rate-limited` 를 던진다(다른 오류는 바로 던진다). `createDbClient(env, fetch, { signal })` 의 `signal` 로 중단하면 `aborted`. 문서를 하나씩 수천 번 읽기보다 `list`/`query`/`batch` 를 쓴다. 1초 고정 구간이라 구간 경계에서 순간적으로 두 배까지 갈 수 있다(알려진 한계).
- **서버 번들에 넣는다** — 서비스 번들(`service.main`)에는 넣지 않는다. 설치 검사는 `service.main` 한 파일만 훑으므로 서버 실행 파일의 `fetch` 는 걸리지 않지만, 서비스와 한 번들로 묶으면 `service-network-direct` 로 거절된다.
- **패널**은 여전히 못 쓴다 — 서비스 전용 규칙이 그대로다.

**보안 — 한계까지.** 중계는 `127.0.0.1` 에만 바인딩하고(포트는 OS 가 고름), `POST /db/<get|set|delete|list|query|batch|usage>` 만 연다. 번호표는 상수 시간으로 비교하고, `Host` 헤더가 `127.0.0.1:<포트>` 가 아니면 거절한다(DNS 리바인딩 방어). 틀린 번호표·메서드·길·본문 모양은 상태 코드와 짧은 코드만 돌려주고, 로그에는 번호표·본문을 남기지 않는다. 한계: 번호표를 **환경변수** 로 주므로 같은 사용자의 다른 프로세스는 `ps eww` 같은 것으로 서버의 환경변수를 볼 수 있다. 그래서 번호표를 서버 수명 동안만 유효하게 하고 플러그인 하나의 저장소(그 프로젝트 몫)에만 닿게 했다 — 새어도 그 범위를 넘지 못한다. 서버가 자식 프로세스를 띄우면 환경변수가 따라가므로, 서버가 남에게 환경을 그대로 넘기지 않게 한다. 이 길은 앱이 떠 있는 동안만 열려 있고(중계 포트는 서버를 처음 띄울 때 연다), 바깥 인터넷으로는 아무것도 나가지 않는다.

**옛 앱** 에서는 환경변수가 없어 `createDbClient()` 가 `undefined` 다. 서비스의 `host.db` 가 있나 보고 물러나는 것과 같은 방식으로 대체 길을 둔다.

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
- `host.dir` 은 `createFakeHost({ dir: '/시험용/폴더' })` 로 정한다(기본 `/fake/plugin`). `host.grammars.register` 는 `scope: "app"` 만 되고(아니면 던진다) id 겹침을 보며, 올린 것은 `fake.grammars()` 로 본다(모양 · 내장 확장자 거름은 진짜 앱이 한다). `host.locale` · `skills` · `agents` · `lsp` 도 `fake.locales()` · `skills()` · `agents()` · `lspServers()` 로 본다.
- `host.db`: 가짜 host 가 메모리로 같은 `host.db` 를 흉내 낸다 — 인자 검사 · 조건 계산 · 한도 · 오류 코드는 진짜 앱과 같은 코드를 쓰고 같은 사례를 양쪽에 돌려 확인한다(프로젝트별 서비스는 `directory` 글자 그대로 이름 공간, 파일은 쓰지 않는다). 한도를 줄여 `db-full` 같은 길을 시험하려면 `createFakeHost({ dbLimits: { totalBytes: 1000 } })`. `calls: { 'db.get': … }` 로 직접 흉내 내면 그것이 먼저다.
- `host.panel.emit` 은 패널에 가지 않고 `fake.pushes()` 에 쌓인다(이름 검사 · JSON 복사 · 64KB · 초당 20번은 진짜와 같다).
- `static inject` 가 manifest 밖 키를 쓰는지 따지는 일.
- 1초 정리 기한·읽기 기한.

## 파일 쓰기 — `project.writeFile` · `project.removeFile` (권한 `projectWrite`)

**`project.writeFile` 은 프로젝트 안뿐 아니라 프로젝트 밖의 사용자 홈 폴더 아래(데스크탑 · 다운로드 · 문서 …)에도 쓴다.** 권한 동의 창에도 그렇게 보인다. 사용자가 정한 범위이니 필요한 곳에만 쓰고, 사용자 파일을 덮어쓰지 않도록 이름을 조심해라.
호출: `host.call('project.writeFile', { path, text, encoding? }, { directory })`.

- `path`: 프로젝트 폴더 기준 상대 경로(`reports/a.html`), 홈 아래 절대 경로(`/Users/me/Desktop/a.pdf`), 또는 `~/Desktop/a.pdf`. 없는 폴더는 쓸 때 만든다. 같은 이름의 파일은 덮어쓴다. 성공하면 `{ path, modified }` — 프로젝트 안이면 상대 경로, 밖이면 실제 경로.
- 파일 종류 제한은 없다. 파일 하나 20MB(넘으면 `file-too-large`). **PDF 같은 바이너리는 `encoding: 'base64'`** 를 더해 base64 글을 넘긴다. 기본은 `'utf8'` 글. 틀린 base64 · 모르는 encoding 은 `params-invalid`. 20MB 는 풀린 바이트 기준이다.
- **막는 곳** (`path-unsafe`): `..` 가 든 길 · NUL · `\`(윈도 밖) · 폴더 끝(`a/`) · 프로젝트도 홈도 아닌 곳(시스템 폴더 등) · 부모 폴더 링크를 따라가 실제 위치가 그 밖인 곳 · 대상 파일이 링크이거나 폴더인 곳 · 앱 설정 파일(`.litecode/settings.json` · `hooks.json` · `agents/` · `skills/` · `mockups/`) · 앱 데이터 폴더 · 프로젝트의 `.mcp.json` · `opencode.json(c)` · `.opencode` · 홈의 `.litecode`(사용자 훅 · MCP · 스킬) · `.config/opencode` · 어디든 `.git` · 홈의 `.ssh` · `.aws` · `.gnupg` · `.kube` · `.docker` · `.netrc` · `.npmrc` · `.gitconfig` · `.config/git` · 셸 시작 파일(`.zshrc` `.zshenv` `.zprofile` `.zlogin` `.bashrc` `.bash_profile` `.profile` …) · `.config/fish` · `.config/autostart` · `.config/systemd` · 윈도 PowerShell 프로필 폴더 · `Library/LaunchAgents` · `Library/LaunchDaemons` · 윈도 시작 프로그램 폴더. 목록의 원본은 앱의 `WRITE_BLOCKED`.
- 쓰기는 같은 폴더의 임시 파일을 만든 뒤 이름을 바꾼다(링크를 따라 쓰지 않는다).
- **`project.removeFile` 은 넓어지지 않았다** — `{ path: '.litecode/<이름>.md' }` 하나만 지운다(팀이 커밋해 같이 쓰는 문서, 예: SQL 튜닝의 `sql-standard.md`). 없으면 `{ removed: false }`. 쓴 파일을 지우는 길은 없다.
- 서비스가 올린 MCP 서버 프로세스는 이 검사를 받지 않는다. 호스트 API 번호(`service.api`)와 manifest 는 바뀌지 않았다. 옛 앱은 `.litecode/<이름>.md` 밖을 `path-unsafe` 로 거절한다.

## 플러그인을 지울 때 프로젝트 안의 자기 폴더도 지워진다 — `.litecode/plugins/<자기 id>/`

사용자가 설정 › 기능에서 플러그인을 지우면(카드의 [삭제] → [삭제 확인]) 앱이 등록된 모든 프로젝트에서 `<프로젝트>/.litecode/plugins/<플러그인 id>/` 폴더가 실제 있는 곳을 찾아
"이 플러그인이 프로젝트 안에 만든 폴더도 함께 지워집니다 — 되돌릴 수 없습니다" 와 목록(프로젝트 · 경로 · 크기)을 보인다. **안내를 본 뒤 [삭제 확인]을 누르면 안내한 폴더를 통째로 지운다 — 고르는 단계는 없다.**
선언은 필요 없다(manifest 에 새 필드가 없다). 프로젝트 안에 만드는 자기 산출물(시나리오 · 결과서 · 캐시)은 이 위치에 두면 플러그인과 함께 정리된다. 사용자의 소스·문서는 이 폴더에 두지 마라.

- 지우는 곳은 이 위치 하나뿐이다. `.litecode/plugins/` 아래의 다른 플러그인 폴더, `.litecode` 의 다른 파일, 프로젝트의 다른 모든 것은 건드리지 않는다.
- 안전장치: 길은 `프로젝트 실제 경로/.litecode/plugins/<id>` 로만 만든다. `.litecode` · `plugins` 가 링크이거나 `<id>` 이름이 링크면 따라가지 않고 건너뛴다(링크도 대상도 안 지운다). 폴더 안의 링크도 따라가지 않는다(링크만 지워진다). 다른 등록 프로젝트가 그 폴더 안에 있으면 지우지 않는다.
- **안내한 폴더만 지운다.** 안내 뒤에 새로 생긴 폴더 · 새로 등록된 프로젝트의 폴더는 지우지 않는다. 안내를 확인하지 않고 지워진 경우(조회 실패 · 10분 경과)에는 폴더는 두고 플러그인만 지운다.
- 폴더를 못 지워도(다른 프로그램이 쓰는 중 · 권한) 플러그인 삭제는 끝난 채로, 못 지운 폴더가 어디인지 알려 준다. 앱을 켤 때 적용되는 보류 삭제(비정상 종료 복구)는 안내 없이 사용자 폴더를 지우지 않으려고 폴더를 지우지 않는다.
- **옛 앱**: 이 동작이 없는 앱은 폴더를 그냥 지우지 않는다(플러그인만 지워진다). 호스트 API 번호(`service.api`)와 manifest 는 바뀌지 않았다.

## 안 되는 것

- **허용 밖 서비스**: `inject`·`ctx.get` 은 `projects` · `usage` 만이다. 설정·모델·엔진·계정·기능 묶음 서비스·다른 플러그인의 서비스는 설치 때 거절되고, 코드에서 닿으려 해도 `ctx` 에 없다.
- **`ctx` 의 나머지**: `root` · `emit` · `scope` · `fiber` 는 없다. 쓸 수 있는 것은 `on` · `get` · `effect` · `logger` 와 시간 도우미(`setTimeout` · `setInterval` · `sleep`)다.
- **직접 네트워크 요청**: 서비스는 앱과 같은 프로세스에서 같은 권한으로 돈다. 번들이 `fetch` 를 직접 부르는 것은 **호스트가 런타임에 막지 못한다.** 그래서 바깥 요청은 `host.fetch` 로만 하게 하고, 설치 검사가 번들의 글자로 직접 요청 흔적을 거절한다(완전하지 않다). 최종 강제는 해시 고정 · 기본 꺼짐 · 동의 · 서명 · 코드 리뷰가 맡는다.
- 허용 목록은 보안 경계가 아니라 **실수를 막는 가드레일**이다. 보안은 출처 확인·기본 꺼짐·동의·해시로 지킨다.
- **서명(#1652)**: 카탈로그 설치는 앱에 동봉한 공개키로 `id + version + sha256` 의 ed25519 서명을 확인한다(키가 있으면 서명 없는 항목 거절). 지금은 동봉 키가 비어 있어 서명 없이도 설치되고 확인창에 "서명 없음" 경고가 뜬다. 업데이트가 다른 키로 서명되면 다시 동의해야 켜진다. 내 PC 의 zip · 개발 모드는 서명 없이 경고·동의로 설치한다. 자세히는 `docs/plugin-signing.md`.

## 앱에서 직접 확인하기 — 서비스 예제 설치 → 켜기 → 패널 왕복

가짜 host 시험은 앱이 서비스를 올리고 패널이 묻는 길을 보지 못한다. 서비스를 바꾸거나 호스트 API 를 바꾼 PR 은 사람이 개발 앱에서 한 번 확인한다. 예는 플러그인 저장소의 `plugins/service-example`(턴 세기 — 의존성이 없어 빌드 없이 폴더 그대로 연결된다).

1. 개발 앱을 띄운다 — `npm run dev`. 개발 모드(#1348)는 개발 실행(`npm run dev`)과 플러그인 개발자용 설치본(`scripts/builder.mjs --plugin-dev`)에서만 있고, 일반 설치본에는 없다. 개발 실행은 설치본과 저장 공간이 달라(`litecode-dev`) 모델 연결이 비어 있으니 대화를 하려면 다시 넣는다.
2. 설정 › 기능 › 플러그인 탭의 **개발 중** 묶음에서 **폴더 연결** 을 눌러 `plugins/service-example` 폴더를 고른다. 연결하면 곧바로 zip 설치와 같은 검사·설치를 하고, 폴더가 바뀔 때마다(1초 조용해지면) 다시 설치한다. 개발자 본인 폴더라 동의를 받은 것으로 본다(카드에 DEV 표시) — 일반 zip 설치처럼 "출처를 확인했습니다" 창은 뜨지 않는다.
3. 범위 플러그인이라 줄에 **모든 프로젝트** · **이 프로젝트 (이름)** 버튼이 뜬다. 하나를 고르면 그 범위로 설치되어 켜진다. 실패하면 같은 줄에 사유가 나온다(고친 뒤 **지금 다시 읽기**).
4. 플러그인 목록의 카드에 **서비스** 칩이 있고 스위치가 켜져 있는지 본다. 카드에 "다시 동의해야 합니다" · "다시 설치해야 합니다" 가 보이면 실패다.
5. 켠 프로젝트에서 오른쪽 패널의 `+` 메뉴로 이 플러그인 탭을 연다. 횟수가 0 이다.
6. 같은 프로젝트에서 AI 에게 짧은 질문을 한 번 하고 답이 끝나게 둔다. 패널을 닫아 두었어도 서비스가 세니, 패널을 다시 열면(패널은 5초마다 `service.call` 로 묻는다) 횟수가 1 늘어야 한다. 다른 프로젝트의 대화는 세지 않아야 한다.
7. 스위치를 끄면 서비스가 내려가 패널이 실패 코드(`service-off` · `not-on`)를 받고, 다시 켜면 돌아온다.
8. 확인이 끝나면 연결을 끊는다(**연결 끊기** — 설치된 플러그인은 남으니 지우려면 카드의 삭제).

서비스에 MCP 서버·언어 서버처럼 실행 파일을 올리는 플러그인은 위 2번에서 폴더째 묶여 들어가므로, 실행 파일의 실행 비트(zip 에 살아 있던 것만 살린다 — 위 `host.mcp` 절)가 폴더 연결에서도 같은지 함께 본다.
