# Lite Harness — plugins

lite-harness-desktop 앱에 까는 플러그인의 원본과 카탈로그.
`plugins/<폴더>` 가 원본, `catalog.json` + `dist/*.zip` 이 앱이 읽어 가는 배포물이다.

## 먼저 가이드를 읽는다
플러그인은 보통의 웹·npm 개발과 다르다. zip 하나에 `plugin.json` 을 넣어 앱이 검사해서 깔고,
패널은 샌드박스 iframe 안에서 앱 통로(postMessage)로만 바깥에 닿고, 코드를 가진 플러그인은 **서비스**(`service` 선언 — 앱 프로세스 안에서 도는 한 파일 번들)가 기본이다(desktop #1614).
패널은 `service.call` 한 통로로 서비스에 말하고 서비스가 `host.call` 로 앱 기능을 부른다. 옛 선언 방식(`type: locale/grammar`, 패널이 앱 통로로 직접 부르기)은 desktop 이 지우기 전까지 병행하고,
별도 프로세스가 맞는 일(오래 걸리는 일 · 비밀 · 무거운 라이브러리)은 `mcp`·`tools`·`lsp` 선언이나 서비스가 `host.mcp.register` 로 올린 MCP 서버(앱의 Node 로 뜬다)가 맡는다.
익숙한 방식대로 짜면 설치가 거절되거나 패널에서 아무것도 안 된다.
그래서 플러그인을 만들거나 고치기 전에 하려는 일에 맞는 가이드를 먼저 읽고 그대로 따른다.

| 하려는 일 | 읽을 것 |
|---|---|
| 앱의 어디에 닿을 수 있는지, 무엇이 막혀 있는지 | `docs/architecture.md` |
| 화면(패널) 플러그인 — manifest, 앱 통로, 권한 | `docs/guides/first-panel.md` |
| 코드를 가진 플러그인(서비스) — 번들 · 소식 · `host.call` · 상태 · 가짜 host 시험 | `docs/guides/service-plugin.md` |
| AI 가 쓰는 도구(MCP 서버) — 설정 폼, settingsCheck, 스킬, 번들 | `docs/guides/mcp-plugin.md` |
| 언어 서버(LSP) — lsp 선언, 런타임 동봉, 플랫폼 전용 | `docs/guides/lsp-plugin.md` |
| 화면 언어 팩 · 코드 문법 팩 | `docs/guides/locale-grammar.md` |
| 플러그인마다 두는 README.md 형식 | `docs/README.md` "플러그인마다 README.md" |
| 저장소에 올리기 · 버전 · 목록에서 내리기 | `docs/guides/publish.md` |

가이드와 desktop 코드가 어긋나면 desktop 코드가 정본이다(`docs/architecture.md` 의 "정본" 표).
그때는 코드를 따르고 가이드도 같은 PR 에서 고친다.
개발표준은 `.claude/rules/plugin.md` 에만 적는다 — 가이드는 그 이유와 예제, 여기에는 링크만 둔다.
커밋 전에 `/convention-review` 로 변경을 표준과 대조한다.
브랜치 · 머지 · 배포 흐름은 `.claude/rules/workflow.md` — `dev` 에서 브랜치를 따 PR 은 `dev` 로, 배포(`npm run release -- --changed`)는 승격 때만 한다.
훅(`.claude/settings.json`)이 main·dev 직접 push, 심사 없는 커밋, `catalog.json`·`dist/` 손편집, 테스트 없는 머지를 막고,
원본만 바뀌고 version 이 그대로인 push 에는 경고한다.

## 명령
- `npm test` — 전부: 플러그인 테스트 + catalog ↔ dist 정합 + 표준 검사
- `npm test -- --project <id>` — 그 플러그인 테스트만 (플러그인 하나를 고칠 때)
- `npm run test:changed` — 바뀐 플러그인 테스트 + 공통 검사 (머지 조건, 머지 훅이 돌린다)
- `npm run release <폴더…>` · `--all` · `--changed [--dry-run]` · `--zip <파일>` — dist 와 catalog.json 갱신 (자세한 건 `docs/guides/publish.md`)
- `npm run sync:sdk` — 옆 `../desktop/docs/plugin-sdk/` 생성물을 `sdk/` 로 복사 (`node scripts/sync-sdk.mjs --check` 는 같은지만 본다. 위치가 다르면 `LITECODE_DESKTOP=<desktop 폴더>`)

## 디렉터리
`plugins/` 원본(플러그인마다 폴더) · `scripts/` release·문법 팩 빌드·sdk 동기화 · `sdk/` desktop 이 만든 서비스 SDK 사본(타입 · 가짜 host) · `dist/` 배포 zip
· `categories.json` 분류(`unlisted` 면 목록에서 내림) · `docs/` 가이드(마크다운, GitHub Pages 로도 보임)
