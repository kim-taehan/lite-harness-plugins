[← 가이드 목록](README.md)

# 플러그인 구조

플러그인이 앱의 어디에 닿고 어디에 닿지 못하는지, 그 경계를 앱이 어떻게 지키는지. 가이드를 따라 하다 "이건 왜 안 되지?" 싶을 때 읽는 문서입니다.

*기준: lite-harness-desktop dev · 정본: shared/extensions.ts · src/services/extensions/*

## 한눈에

플러그인은 zip 하나입니다. 앱은 그것을 검사해 풀어 두고, 담긴 것의 종류에 따라 서로 다른 자리에 올립니다. 플러그인의 코드는 **앱의 메인 프로세스 안에서 돌지 않습니다** — 패널은 격리된 iframe 에서, MCP 서버와 도구는 따로 띄운 프로세스에서 돌고, 앱에 무언가를 부탁하는 길은 정해진 통로뿐입니다.

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
              │                        └─ mcp.call            → 아래 MCP 서버
              │
              ├─ mcp ─────────▶ 앱 내장 MCP(appMcp) 에 <id>_<도구> 로 올림 ──▶ 엔진(opencode) ──▶ AI
              │                   └ 처음 부를 때 서버 프로세스를 띄움 (프로젝트마다 하나, stdio)
              ├─ tools ───────▶ 같은 자리, 부를 때마다 실행 파일 한 번 (stdin JSON → stdout JSON)
              ├─ skills ──────▶ 앱 스킬 폴더로 복사 (userData/opencode/skills) ──▶ 엔진
              ├─ settings ────▶ 앱이 그리는 설정 폼 → storage · secrets → mcp.env 자리표시
              ├─ type locale ─▶ 화면 · 메인 문구 사전 (설정 › 일반 › 언어)
              └─ type grammar ▶ 파일 개요(ctx.treeSitter) 의 언어 표
```

## 건드릴 수 있는 곳

| 자리 | 하는 일 | manifest | 권한 |
|---|---|---|---|
| 오른쪽 패널 탭 | 진입 HTML 이 `+` 메뉴의 탭으로 열림(같은 zip 의 스크립트 · 스타일시트 · 이미지는 앱이 읽어 넣음), 전체 화면(`panel.fullscreen`) | `entry` | 없음 |
| 가운데 탭 | 같은 패널을 대화 옆 가운데 탭 줄에 둠(`+` 메뉴에는 안 나옴), 지금 대화 읽기(`chat.current` · `chat.currentChanged`) | `placement: "center"` | 없음 (대화는 `chat`) |
| 파일 우클릭 | 파일 트리 · 파일 탭 메뉴에 "이 플러그인으로 열기", 그 플러그인 탭(오른쪽 또는 가운데)을 열고 고른 파일 경로를 넘김(`panel.args`) | `fileActions` | `project` |
| 앱 소식 | 패널이 `events.subscribe` 로 고른 이벤트(턴 끝 · AI 가 쓴 파일 · 연 탭 · 사용량 · 설정 저장)를 받음, 이벤트마다 그 권한 | — | 이벤트마다 |
| 에이전트 | 플러그인이 담아 온 서브에이전트 `.md` 가 `.litecode/agents` 처럼 엔진에 실림 (범위 플러그인) | `agents` | 없음 |
| 앱 알림 | 앱이 그리는 토스트(플러그인 이름 + 제목 + 본문), 누르면 그 플러그인 탭. 패널의 `panel.notify` · `tools` 도구 결과의 `notify` 로 냄 (MCP 서버는 직접 못 냄) | — | 없음 |
| 플러그인 저장 칸 | 플러그인별 JSON 값 (`storage.*`, 64KB) | — | 없음 |
| 프로젝트 읽기 | 이름 · 파일 읽기 · 목록 · 찾기 · 크기 · git 바뀐 파일 · 연 탭 · 앱 미리보기로 열기 · 고르기 창 | — | `project` |
| 프로젝트 문서 쓰기 | `.litecode/` 바로 아래 `.md` 쓰기 · 지우기 (팀이 커밋하는 표준 문서) | — | `projectWrite` |
| 대화 | 새 대화를 열고 입력창 채우기 · 바로 보내기, 대화 제목 · 열기 | — | `chat` |
| AI 도구 (서버) | MCP 서버를 실어 AI 가 부르는 도구로 올림, 패널도 같은 서버를 부름 | `mcp` | `mcp` |
| AI 도구 (한 번 실행) | 부를 때마다 실행 파일 하나를 돌림 | `tools` | `tools` |
| 스킬 | 켜져 있는 동안 앱 스킬로 보임, 패널이 자기 스킬에 `.md` 덧씌우기(`skills.*`) | `skills` | 없음 |
| 설정 폼 | 설치 2단계 · [고치기] 에 앱이 그리는 폼, [연결 확인] | `settings` · `settingsCheck` | 없음 |
| 비밀 값 | 토큰 · 비밀번호를 이 기기에 암호화 (`secrets.*`) | — | `secrets` |
| 바깥 요청 | 메인이 대신 요청, 바깥 서버 연결(주소 · 토큰) 보관 | — | `network` |
| 사용량 | 토큰 사용량 숫자 (대화 글 · 제목 없음) | — | `usage` |
| 화면 언어 | 앱 문구 번역 | `type: locale` | 가질 수 없음 |
| 파일 개요 | 새 언어의 클래스 · 함수 개요 | `type: grammar` | 가질 수 없음 |

패널이 부를 수 있는 메서드 전체와 권한의 짝은 [calls/table.ts](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/src/services/extensions/calls/table.ts) 의 `CALL_TABLE` 한 곳에 있습니다. 표에 없는 메서드는 `method-unknown` 입니다.

## 건드릴 수 없는 곳

- **화면의 다른 자리** — 왼쪽 패널, 대화 화면과 메시지, 입력창 UI, 설정 화면 배치. 플러그인 화면은 오른쪽 패널 탭 또는 가운데 탭 하나, 파일 우클릭 메뉴 항목, 앱이 그려 주는 설정 폼뿐입니다.
- **엔진과 모델** — 엔진 설정, 모델 · provider, API 키. 키 프록시 · 엔진 · 데스크탑 MCP · 모바일 연결 같은 앱 자신의 로컬 서버 주소는 `network` 권한이 있어도 `address-reserved` 로 막힙니다.
- **프로젝트 밖** — 경로는 프로젝트 기준 상대 경로만, `..` · 절대 경로 · 프로젝트 밖을 가리키는 링크는 `path-unsafe`. 쓰기는 `.litecode/*.md` 만.
- **다른 플러그인** — 저장 칸 · 비밀 값은 플러그인마다 폴더가 따로이고, 플러그인 id 는 메시지 내용이 아니라 어느 iframe 에서 왔는지로 정해 흉내 낼 수 없습니다.
- **비밀 값 다시 읽기** — MCP 서버 env 에 쓰이는 비밀 키는 패널이 쓰기만 하고 읽지 못합니다(`secret-write-only`).
- **대화 내용** — 대화 글은 읽지 못합니다. `chat` 은 새 대화를 여는 쪽, `usage` 는 숫자만입니다.

> 새 자리가 필요하면(예: 왼쪽 패널 위젯, 메시지에 버튼) 이 저장소가 아니라 desktop 에 통로 메서드나 권한을 더해야 합니다 — [아래](#새-자리를-더하려면-desktop-쪽).

## 패널: 격리와 통로

- 메인은 진입 HTML 을 **읽어 화면에 넘길 뿐 실행하지 않습니다**. 화면이 `sandbox="allow-scripts"` iframe 에 CSP 를 맨 앞에 붙여 돌립니다.
- CSP 가 `fetch` · XHR · WebSocket · 외부 스크립트/스타일/이미지/글꼴 · 하위 iframe · 폼 전송을 막습니다. 인라인 스크립트 · 스타일은 됩니다. 링크 · `location` 같은 이동은 메인이 막습니다.
- 같은 zip 의 자산은 진입 HTML 이 직접 적은 `<script src>`(module 제외) · `<link rel="stylesheet">` · `<img src>` 만, 메인이 설치 폴더 안에서 안전하게 읽어(진입 HTML 과 같은 읽기) 화면이 iframe 안에 글 · `data:` 주소로 바꿔 넣습니다. 64개 · 하나 4MB · 합쳐 32MB, 넘거나 못 읽은 것은 조용히 빠집니다. 플러그인이 꺼져 있거나 그 프로젝트에서 켜지지 않았으면 비어 있습니다 — [패널 가이드](guides/first-panel.md#같은-zip-의-파일-쓰기).
- 요청은 `parent.postMessage({ litecode: 1, id, method, params })`, 답은 `{ litecode: 1, id, ok, result | error }`. 화면은 **자기 탭의 iframe 에서 온 메시지만** 받아 IPC 로 메인에 넘기고, 메인이 manifest `permissions` 로 검사합니다.
- 처음 가는 주소는 화면이 iframe **바깥**에 동의 띠를 그려 묻습니다 — 플러그인이 흉내 낼 수 없는 자리입니다. 허용한 주소는 플러그인 카드에 남습니다.
- 바깥 요청은 메인이 Chromium 네트워크로 보냅니다(사내 CA · 시스템 프록시를 따름, 쿠키 안 실음). http/https 만, 같은 origin 리다이렉트만, 기한 15초, 응답 5MB.

## AI 에 붙는 것: MCP · 도구 · 스킬

- **MCP 서버** — 도구 목록은 서버에게 한 번 묻고 플러그인 버전 · 선언마다 기억합니다(앱을 다시 켜도 서버를 띄우지 않음). AI 가 처음 부를 때 서버를 띄우고, 프로젝트 폴더마다 하나, 작업 폴더는 그 프로젝트. 쉬면(`idleMs`) · 꺼지면 · 버전이 바뀌면 내리고, env 자리표시 값이 바뀌면 다음 호출에 새로 띄웁니다.
- **도구 이름** — 앱 내장 MCP 에 `<id>_<도구>` 로 올라가 AI 에게는 `litecode_<id>_<도구>`. 그래서 플러그인 id 는 앱 기능 이름 · 내장 MCP 이름(`litecode` · `chrome`)과 겹칠 수 없습니다.
- **실행** — `.mjs` · `.js` 는 앱 실행 파일을 Node 로 돌립니다(`ELECTRON_RUN_AS_NODE`). 사용자 PC 에 Node 가 없어도 되지만 `node_modules` 도 없어 의존성은 묶어 싣습니다. 셸은 거치지 않습니다.
- **앱은 서버 내용을 모릅니다** — 실행 파일을 띄우고 MCP 로 잇기만 합니다. 서버가 무엇을 하는지는 설치 카드의 설명 · 권한과 사용자의 판단에 맡깁니다.
- **스킬** — 실행이 아니라 글을 옮기는 것입니다. 스킬 폴더를 통째로 앱 스킬 폴더에 쓰고 표식 파일을 둬서, 같은 이름의 사용자 스킬은 건드리지 않습니다. 꺼지거나 지워지면 지웁니다.

## 적용 범위

AI 에 붙는 플러그인(`skills` · `mcp` · `tools` 중 하나라도)은 설치할 때 범위를 고릅니다. 화면만 있는 플러그인과 팩은 늘 앱 전체입니다.

| 범위 | 어디에 적히나 | 켜지는 곳 |
|---|---|---|
| 모든 프로젝트 | 앱 설정 `settings.extensions` | 모든 프로젝트 |
| 이 프로젝트 | `<프로젝트>/.litecode/settings.json` 의 `plugins` (`{ "plugins": { "sql-tuning": "0.9.1" } }`) | 그 프로젝트만 — 커밋하면 팀원 PC 에서도 켜짐(설치는 각자) |

설정 값도 범위를 따릅니다: 이 프로젝트 범위면 프로젝트마다, 모든 프로젝트면 하나. `settingsPer: "project"` 면 범위와 상관없이 늘 프로젝트마다 둡니다.

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

1. **권한**이 새로 필요하면 `shared/extensions.ts` 의 `EXTENSION_PERMISSIONS` 에 더하고 의미를 주석으로 적습니다(설치 카드에 보일 문구도).
2. **메서드**를 `calls/table.ts` 의 `CALL_TABLE` 에 권한 · 처리와 짝지어 더하고, 처리 코드는 `calls/` 에 둡니다. 실패는 던지지 않고 `ExtensionCallError` 코드로 돌려줍니다.
3. **화면이 해야 하는 일**(파일 열기 · 대화 열기처럼)이면 메인은 권한 · 모양만 보고, 실제 동작은 화면의 통로(`renderer/extensionBridge.ts`)가 합니다.
4. **manifest 필드**가 새로 필요하면 `manifest.ts` 의 `KNOWN` 과 검사를 더합니다 — 모르는 필드 거절 규칙 때문에, 새 필드를 쓰는 플러그인에는 `litecode`(최소 앱 버전)를 적어, 옛 앱의 거절 카드에 "앱 버전이 낮음" 사유가 같이 보이게 합니다.
5. 이 사이트의 [권한 표](guides/first-panel.md#앱-통로와-권한)와 이 문서의 표를 같이 고칩니다.

## 정본

| 무엇 | desktop 의 파일 |
|---|---|
| manifest 모양 · 권한 · 거절 사유 · 통로 오류 | `shared/extensions.ts` |
| manifest 검사 | `src/services/extensions/manifest.ts` |
| 메서드 ↔ 권한 · 처리 | `src/services/extensions/calls/table.ts` |
| 상한 값 (알림 상한 포함) | `src/services/extensions/install/limits.ts` |
| 설치 · 부팅 · 분배 | `src/services/extensions/extensions.ts` · `install/store.ts` · `data.ts` |
| MCP 서버 · 도구 · 스킬 · 범위 | `mcp/servers.ts` · `tools/runner.ts` · `skills.ts` · `scope/` |
| 알림 | `notify/notices.ts` |
| 앱 소식 (이벤트 ↔ 권한) | `shared/extensions.ts` 의 `PANEL_EVENT_PERMISSIONS` · 구독은 `calls/table.ts` 의 `events.subscribe` |
| 에이전트 | `agents/register.ts` · 검사는 `manifest.ts` (`agents-invalid`) |
| 패널 자산 (같은 zip 의 js · css · 이미지) | `install/panelAssets.ts` · 참조 고르기는 `renderer/htmlPreview.ts` |
| 패널 탭 · 통로 · CSP | `renderer/ExtensionTab.tsx` · `extensionBridge.ts` · `htmlPreview.ts` |
| 플러그인 저장소 | `src/services/extensionRepo/` |

이 문서와 코드가 다르면 코드가 맞습니다 — [이슈](https://github.com/kim-taehan/lite-harness-plugins/issues)로 알려 주세요.
