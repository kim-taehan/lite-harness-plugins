[← 가이드 목록](README.md)

# 플러그인 구조

플러그인이 앱의 어디에 닿고 어디에 닿지 못하는지, 그 경계를 앱이 어떻게 지키는지. 가이드를 따라 하다 "이건 왜 안 되지?" 싶을 때 읽는 문서입니다.

*기준: lite-harness-desktop dev · 정본: shared/extensions.ts · shared/extensions/serviceApi.ts · src/services/extensions/ · src/services/pluginServices/*

## 한눈에

플러그인은 zip 하나입니다. 앱은 그것을 검사해 풀어 두고, 담긴 것의 종류에 따라 서로 다른 자리에 올립니다. 코드가 도는 자리는 셋입니다 — **패널**은 격리된 iframe, **MCP 서버 · 도구 · 언어 서버**는 따로 띄운 프로세스, **서비스**(`service`)는 **앱의 메인 프로세스 안**에서 앱과 같은 권한으로 돕니다. 코드를 가진 플러그인의 기본 길은 서비스이고, 서비스가 앱에 닿는 길은 호스트 API 와 허용 목록으로 정해져 있습니다(아래 [서비스](#서비스-설치형)). 패널과 따로 띄운 프로세스가 앱에 무언가를 부탁하는 길은 정해진 통로뿐입니다.

`플러그인 하나가 닿는 곳`

```
 plugin.json ─┬─ entry(.html) ──▶ 오른쪽 패널 탭 (sandbox iframe + CSP)
              │                        │ postMessage { litecode: 1, id, method, params }
              │                        ▼
              │                   화면의 플러그인 탭 ── 동의 띠 (처음 가는 주소)
              │                        │ IPC extensions:call (플러그인 id 는 iframe 으로 정함)
              │                        ▼
              │                   ctx.extensions (메인) ── 권한 검사 → calls/* 로 분배
              │                        ├─ storage · secrets   → userData/extensions/data/<id>/
              │                        ├─ project.*           → 지금 프로젝트 폴더 (안쪽만)
              │                        ├─ chat.*              → 새 대화 · 입력창
              │                        ├─ network.*           → 메인이 대신 요청
              │                        ├─ mcp.call            → 아래 MCP 서버
              │                        └─ service.call        → 아래 서비스 (expose 한 메서드)
              │
              ├─ service ─────▶ 앱 프로세스 안에서 Cordis 서비스로 올림 (ctx.pluginServices, 켜진 프로젝트마다 소식을 거름)
              │                   └ 앱 소식(ctx.on) · host.call · host.panel.emit · host.*.register(도구 · MCP · 스킬 · 에이전트 · 언어 서버 · 언어 · 문법)
              ├─ mcp ─────────▶ 앱 내장 MCP(appMcp) 에 <id>_<도구> 로 올림 ──▶ 엔진(opencode) ──▶ AI
              │                   └ 처음 부를 때 서버 프로세스를 띄움 (프로젝트마다 하나, stdio)
              ├─ tools ───────▶ 같은 자리, 부를 때마다 실행 파일 한 번 (stdin JSON → stdout JSON)
              ├─ lsp ─────────▶ 언어 서버 (src/services/lsp) — 파일 보기의 밑줄 · 풍선, AI 의 code_* 도구 (폴더마다 하나)
              │                   └ 서비스의 host.lsp.register 로 올림 (manifest lsp 선언은 곧 삭제될 옛 경로)
              ├─ skills ──────▶ 앱 스킬 폴더로 복사 (userData/opencode/skills) ──▶ 엔진
              ├─ settings ────▶ 앱이 그리는 설정 폼 → storage · secrets → mcp.env 자리표시
              ├─ type locale ─▶ 화면 · 메인 문구 사전 (설정 › 일반 › 언어) — 옛 길, 서비스의 host.locale 로 이전 중
              └─ type grammar ▶ 파일 개요(ctx.treeSitter) 의 언어 표 — 옛 길, 서비스의 host.grammars 로 이전 중
```

## 건드릴 수 있는 곳

| 자리 | 하는 일 | manifest | 권한 |
|---|---|---|---|
| 오른쪽 패널 탭 | 진입 HTML 이 `+` 메뉴의 탭으로 열림(같은 zip 의 스크립트 · 스타일시트 · 이미지는 앱이 읽어 넣음), 전체 화면(`panel.fullscreen`) | `entry` | 없음 |
| 가운데 탭 | 같은 패널을 대화 옆 가운데 탭 줄에 둠(`+` 메뉴에는 안 나옴), 지금 대화 읽기(`chat.current` · `chat.currentChanged`) | `placement: "center"` | 없음 (대화는 `chat`) |
| 파일 우클릭 | 파일 트리 · 파일 탭 메뉴에 "이 플러그인으로 열기", 그 플러그인 탭(오른쪽 또는 가운데)을 열고 고른 파일 경로를 넘김(`panel.args`) | `fileActions` | `project` |
| 앱 소식 | 패널이 `events.subscribe` 로 고른 이벤트(턴 끝 · AI 가 쓴 파일 · 연 탭 · 사용량 · 설정 저장)를 받음, 이벤트마다 그 권한. 서비스는 같은 이름 한 벌 중 `chat.turnEnded` · `project.filesChanged` · `usage.changed` 를 `ctx.on` 으로 받음 | — | 이벤트마다 |
| 에이전트 | 플러그인이 담아 온 서브에이전트 `.md` 가 `.litecode/agents` 처럼 엔진에 실림 (범위 플러그인) | `agents` | 없음 |
| 앱 알림 | 앱이 그리는 토스트(플러그인 이름 + 제목 + 본문), 누르면 그 플러그인 탭. 패널의 `panel.notify` · `tools` 도구 결과의 `notify` 로 냄 (MCP 서버는 직접 못 냄) | — | 없음 |
| 플러그인 저장 칸 | 플러그인별 JSON 값 (`storage.*`, 64KB) | — | 없음 |
| 프로젝트 읽기 | 이름 · 파일 읽기 · 목록 · 찾기 · 크기 · git 바뀐 파일 · 연 탭 · 앱 미리보기로 열기 · 고르기 창 | — | `project` |
| 프로젝트 문서 쓰기 | `.litecode/` 바로 아래 `.md` 쓰기 · 지우기 (팀이 커밋하는 표준 문서) | — | `projectWrite` |
| 대화 | 새 대화를 열고 입력창 채우기 · 바로 보내기, 대화 제목 · 열기 | — | `chat` |
| AI 에게 한 번 묻기 (서비스 전용) | 서비스가 `host.call('llm.ask')` 로 앱의 기본 모델에 한 번 묻고 답 글을 받음(모델 선택 · 도구 사용 없음, 사용자가 "AI 에게 묻기" 로 끌 수 있음, 플러그인마다 1분 10번). 베타 | — | `llm` |
| AI 도구 (서버) | MCP 서버를 실어 AI 가 부르는 도구로 올림, 패널도 같은 서버를 부름. 앱 MCP `litecode` 안에(기본) 또는 플러그인 이름의 별도 서버로(`mcp.attach: "server"`) | `mcp` | `mcp` |
| AI 도구 (한 번 실행) | 부를 때마다 실행 파일 하나를 돌림 | `tools` | `tools` |
| 언어 서버 | 서비스가 `host.lsp.register` 로 서버를 올리면, 그 확장자 파일이 필요할 때 폴더마다 띄워 LSP 로 이음 — 파일 보기의 오류 밑줄 · 마우스 풍선 · 문제 목록, AI 의 `code_diagnostics` 등, 코드 탐색의 정의 · 참조. 만드는 법은 [언어 서버 플러그인](guides/lsp-plugin.md) | `service` (옛 경로 `lsp`, 곧 삭제) | `service` (옛 경로 `lsp`) |
| 설치형 서비스 | 패널을 닫아도 앱 안에서 도는 코드 — 앱 소식 받기, 앱 기능 부르기(`host.call`), 패널에 밀어 보내기(`host.panel.emit`), AI 도구 · MCP · 스킬 · 에이전트 · 언어 서버 · 언어 · 문법 올리기. 새 기능과 코드를 가진 플러그인의 기본 길. [서비스](#서비스-설치형) | `service` | `service` |
| 스킬 | 켜져 있는 동안 앱 스킬로 보임, 패널이 자기 스킬에 `.md` 덧씌우기(`skills.*`) | `skills` | 없음 |
| 설정 폼 | 설치 2단계 · [고치기] 에 앱이 그리는 폼, [연결 확인] | `settings` · `settingsCheck` | 없음 |
| 비밀 값 | 토큰 · 비밀번호를 이 기기에 암호화 (`secrets.*`) | — | `secrets` |
| 바깥 요청 | 메인이 대신 요청, 바깥 서버 연결(주소 · 토큰) 보관 | — | `network` |
| 사용량 | 토큰 사용량 숫자 (대화 글 · 제목 없음) | — | `usage` |
| 화면 언어 | 앱 문구 번역 — 서비스가 `host.locale.register`(`scope: "app"`), 옛 길은 `type: locale` | `service` (옛 길 `type: locale`) | `service` (옛 길은 가질 수 없음) |
| 파일 개요 | 새 언어의 클래스 · 함수 개요 — 서비스가 `host.grammars.register`(`scope: "app"`), 옛 길은 `type: grammar` | `service` (옛 길 `type: grammar`) | `service` (옛 길은 가질 수 없음) |

패널이 부를 수 있는 메서드 전체와 권한의 짝은 [calls/table.ts](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/src/services/extensions/calls/table.ts) 의 `CALL_TABLE` 한 곳에 있습니다. 표에 없는 메서드는 `method-unknown` 입니다.

## 건드릴 수 없는 곳

- **화면의 다른 자리** — 왼쪽 패널, 대화 화면과 메시지, 입력창 UI, 설정 화면 배치. 플러그인 화면은 오른쪽 패널 탭 또는 가운데 탭 하나, 파일 우클릭 메뉴 항목, 앱이 그려 주는 설정 폼뿐입니다.
- **엔진과 모델** — 엔진 설정, 모델 · provider, API 키. 키 프록시 · 엔진 · 데스크탑 MCP · 모바일 연결 같은 앱 자신의 로컬 서버 주소는 `network` 권한이 있어도 `address-reserved` 로 막힙니다.
- **프로젝트 밖** — 경로는 프로젝트 기준 상대 경로만, `..` · 절대 경로 · 프로젝트 밖을 가리키는 링크는 `path-unsafe`. 쓰기는 `.litecode/*.md` 만. 홈 폴더(데스크톱 · 다운로드 등)에 직접 쓰는 길과 `homeWrite` 권한은 없다 — 밖으로 내보내려면 사용자가 저장 창에서 고르는 `project.exportFile`(서비스 가이드 5-0).
- **다른 플러그인** — 저장 칸 · 비밀 값은 플러그인마다 폴더가 따로이고, 플러그인 id 는 메시지 내용이 아니라 어느 iframe 에서 왔는지로 정해 흉내 낼 수 없습니다.
- **비밀 값 다시 읽기** — MCP 서버 env 에 쓰이는 비밀 키(서비스가 올린 서버의 `${secret:}` 키와 `secret` 설정 칸 키 포함)는 패널이 쓰기만 하고 읽지 못합니다(`secret-write-only`). 서비스는 `secrets.get` 을 부르는 것 자체가 안 됩니다(desktop #1639) — 비밀은 `secret` 설정 칸과 `${secret:키}` → `mcp.env` 로만 자식 프로세스에 갑니다.
- **서비스가 못 닿는 앱 서비스** — `inject` · `ctx.get` 은 `projects` · `usage`(읽기용)뿐입니다. settings · providers · engine · sso · account(키 · 토큰에 닿음) · remote · extensions · 기능 묶음 서비스 · 다른 플러그인의 서비스는 설치 때 거절되고 코드에서도 `ctx` 에 없습니다.
- **서비스의 직접 바깥 요청** — 바깥으로 나가는 길은 `host.fetch` 하나이고, 번들에 `fetch(` · `WebSocket` · `node:http` 같은 직접 요청 흔적이 있으면 설치가 거절됩니다(`service-network-direct`, 글자 점검이라 완전하지 않음).
- **대화 내용** — 대화 글은 읽지 못합니다. `chat` 은 새 대화를 여는 쪽, `usage` 는 숫자만입니다.

> 새 자리가 필요하면(예: 왼쪽 패널 위젯, 메시지에 버튼) 이 저장소가 아니라 desktop 에 통로 메서드나 권한을 더해야 합니다 — [아래](#새-자리를-더하려면-desktop-쪽).

## 패널: 격리와 통로

- 메인은 진입 HTML 을 **읽어 화면에 넘길 뿐 실행하지 않습니다**. 화면이 `sandbox="allow-scripts"` iframe 에 CSP 를 맨 앞에 붙여 돌립니다.
- CSP 가 `fetch` · XHR · WebSocket · 외부 스크립트/스타일/이미지/글꼴 · 하위 iframe · 폼 전송을 막습니다. 인라인 스크립트 · 스타일은 됩니다. 링크 · `location` 같은 이동은 메인이 막습니다.
- 같은 zip 의 자산은 진입 HTML 이 직접 적은 `<script src>`(module 제외) · `<link rel="stylesheet">` · `<img src>` 만, 메인이 설치 폴더 안에서 안전하게 읽어(진입 HTML 과 같은 읽기) 화면이 iframe 안에 글 · `data:` 주소로 바꿔 넣습니다. 64개 · 하나 4MB · 합쳐 32MB, 넘거나 못 읽은 것은 조용히 빠집니다. 플러그인이 꺼져 있거나 그 프로젝트에서 켜지지 않았으면 비어 있습니다 — [패널 가이드](guides/first-panel.md#같은-zip-의-파일-쓰기).
- 요청은 `parent.postMessage({ litecode: 1, id, method, params })`, 답은 `{ litecode: 1, id, ok, result | error }`. 화면은 **자기 탭의 iframe 에서 온 메시지만** 받아 IPC 로 메인에 넘기고, 메인이 manifest `permissions` 로 검사합니다.
- 서비스가 있는 플러그인의 패널은 앱 기능을 직접 부르지 않고 `service.call`(`{ name, params }`)로 자기 서비스의 `expose` 메서드를 부르고, 서비스가 밀어 보내는 소식은 `events.subscribe(['service.<이름>'])`(`service` 권한)로 받습니다. 옛 호출 표 길은 병행 기간 동안 그대로 동작합니다.
- 처음 가는 주소는 화면이 iframe **바깥**에 동의 띠를 그려 묻습니다 — 플러그인이 흉내 낼 수 없는 자리입니다. 허용한 주소는 플러그인 카드에 남습니다.
- 바깥 요청은 메인이 Chromium 네트워크로 보냅니다(사내 CA · 시스템 프록시를 따름, 쿠키 안 실음). http/https 만, 같은 origin 리다이렉트만, 기한 15초, 응답 5MB.

## AI 에 붙는 것: MCP · 도구 · 스킬

- **MCP 서버** — 도구 목록은 서버에게 한 번 묻고 플러그인 버전 · 선언마다 기억합니다(앱을 다시 켜도 서버를 띄우지 않음). AI 가 처음 부를 때 서버를 띄우고, 프로젝트 폴더마다 하나, 작업 폴더는 그 프로젝트. 쉬면(`idleMs`) · 꺼지면 · 버전이 바뀌면 내리고, env 자리표시 값이 바뀌면 다음 호출에 새로 띄웁니다.
- **도구 이름** — 앱 내장 MCP 에 `<id>_<도구>` 로 올라가 AI 에게는 `litecode_<id>_<도구>`. 그래서 플러그인 id 는 앱 기능 이름(desktop `shared/features.ts` 의 `FEATURES`) · 내장 MCP 이름(`litecode`)과 겹칠 수 없습니다(`id-reserved`).
- **실행** — `.mjs` · `.js` 는 앱 실행 파일을 Node 로 돌립니다(`ELECTRON_RUN_AS_NODE`). 사용자 PC 에 Node 가 없어도 되지만 `node_modules` 도 없어 의존성은 묶어 싣습니다. 셸은 거치지 않습니다.
- **앱은 서버 내용을 모릅니다** — 실행 파일을 띄우고 MCP 로 잇기만 합니다. 서버가 무엇을 하는지는 설치 카드의 설명 · 권한과 사용자의 판단에 맡깁니다.
- **스킬** — 실행이 아니라 글을 옮기는 것입니다. 스킬 폴더를 통째로 앱 스킬 폴더에 쓰고 표식 파일을 둬서, 같은 이름의 사용자 스킬은 건드리지 않습니다. 꺼지거나 지워지면 지웁니다.

## 서비스 (설치형)

새 기능과 코드를 가진 플러그인의 기본 길입니다(desktop 이슈 #1614). 만드는 법은 [서비스 플러그인 만들기](guides/service-plugin.md), 타입 · 가짜 host 는 desktop 의 [plugin-sdk 안내](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/docs/plugin-sdk/README.md)(이 저장소 `sdk/` 에 사본).

**모양** — manifest `service`(`main` · `api` · `inject` · `events`) + `service` 권한(둘은 같이만). `main` 은 플러그인 폴더 안 한 파일 `.mjs` 번들이고, cordis 를 가져오지 않고 앱이 넘기는 `host` 로 만든 클래스를 내보냅니다. 앱이 **앱 프로세스 안에서 Cordis 서비스로** 올립니다 — 앱과 같은 권한이라 호스트 API 허용 목록은 실수를 막는 가드레일이지 보안 경계가 아닙니다. 보안은 출처 확인 · 기본 꺼짐 · 동의 · 번들 바이트 대조가 맡습니다.

**올리고 내리기** (`ctx.pluginServices`, `src/services/pluginServices/`)

- 켜짐은 어느 프로젝트에서든 켜져 있으면 올리고 모두 꺼지면 내립니다. 서비스는 플러그인당 하나이고, 하나가 못 떠도 나머지는 올라가고 실패는 `failed` 상태로 남습니다.
- 켜진 프로젝트의 소식만 서비스에 주고(프로젝트를 모르는 소식은 버림), 프로젝트가 켜지고 꺼질 때 `projectOn(directory)` 이 부르고 돌려준 정리 함수를 부릅니다(`scope: "app"` 서비스에는 부르지 않음).
- 올릴 때마다 번들 sha256 을 설치 때 기록한 값과 대조하고, 읽은 그 바이트의 사본에서 올립니다. 읽기 · 올리기는 5초, 번들은 4MB 이하, 내릴 때 정리는 1초(앱 종료 8초 기한 안에 끝나게 병렬)입니다.

**호스트 API** (번들이 받는 `host`)

| 이름 | 하는 일 |
|---|---|
| `host.call(method, params, { directory })` | 패널이 쓰는 호출 표를 같은 이름 · 같은 권한 검사 · 같은 오류 코드로 부름. 창이 해 줘야 하는 것(`chat.compose` · `project.openFile` · `panel.fullscreen` 등)은 그 프로젝트 창에 보내고 못 찾으면 `no-window` |
| `host.panel.emit(name, data, { directory })` | 자기 패널에 소식을 밀어 보냄(`service.<이름>`, 64KB · 초당 20번) |
| `host.tools` · `host.mcp` | AI 도구 올리기(`<id>_<도구>`) · 별도 프로세스 MCP 서버 선언(플러그인에 하나). 도구 이름 규칙은 desktop 안내를 따름 |
| `host.skills` · `host.agents` · `host.lsp` | 스킬 · 에이전트(.md) · 언어 서버 올리기. `host.lsp.register` 는 `lsp` 권한 없이 `service` 만으로 되고, 서버 실행 파일은 플러그인 폴더 안만이며 `.mjs` 가 아니면 zip 안에서 실행 비트가 필요 |
| `host.locale` · `host.grammars` | 언어 팩 번역 · 문법(파일 개요) 올리기 — `scope: "app"` 서비스만 |
| `host.settings(directory?)` · `host.enabledIn` · `host.projects` · `host.dir` | 설정 칸 값(비밀 제외) · 켜짐 여부 · 켜진 프로젝트 목록 · 설치 폴더 경로(자산은 여기서 읽음) |
| `host.fetch(url, init)` | 바깥으로 나가는 유일한 길 — `network` 권한 + 사용자가 허용한 주소만 |

서비스는 소식을 `ctx.on` 으로 받고, `expose(이름, 함수)` 로 낸 메서드를 패널이 `service.call` 로 부릅니다. 작은 영구 값은 `storage`, 목록으로 쌓는 이력 · 색인 · 상태는 서비스 전용 문서 저장소 `host.db`(호스트 API 2, MCP 서버 프로세스는 `sdk/litecode-db-client.mjs` 로 — `guides/service-plugin.md` 3-1)에 둡니다.

**소식 3종과 프로젝트 정보** — 이름은 패널 소식과 한 벌입니다. `chat.turnEnded`(대화가 있으면 그 작업 폴더, 권한 `chat`) · `project.filesChanged`(AI 가 파일을 쓰고 고친 것을 0.5초 묶음으로, 등록 프로젝트 경로, 권한 `project`) · `usage.changed`(프로젝트 정보가 없어 `scope: "app"` 서비스만, 권한 `usage`). 받는 값에 `directory` 가 붙고, 프로젝트를 모르는 소식은 프로젝트별 서비스에 주지 않고 버립니다. 허용 목록 원본은 desktop `shared/extensions/serviceApi.ts` 입니다.

**설치 정책** — 서비스를 담은 플러그인은 설치만으로 켜지지 않습니다. 확인창에서 "앱 안에서 직접 실행됩니다. 출처를 확인했습니다" 에 동의하고 설치하면 그 자리에서 켜집니다(창을 거치지 않은 설치는 꺼진 채). 업데이트가 서비스를 새로 담았거나 권한 · `inject` · `events` · `service.api` · `scope` 를 바꿨으면 다시 동의해야 켜지고, 같은 선언의 버전 올림은 켜진 채 그대로입니다. 서비스 기록이 없는 이전 방식 설치본은 "다시 설치해야 합니다". 개발 모드(개발 실행에서만)는 개발자 본인 폴더라 재동의 없이 이어 가고 카드에 DEV 가 붙습니다.

**옛 길과 폐지 예정** — 패널이 호출 표(`CALL_TABLE`)로 앱 기능을 직접 부르는 길과 manifest 의 `type: locale` · `type: grammar` 는 옛 길입니다. 지금도 동작하고, 서비스가 같은 호출 표를 `host.call` 로 불러 쓰므로 표는 당분간 남습니다. desktop 은 코드를 가진 플러그인과 언어 · 문법 팩이 모두 서비스로 옮겨진 직후 옛 길을 한 번에 지울 예정이고, 그 일정은 desktop 이 정합니다. **manifest `lsp` 선언은 옛 경로로 곧 삭제됩니다**(desktop 폐지 PR B) — 언어 서버는 서비스의 `host.lsp.register` 로 올립니다. `tools` · `mcp` · skills · agents 선언형은 서비스 없이도 쓸 수 있다고 desktop 문서가 적습니다.

## 적용 범위

플러그인이 켜지는 곳은 manifest 의 `scope` 로 정합니다(새 플러그인은 필수 — 표준 20번).

| `scope` | 동작 |
|---|---|
| `"app"` | 앱 전체에서 켜집니다. 설치 때 범위를 묻지 않고 프로젝트 파일에 적지 않습니다. service · mcp · skills · agents · tools 도 모든 프로젝트에서 보입니다. 언어 · 문법 팩 서비스와 `usage.changed` 를 받는 서비스는 `app` 만 됩니다 |
| `"project"` | 설치 때 "모든 프로젝트 / 이 프로젝트만" 을 고릅니다(프로젝트가 열려 있으면 기본은 "이 프로젝트만"). 상세에서는 "이 프로젝트에서 안 씀" 도 고를 수 있습니다. 패널만 있는 플러그인도 됩니다. 켜지지 않은 프로젝트에서는 `+` 메뉴 · 가운데 탭 · 파일 우클릭 · 앱 통로(`not-on`) · 에이전트 · 스킬 · 도구 · 별도 MCP 서버 어디에도 나오지 않습니다 |
| (없음) | 옛 플러그인 호환 — 담은 것으로 정합니다. `skills` · `agents` · `mcp` · `tools` · `lsp` · `service` 중 하나라도 있으면 `project`, 아니면 `app`. 새 플러그인은 표준 20번에 따라 늘 적습니다 |

`project` 범위로 고른 값은 이렇게 적힙니다.

| 고른 것 | 어디에 적히나 | 켜지는 곳 |
|---|---|---|
| 모든 프로젝트 | 앱 설정 `settings.extensions` | 모든 프로젝트 |
| 이 프로젝트만 | `<프로젝트>/.litecode/settings.local.json` 의 `plugins` (`{ "plugins": { "sql-tuning": true } }`) | 그 프로젝트만 — 내 PC 에만 |
| 이 프로젝트에서 안 씀 | 같은 파일에 `false` | "모든 프로젝트" 로 켜 두었어도 그 프로젝트에서는 꺼짐 |

- 플러그인은 개인용입니다. 앱은 `settings.local.json` 을 쓸 때마다 그 저장소의 `.git/info/exclude` 에 `/<하위 경로>/.litecode/settings.local.json` 이 있는지 보고 없으면 적습니다 — 처음부터 git 에 올라가지 않습니다(`.gitignore` 는 건드리지 않음). AI 도구의 `.claude/settings.local.json` 과 같은 관례입니다.
- 오른쪽 스위치는 "이 PC 에서 쓰나" 입니다. 끄면 어느 프로젝트에서도 안 쓰고(앱 설정 `pausedExtensions`), 프로젝트별 기록은 그대로라 다시 켜면 전에 고른 범위로 돌아옵니다.
- 켜졌는지는 이 순서로 정합니다: 오른쪽 스위치로 꺼 둠 → 내 기록(`settings.local.json`) → 팀 파일(아래) → "모든 프로젝트" 스위치.

- 옛 방식(`type: locale` · `grammar`) 언어 팩 · 문법 팩은 `scope` 를 적을 수 없습니다. 값이 틀리거나 팩이 적으면 설치 때 `scope-invalid` 로 거절됩니다. 서비스로 만든 팩은 `scope: "app"` 을 적습니다(`register` 가 `app` 서비스에서만 됩니다).
- `app` 이면서 `settingsPer: "project"` 는 됩니다 — 플러그인은 늘 켜져 있고 설정 값만 프로젝트마다 둡니다.
- 설정 값도 켠 방식을 따릅니다: 그 프로젝트에서 켰으면(내 기록 `true` 또는 팀 파일) 프로젝트마다, "모든 프로젝트" 로 켰으면 하나. `settingsPer: "project"` 면 켠 방식과 상관없이 늘 프로젝트마다 둡니다.
- 업데이트로 `scope` 가 바뀌어도 꺼지지 않습니다. `project → app` 은 이 프로젝트로만 켜 두었어도 앱 전체로 켜지고(사용자가 꺼 두었고 적은 프로젝트도 없으면 꺼진 채), `app → project` 는 모든 프로젝트로 켜진 채 시작합니다.
- 개발 모드에서 `project` 플러그인 폴더를 연결하면, [모든 프로젝트] · [이 프로젝트만] 중 하나를 고를 때까지 설치를 기다립니다. 고른 범위는 고른 직후 한 번만 적용하고, 저장해서 다시 설치할 때는 프로젝트 기록과 스위치를 건드리지 않습니다.

### 팀 파일(읽기만)

`<프로젝트>/.litecode/settings.json` 의 `plugins`(팀 파일)는 **앱이 쓰지 않습니다.** 사람이 직접 만들어 커밋한 경우에만 읽습니다 — Lite Harness 의 플러그인은 개인용이라 팀 파일은 부차적입니다.

- 팀 파일에 적힌 플러그인은 그 프로젝트에서 켜지고, 카드에 "팀 파일" 이 표시됩니다. 설치하지 않았거나 적힌 버전보다 낮으면 "이 프로젝트 팀 파일이 쓰는 플러그인" 으로 안내합니다.
- 내 기록(`settings.local.json`)이 팀 파일보다 먼저입니다 — 팀 파일에 있어도 내 기록에 `false` 면 꺼집니다.
- 옮기기: 예전 앱이 팀 파일에 적은 `plugins` 줄은, 그 팀 파일이 git 에 추적되지 않을 때만 앱이 최근 프로젝트를 볼 때 한 번 내 기록 `true` 로 옮기고 그 줄을 지웁니다(비면 키, 파일도). 추적되는 팀 파일은 손대지 않고 읽기만 합니다.

### 프로젝트별(`project`) 플러그인을 만들 때 주의할 점

**값의 몫** — `project` 플러그인이 "모든 프로젝트" 로 켜지지 않았고 **그 프로젝트에서 켜졌을 때만**(내 기록 `true`, 또는 사람이 만든 팀 파일) 패널 `storage.*` · `secrets.*`, 바깥 서버 연결, 설정 값을 프로젝트마다 둡니다. "모든 프로젝트" 로 켰거나, `app` 플러그인이거나, 프로젝트 없이 부르면 모두 한 벌입니다. 프로젝트마다 둘 때는 그 프로젝트에서 처음 쓰기 전까지 예전 한 벌을 읽고, 처음 쓸 때 그 값을 복사해 시작합니다.

**바깥 서버 연결** — 위 몫 규칙대로 프로젝트마다 둘 때 `network.connection` · `setConnection` 은 그 프로젝트 몫을 읽고 씁니다. 그 프로젝트에서 처음 바꾸기 전에는 지금의 한 벌을 그대로 쓰고(같은 origin 이면 토큰도 이어받음), `url: null` 로 끊으면 그 프로젝트만 끊깁니다. 도구 · `tools.run` · MCP 가 받는 `LITECODE_SERVER_URL` · `LITECODE_SERVER_TOKEN` 과 그 origin 으로 가는 `network.fetch` 인증도 부른 프로젝트의 연결을 따릅니다.

**프로젝트별 자료 폴더 `${projectDataDir}`** — 도구 · MCP 의 `args` · `env` 에 쓰면 `<dataDir>/projects/<프로젝트 실제 경로 sha256 앞 16자>/` 가 들어갑니다(쓸 때만 폴더를 만듦). 도구는 부른 프로젝트, MCP 는 서버가 뜬 프로젝트를 따르고, 프로젝트가 없으면(도구 목록 묻기 · [연결 확인]) `${dataDir}` 와 같습니다.

**설정 값은 패널 저장 칸과 따로** — 설정 칸(`settings`) 값은 패널 `storage` 와 다른 곳에 있어서 키가 겹쳐도 서로 덮어쓰지 않고, 패널은 `storage.get` 으로 설정 값을 읽을 수 없습니다. **설정 값은 `settings.summary` 로 읽습니다.** MCP `env` 의 `${storage:키}` · `${secret:키}` 는 설정 칸에 선언된 키면 설정 값만, 선언되지 않은 키면 패널 값(`project` 플러그인이면 그 프로젝트 칸)을 읽습니다.

아래 것들은 **플러그인 하나에 하나**라서 프로젝트마다 나뉘지 않습니다.

- **허용 주소(동의 목록)** — 플러그인 하나에 하나입니다.
- **`${dataDir}`** — 모든 프로젝트가 같은 폴더를 씁니다. 프로젝트별 자료는 위 `${projectDataDir}` 에 둡니다.
- **사용량(`usage.*`)** — 앱 전체 숫자입니다.
- **MCP 도구 목록** — 앱은 tools/list 를 **프로젝트 없이**, 플러그인 하나의 설정 값으로 한 번 물어 기억합니다. 프로젝트별 설정 값(`settingsPer: "project"`)만 쓰는 서버도 env 가 비어 있을 때 **죽지 말고 도구 목록을 답해야** 합니다. 연결은 도구를 부를 때 맺습니다.
- 범위를 "이 프로젝트 → 모든 프로젝트" 로 바꾸면 그 프로젝트의 설정 값을 플러그인 하나의 값 중 **빈 키에만** 복사합니다. 이미 있는 값은 덮어쓰지 않습니다.
- "어딘가 켜짐" 은 최근 프로젝트 목록으로 판단합니다. 목록 밖 프로젝트의 파일에만 적혀 있으면 그 프로젝트를 열 때 실립니다.

## 설치와 수명

`zip 하나가 켜지기까지`

```
zip 고르기 / 저장소에서 받기(sha256 확인)
  → staging/<token>.zip   앱 안 복사본을 검사 (확인 카드에 보인 것 = 설치되는 것)
  → 확인 카드              이름 · 설명 · 권한 · (범위 · 설정 폼)
  → pending/install/<id>/  풀어 두고 → installed/<id>/ 로 바꿔 끼움 (같은 볼륨 rename, 곧바로 적용)
  → 올리기                 상태 on · off · mounting · failed
```

- **설치 검사** — zip 100MB · 항목 2000개 · 풀면 200MB 상한, `..` · 절대 경로 · 링크 · 겹치는 경로 거절, manifest 는 zip 맨 위에 하나, **모르는 manifest 필드 거절**, 모르는 권한 거절(오타면 맞는 이름 제안), `litecode` 보다 낮은 앱 거절.
- **부팅** — 남은 보류 작업 적용(비정상 종료 복구) → `installed/` 를 읽어 manifest 재검증 → 켜진 것을 올림. 폴더 하나가 깨져도 그 플러그인만 `failed` 로 남고 앱은 뜹니다.
- **업데이트** — 같은 길. 권한이 늘었으면 다시 묻습니다. 저장 칸 · 비밀 값은 `data/<id>/` 에 따로 있어 업데이트에도 남고, 지우면 같이 지웁니다.

`userData/extensions/`

```
installed/<id>/      풀린 플러그인
pending/             보류 작업 · 풀어 둔 새 버전
staging/             고른 zip 의 검사용 복사본
data/<id>/           storage · secrets · 허용한 주소 · 바깥 연결 · MCP 도구 목록 · 프로젝트별 설정 값
                     · service-install.json(서비스 번들 sha256) · .service-cache/<해시>.mjs(올리는 번들 사본)
```

## 플러그인 저장소

앱의 **플러그인 저장소** 기능(베타 · 기본 꺼짐)은 이 저장소를 목록 겸 배포처로 씁니다. 꺼져 있으면 서비스 자체가 없어 저장소에 닿지 않습니다.

`저장소에서 앱까지`

```
plugins/<id>/ ──npm run release──▶ dist/<id>-<version>.zip + catalog.json
                                          │  git clone --depth 1 (이 PC 의 git · 로그인, 창 없음, 15초)
                                          │  또는 폴더를 그대로 읽기 (폐쇄망 반입)
                                          ▼
                          userData/extension-repo ──▶ [플러그인 둘러보기]
                                          │  sha256 이 catalog 와 같을 때만
                                          ▼
                                   zip 설치와 같은 길 (staging 검사 → 확인 카드 → 설치)
```

닿지 못하면 마지막 목록을 그대로 보이고 둘러보기 화면에만 사유를 적습니다. 자세한 것은 [README](https://github.com/kim-taehan/lite-harness-plugins#readme).

## 새 자리를 더하려면 (desktop 쪽)

플러그인이 닿는 곳을 넓히는 일은 desktop 저장소의 변경입니다. 지금 구조에서는 보통 이 순서입니다.

0. **서비스가 필요로 하는 일**이면 새 통로 메서드가 아니라 호스트 API 로 더합니다 — `host.call` 이 부를 수 있는 호출 표 메서드(`SERVICE_CALL_METHODS`)나 `host.*`(`src/services/pluginServices/hostApi.ts`)에 더하고 `docs/plugin-sdk/` 생성물을 다시 만듭니다(desktop `node scripts/generate-plugin-sdk.mjs`). 막히는 앱 기능은 이슈 #1614 로 알립니다.
1. **권한**이 새로 필요하면 `shared/extensions.ts` 의 `EXTENSION_PERMISSIONS` 에 더하고 의미를 주석으로 적습니다(설치 카드에 보일 문구도).
2. **메서드**를 `calls/table.ts` 의 `CALL_TABLE` 에 권한 · 처리와 짝지어 더하고, 처리 코드는 `calls/` 에 둡니다. 실패는 던지지 않고 `ExtensionCallError` 코드로 돌려줍니다.
3. **화면이 해야 하는 일**(파일 열기 · 대화 열기처럼)이면 메인은 권한 · 모양만 보고, 실제 동작은 화면의 통로(`renderer/extensionBridge.ts`)가 합니다.
4. **manifest 필드**가 새로 필요하면 `manifest.ts` 의 `KNOWN` 과 검사를 더합니다 — 모르는 필드 거절 규칙 때문에, 새 필드를 쓰는 플러그인에는 `litecode`(최소 앱 버전)를 적어, 옛 앱의 거절 카드에 "앱 버전이 낮음" 사유가 같이 보이게 합니다.
5. 이 사이트의 [권한 표](guides/first-panel.md#앱-통로와-권한)와 이 문서의 표를 같이 고칩니다.

## 정본

| 무엇 | desktop 의 파일 |
|---|---|
| manifest 모양 · 권한 · 거절 사유 · 통로 오류 | `shared/extensions.ts` |
| manifest 검사 | `src/services/extensions/manifest.ts` · 선언 종류 표 `shared/extensions/declarations.ts` |
| 서비스 선언 · 허용 목록(`inject` · 소식 · `api` 버전) | `shared/extensions/serviceApi.ts` · `src/services/extensions/service/serviceDeclaration.ts` |
| 서비스 올리기 · 호스트 API · 등록(`locale` · `grammars` …) | `src/services/pluginServices/` (`pluginServices.ts` · `hostApi.ts` · `registrations/`) |
| 서비스 작성 안내 · 타입 · 가짜 host (생성물, 원본은 desktop) | `docs/plugin-sdk/` (`README.md` · `litecode-service.d.ts` · `plugin-service.schema.json` · `litecode-service-testing.mjs`) — 이 저장소 `sdk/` 는 그 사본 |
| 메서드 ↔ 권한 · 처리 | `src/services/extensions/calls/table.ts` |
| 상한 값 (알림 상한 포함) | `src/services/extensions/install/limits.ts` |
| 설치 · 부팅 · 분배 | `src/services/extensions/extensions.ts` · `install/store.ts` · `data.ts` |
| MCP 서버 · 도구 · 스킬 · 범위 | `mcp/servers.ts` · `tools/runner.ts` · `skills.ts` · `scope/` |
| 언어 서버 정의 검사 · 띄우기 | `shared/extensions/lspDeclaration.ts` · `lsp/lspLaunch.ts`, 올리기는 서비스의 `host.lsp.register`(`pluginServices/registrations/lsp.ts`), 잇기는 `src/services/lsp/` |
| 알림 | `notify/notices.ts` |
| 앱 소식 (이벤트 ↔ 권한) | `shared/extensions.ts` 의 `PANEL_EVENT_PERMISSIONS` · 구독은 `calls/table.ts` 의 `events.subscribe` |
| 에이전트 | `agents/register.ts` · 검사는 `manifest.ts` (`agents-invalid`) |
| 패널 자산 (같은 zip 의 js · css · 이미지) | `install/panelAssets.ts` · 참조 고르기는 `renderer/htmlPreview.ts` |
| 패널 탭 · 통로 · CSP | `renderer/ExtensionTab.tsx` · `extensionBridge.ts` · `htmlPreview.ts` |
| 플러그인 저장소 | `src/services/extensionRepo/` |

이 문서와 코드가 다르면 코드가 맞습니다 — [이슈](https://github.com/kim-taehan/lite-harness-plugins/issues)로 알려 주세요.
