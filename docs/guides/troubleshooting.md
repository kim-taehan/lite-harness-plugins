[← 가이드 목록](../README.md)

# 막혔을 때 — 오류 원인 · 해결

설치가 거절되거나, 서비스가 올라오지 않거나, 패널 호출이 실패할 때 코드마다 **원인과 고치는 법**을 찾아보는 표입니다. 코드 이름과 뜻은 desktop 코드가 정본입니다(`shared/extensions/manifest.ts` · `channel.ts` · `servicePolicy.ts` · `serviceBundleScan.ts`, `src/services/pluginServices/load.ts`). 여기와 다르면 desktop 코드를 따르고 이 표를 고칩니다.

*찾아보는 문서 · 코드는 카드의 사유 줄이나 `error.code` 에 그대로 나옵니다*

어디서 막혔는지로 고릅니다.

- [1. 설치할 때 거절된다](#1-설치할-때-거절된다) — 카드나 설치 확인창에 사유가 나온다
- [2. 설치는 됐는데 서비스가 올라오지 않는다](#2-설치는-됐는데-서비스가-올라오지-않는다) — 카드에 실패 사유(`failed`)
- [3. 패널 · 서비스의 호출이 실패한다](#3-패널--서비스의-호출이-실패한다) — `service.call` · `host.call` 의 `error.code`
- [4. 개발 모드(폴더 연결)에서 고칠 때](#4-개발-모드폴더-연결에서-고칠-때)

## 1. 설치할 때 거절된다

zip(또는 연결한 폴더)을 검사하다 하나라도 걸리면 설치되지 않고 사유가 나옵니다. 사유의 `field` · `value` 에 틀린 곳이 적혀 있습니다.

### manifest 모양 (`plugin.json`)

| 코드 | 원인 | 고치는 법 |
|---|---|---|
| `manifest-missing` | zip 맨 위에 `plugin.json` 이 없다 | `build.mjs` 가 낸 zip 을 쓴다. 직접 묶으면 폴더 **안에서** `zip -r ../x.zip .` |
| `manifest-ambiguous` | `plugin.json` 과 `extension.json` 이 둘 다 있다(`paths` 에 이름) | 하나만 둔다 — 새 플러그인은 `plugin.json` (표준 4번) |
| `manifest-misplaced` | manifest 가 한 폴더 안에 들어 있다(폴더째 zip) | 폴더 자체가 아니라 폴더 **안의 내용**을 zip 맨 위에 놓는다 |
| `manifest-invalid` | JSON 이 아니거나 모양이 틀렸다(`message`) | JSON 문법(쉼표 · 따옴표)을 확인한다 |
| `manifest-too-large` | manifest 가 64KB 를 넘는다 | 긴 설명은 줄인다 — manifest 는 짧게, 설명 글은 `details`(2000자 이하) |
| `field-missing` | 필수 필드 `id` · `name` · `description` · `version` 중 빠진 것(`field`) | 채운다 |
| `field-unknown` | 앱이 모르는 필드(`field`, 오타면 `suggestion`) | 오타를 고친다. **옛 선언 `tools` · `mcp` · `lsp` · `skills` · `agents` · `grammars` · `locale` · `type` 도 여기 걸린다**(폐지, desktop 이슈 #1642) — 서비스가 `host.*.register` 로 올린다. 분류 · 업데이트 글은 manifest 가 아니라 `categories.json` · `changes.txt` (표준 3번) |
| `id-invalid` | id 가 소문자 · 숫자 · `-` 3~40자가 아니다 | 고친다(표준 2번) |
| `id-reserved` | 앱이 예약한 id | 다른 이름을 쓴다 |
| `id-mismatch` | 폴더 이름과 manifest 의 `id` 가 다르다(`folder` · `id`) | 폴더 이름과 `id` 를 같게(표준 1번) |
| `version-invalid` | `version`(또는 `litecode`)이 `주.부.수` 가 아니다 | `1.2.3` 모양으로 |
| `app-too-old` | `litecode` 가 요구하는 최소 앱 버전보다 지금 앱이 낮다(`required` · `current`) | 앱을 올리거나 `litecode` 를 낮춘다(쓰는 기능이 그 버전에 있는지 확인) |
| `text-invalid` | `name`(80자) · `description`(300자) · `details`(2000자)가 길이를 넘었다(`field` · `max`) | 줄인다 |
| `pages-invalid` · `page-not-html` · `page-missing` | `pages` 모양이 틀렸다(`field`: `shape` 객체가 아니거나 비어 있음 · `count` 8개 초과 · `entry` 화면이 없음 · 이름 모양/경로 틀림) · 파일이 `.html` · `.htm` 이 아니다 · 적은 파일이 zip 에 없다 | 이름은 글자로 시작하는 64자 안, 경로는 폴더 안 `.html`, 화면은 8개까지. `pages` 를 쓰는 플러그인은 `litecode` 도 적는다 — [화면 여러 장](first-panel.md#화면-여러-장--pages-베타) |
| `scope-invalid` | `scope` 가 `app` · `project` 가 아니다 | 둘 중 하나. 생략하면 프로젝트별(단 이 저장소 표준 20번은 새 플러그인에 `scope` 를 꼭 적게 한다) |
| `permissions-invalid` · `permission-unknown` | `permissions` 가 문자열 목록이 아니다 · 모르는 권한(`value`, 오타면 `suggestion`) | 앱이 아는 권한만. 폐지돼 삭제된 `tools` · `mcp` · `lsp` 권한도 여기 걸린다 — 서비스 등록은 `service` 권한만으로 된다 |
| `entry-missing` · `entry-invalid` · `entry-not-html` · `entry-unsafe` · `entry-too-large` | `entry` 파일이 zip 에 없다 · 경로가 틀렸다 · `.html` 이 아니다 · 폴더 밖이나 링크다 · 2MB 를 넘는다 | 패널은 한 파일짜리 HTML, 폴더 안 일반 파일로 둔다 |
| `settings-invalid` | `settings` 선언 모양이 틀렸다(`settings.<n>.<필드>`, 키가 겹침) · `settingsCheck` 가 틀렸거나 `service` 선언이 없다 | `field` 가 가리키는 곳을 고친다. `settingsCheck` 는 서비스가 등록한 서버의 도구 이름이다 |
| `locale-invalid` · `locale-reserved` | (서비스 언어 팩 등록) 언어 태그 모양이 틀리다 · 내장 언어(`ko` · `en`)와 겹친다 | `ja` · `zh-CN` 같은 태그를 쓰고 내장 언어는 쓰지 않는다 |

### 서비스 선언 (`service`)

| 코드 | 원인 | 고치는 법 |
|---|---|---|
| `service-invalid` | `service` 선언이 틀렸다. `field` 가 곳을 알려 준다(아래 표) | 아래 표 |
| `service-mismatch` | `service` 선언과 `service` 권한이 **같이** 있어야 하는데 한쪽만 있다 | `permissions` 에 `"service"` 를 넣거나 선언을 지운다(표준 5번) |
| `service-incompatible` | `service.api` 가 이 앱이 아는 호스트 API 버전보다 크다(`api` · `supported`) | 앱을 최신으로 올린다. 지금은 `api: 1` |
| `service-network-direct` | 번들이 바깥으로 직접 보낸다 — `fetch(` · `new WebSocket` · `node:http` · `https` · `net` · `tls` · `dns` · `dgram` · `undici` 흔적(`path` · `found`) | 바깥 요청은 `host.fetch` 로만 한다. **글자 점검이라** `fetch(` 라는 이름의 자기 메서드도 걸리니 이름을 바꾼다. 소스에서는 표준 24번 테스트가 먼저 잡는다 |

`service-invalid` 의 `field`:

| `field` | 원인 | 고치는 법 |
|---|---|---|
| `service` | 객체가 아니다 | `{ "main": "service.mjs", "api": 1 }` 모양으로 |
| `service.<이름>` | 모르는 키 — `main` · `api` · `inject` · `events` 만 된다 | 오타를 고친다 |
| `service.main` | 문자열이 아니거나 `.mjs` 가 아니거나 폴더 밖이다 | 플러그인 폴더 안의 `.mjs` **한 파일**(`service.mjs`) |
| `service.api` | 1 이상의 정수가 아니다 | `1` |
| `service.inject` · `service.events` | 문자열 목록이 아니다 · 8개를 넘는다 · 같은 이름이 겹친다 | 겹치지 않는 문자열 목록으로 |
| `service.inject[n]` | `n` 번째가 허용 목록(`projects` · `usage`) 밖이다 | 허용 키만. 목록은 `sdk/litecode-service.d.ts` 의 `ServiceInjectKey` |
| `service.events[n]` | 허용된 소식 이름이 아니다 · 그 소식에 필요한 권한이 없다 · 프로젝트를 모르는 소식을 프로젝트별(`scope` 생략 포함)로 받으려 한다 | `chat.turnEnded`(`chat` 권한) · `project.filesChanged`(`project` 권한) · `usage.changed`(`usage` 권한, **`scope: "app"` 만**) 중에서 권한과 `scope` 를 맞춘다 |

### zip 자체 · 설치 중

| 코드 | 원인 | 고치는 법 |
|---|---|---|
| `zip-unreadable` | zip 이 깨졌다 | 다시 묶는다 |
| `zip-too-large` · `too-many-entries` · `total-too-large` · `file-too-large` | 한도 초과 — zip 100MB · 항목 2000개 · 풀었을 때 합 200MB · 파일 하나 50MB | 큰 의존성을 묶지 말고(서비스는 4MB 이하) 필요한 파일만 싣는다 |
| `unsafe-path` · `symlink` · `duplicate-path` | 폴더 밖으로 나가는 이름(`..` · 절대 경로) · 심볼릭 링크 · 같은 경로가 두 번 | 일반 파일만 상대 경로로. 링크는 실제 파일로 바꿔 묶는다 |
| `staged-mismatch` · `verify-failed` · `unpack-failed` · `apply-failed` · `io-failed` | 검사한 뒤 푸는 사이에 파일이 달라졌다 · 풀기·적용·저장에 실패했다(`message`) | 다시 설치한다. 되풀이되면 `message` 를 본다(디스크 · 권한) |
| `reconsent-required` | 업데이트가 권한 · `inject` · `events` · `service.api` · `scope` 를 바꿨거나 서비스를 **새로 담았는데** 동의 없이 들어왔다 | 카드의 설치 확인창에서 다시 동의해야 켜진다. 일부러 선언을 바꾼 게 아니면 되돌린다 |

## 2. 설치는 됐는데 서비스가 올라오지 않는다

카드에 실패 사유가 보이고 상태가 `failed` 입니다. 서비스 하나가 못 떠도 다른 서비스 · 앱은 계속 돕니다. 사유는 한 줄로 나옵니다.

| 사유 | 원인 | 고치는 법 |
|---|---|---|
| `integrity` | 올릴 때 읽은 `service.mjs` 의 해시가 설치할 때 기록한 것과 다르다(설치된 파일을 손으로 고쳤거나 기록이 없다) | **다시 설치**한다. 개발 모드(폴더 연결)에서는 폴더를 다시 묶으면 자동으로 다시 설치된다 |
| `network-direct` | 올릴 때 하는 점검이 번들에서 직접 요청 흔적을 찾았다 | 위 `service-network-direct` 와 같다 — `host.fetch` 로 |
| `no-default` | 번들에 `export default` 함수가 없다 | `export default (host) => class … extends host.Service` 모양인지 확인한다 |
| `bundle load timed out` | 읽기 · 올리기가 5초 안에 끝나지 않았다(최상위 `await` 가 안 끝남 등) | 최상위에서 오래 걸리는 일을 하지 않는다. 무거운 라이브러리를 통째로 묶지 않는다 |
| (올라오지 않음, 크기) | 번들 한 파일이 **4MB** 를 넘는다 | 번들을 줄인다. 무거운 일은 별도 프로세스 MCP 서버(`host.mcp.register`)로 |
| 생성자에서 던짐 | 생성자가 오류를 던지면 그 서비스는 `failed` 로 남는다. 선언하지 않은 소식을 `ctx.on` 해도 던진다 | 로그의 오류를 본다. `plugin.json` 의 `events` 와 코드의 `ctx.on` 이름을 맞춘다 |
| 꺼져 있음 · 동의 필요 | 서비스 플러그인은 기본이 꺼짐이고 켜려면 동의한다. 업데이트가 선언을 바꿨으면 다시 동의한다 | 카드의 스위치 · 설치 확인창에서 동의한다 |

## 3. 패널 · 서비스의 호출이 실패한다

패널의 `service.call` 은 `{ ok: false, error: '<코드>' }` 로, 서비스의 `host.call` 은 `error.code` 를 가진 오류를 던져 알립니다.

### 패널이 `service.call` · `service.list` 를 부를 때

| 코드 | 원인 | 고치는 법 |
|---|---|---|
| `service-off` | 서비스가 올라와 있지 않다(꺼짐 · 올리는 중) | 켜져 있는지 보고, 올리는 중이면 잠깐 뒤 다시 부른다. 패널은 마지막 값을 자기 화면에 두면 편하다 |
| `service-failed` | 서비스 함수가 던졌거나 올리지 못했다 · 응답이 JSON 으로 못 실린다(함수 · 순환 값) | 로그를 본다. `expose` 가 JSON 으로 오갈 값만 돌려주게 한다 |
| `service-unknown` | `expose` 하지 않은 이름을 불렀다 | `service.list` 로 올라온 이름을 확인하고 이름을 맞춘다 |
| `params-invalid` | `service.call` 에 `name`(글자)이 없다 | `{ name: '…', params }` 로 부른다 |
| `not-on` | 그 프로젝트에서 이 플러그인이 켜져 있지 않다(프로젝트별 서비스) · 설치돼 있지 않다 | 설정의 범위(모든 프로젝트 · 이 프로젝트만)를 확인한다 |
| `permission-missing` | 부른 기능에 필요한 권한이 `permissions` 에 없다 | 필요한 권한만 더한다(업데이트면 사용자가 다시 동의한다 — 표준 6번) |
| `method-unknown` | 패널이 부를 수 없는 호출이다 — 패널은 `service.call` · `service.list` · `events.subscribe` 와 화면 전용(`panel.fullscreen` · `settings.open` · `panel.notify` · `panel.args` · `panel.navigate` · `chat.current`)만 부른다. `project.*` · `chat.compose` · `network.*` 같은 직접 호출은 거절된다 | 서비스가 `host.call` 로 부르고 패널은 `service.call` 로 묻는다([서비스 플러그인 만들기](service-plugin.md)) |
| `event-unknown` | `events.subscribe` 에 모르는 소식 이름 | 서비스가 `host.panel.emit('x', …)` 로 보내는 소식은 패널에서 **`service.x`** 이름으로 구독한다 |
| `page-unknown` | 패널의 `panel.navigate` — 그 이름이 `plugin.json` 의 `pages` 에 없다(경로를 적어도 거절) | `pages` 에 적은 이름만 부른다. `params` 모양이 틀리면 `params-invalid` — `{ page: '이름' }` |
| `panel-hidden` | 패널의 `panel.fullscreen` — 이 플러그인 탭이 지금 보이는 탭이 아니다 | 탭이 보일 때 부른다 |

### 서비스의 `host.call` · `host.fetch` · `host.*.register`

| 코드 | 원인 | 고치는 법 |
|---|---|---|
| `method-unknown` | 서비스가 부를 수 없는 호출이다 — `secrets.get`(비밀은 읽지 못한다) · `panel.args` · `panel.navigate` · `events.subscribe`(대신 `ctx.on`) · `service.call` · `service.list` 등 | 비밀은 설정의 `type: "secret"` 칸을 선언하고 서버 `env` 에 `${secret:키}` 로 넘기는 것이 유일한 길이다 |
| `not-on` | 프로젝트별 서비스가 `directory` 없이 불렀거나 그 프로젝트에서 켜져 있지 않다 | `expose` 의 두 번째 인자 `{ directory }` 를 `host.call(…, params, { directory })` 로 넘긴다. 앱 전체(`scope: "app"`)는 폴더 없이도 된다 |
| `no-project` | 열린 프로젝트가 없다 | 프로젝트를 연 상태에서 부른다 |
| `no-window` | `chat.compose` · `chat.open` · `project.openFile` · `panel.fullscreen` · `settings.open` 처럼 **화면이 해 주는 일**인데 그 프로젝트 창이 없거나 답이 없거나 이 플러그인 탭이 보이지 않는다 | 창과 탭이 보일 때 부른다. 보이는 탭이 없으면 조용히 성공하지 않고 이 코드로 거절된다 |
| `permission-missing` | 필요한 권한이 없다 | `permissions` 에 더한다 |
| `consent-required` | `host.fetch` 가 처음 보는 주소를 만났다(`error.origin` 에 주소) | 그 플러그인의 **허용 대기**에 올라갔으니 설정 › 플러그인 카드에서 사용자가 [허용]한다. 허용하면 다음 호출부터 된다. 가짜 host 는 `createFakeHost({ allowedOrigins })` 로 재현한다 |
| `network-denied` | 사용자가 거부한 주소 · 대기가 가득 찼다(주소 10개) · 새 주소를 너무 자주 요청했다(플러그인당 한 시간에 10개) | 주소를 다시 확인한다. 거부한 주소는 앱을 다시 켜기 전까지 다시 올라오지 않는다 |
| `secret-write-only` | `secrets.get` 이 서버 `env` 에 쓰이는 비밀 값(또는 `secret` 설정 칸)의 키를 읽으려 했다 | 비밀은 쓰기만 된다. 읽는 코드를 없앤다(서비스는 `secrets.get` 자체가 `method-unknown`) |
| `secrets-unavailable` | 이 기기에서 비밀 값을 봉할 수 없다(`safeStorage` 없음 · 거부) | OS 의 키체인 사용을 확인한다 |
| `mcp-failed` | 서비스가 등록한 MCP 서버를 못 띄웠거나 도구 호출이 실패했다 | 서버 실행 파일이 zip 안에 있고 실행 비트가 살아 있는지, `command` 가 플러그인 폴더 안 경로인지 확인한다 |
| `check-unavailable` | 설정의 [연결 확인] 을 서비스가 올라오기 전에 눌렀다(설치 2단계 폼) | 설치를 끝내고 서비스가 켜진 뒤 설정 화면에서 누른다 |

서비스에서 `host.skills.register` · `host.tools.register` · `host.lsp.register` 같은 등록이 **던질** 때는 오류 메시지에 이유가 적힙니다(이름 겹침 · 이름 모양 · 폴더 밖 경로). 생성자에서 던지면 서비스가 올라오지 않으니 위 2번을 봅니다.

## 4. 개발 모드(폴더 연결)에서 고칠 때

- 개발 모드는 개발 실행(`npm run dev`)이나 플러그인 개발자용 설치본에서만 있습니다. 일반 설치본에는 없습니다.
- **연결할 폴더**는 `node plugins/<id>/build.mjs --dir` 가 낸 `build/<id>/` 입니다(원본 `plugins/<id>/` 가 아닙니다 — 서비스는 묶기 전이라 앱이 올리지 못합니다).
- 폴더가 바뀌면(1초 조용해진 뒤) 앱이 zip 설치와 같은 검사·설치를 다시 합니다. 그래서 고친 뒤 `build.mjs --dir` 를 다시 돌리면 됩니다. 사유가 남아 있으면 카드의 **지금 다시 읽기** 를 누릅니다.
- 개발자 본인 폴더라 동의를 받은 것으로 보고 "출처를 확인했습니다" 창이 뜨지 않습니다(카드에 DEV 표시). 일반 zip 설치에서는 동의창이 뜹니다 — 동의 흐름은 zip 으로도 한 번 시험하세요.
- 서비스에서 MCP 서버 · 언어 서버처럼 실행 파일을 올리면, 폴더 연결에서도 실행 비트가 살아 있는지 함께 봅니다.
- 앱 없이 먼저 시험하려면 `npm test -- --project <id>` 의 가짜 host 를 씁니다(`sdk/litecode-service-testing.mjs`). 가짜 host 는 `no-window` · `consent-required` 의 일부만 흉내 냅니다.

## 그래도 안 풀리면

코드 · 사유 문구 · 연 화면을 적어 desktop 저장소의 이슈([#1614](https://github.com/kim-taehan/lite-harness-desktop/issues/1614) · [#1642](https://github.com/kim-taehan/lite-harness-desktop/issues/1642))나 PR 로 알려 주세요. 앱에서 안 되는 일이면 플러그인에서 우회하지 말고 호스트 API 로 더해 달라고 요청합니다(표준 12번).

## 다음

- [서비스 플러그인 만들기](service-plugin.md) — 서비스 · 패널 · 시험
- [저장소로 내보내기](publish.md) — `dev` 에서 브랜치 · 올리기 · 버전
