# 플러그인 가이드

Lite Harness 에 화면 · AI 도구 · 언어를 더하는 플러그인을 만드는 법. 가이드마다 하나를 처음부터 끝까지 만들고, 15~30분이면 따라 할 수 있습니다.

## 처음 만든다면 — 5분 시작

서비스 플러그인(코드를 가진 플러그인)을 처음부터 끝까지 한 번 돌려 봅니다.

1. **`dev` 에서 브랜치를 땁니다.** `git switch dev && git pull && git switch -c feat/<이름>` — PR 은 `dev` 로 보내고 `main` 에는 직접 올리지 않습니다(`main` · `dev` 직접 push 는 훅이 막습니다. [작업 흐름](https://github.com/kim-taehan/lite-harness-plugins/blob/dev/.claude/rules/workflow.md)).
2. **뼈대를 만듭니다.** `npm ci`(처음 한 번) 뒤 `npm run new-plugin -- <id> --name "<이름>" [--scope app|project]`. `plugins/<id>/` 에 `plugin.json` · `service/index.mjs` · `build.mjs` · 패널 `index.html` · `tests/service.test.ts` · `README.md` 가 생기고, 새 id 는 `categories.json` 에 `unlisted` 로 적혀 release 에 실수로 나가지 않습니다.
3. **앱 없이 시험합니다.** `npm test -- --project <id>` — 가짜 host 로 서비스를 시험합니다.
4. **앱에 연결해 고칩니다.** `node plugins/<id>/build.mjs --dir` 로 `build/<id>/` 를 낸 뒤, 앱의 설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결] 로 그 폴더를 연결합니다(개발 모드는 개발 실행 `npm run dev` 나 플러그인 개발자용 설치본에서만 있습니다). 고친 뒤 `build.mjs --dir` 를 다시 돌리면 앱이 1초 조용해진 뒤 다시 읽습니다. 막히면 [막혔을 때](guides/troubleshooting.md).
5. **올립니다.** 커밋 전에 `/convention-review` 로 표준과 대조하고, PR 을 `dev` 로 보냅니다(`gh pr create --base dev`). 목록에 내는 배포는 승격 때 따로 합니다 — [저장소로 내보내기](guides/publish.md).

자세한 설명은 아래 각 절과 [서비스 플러그인 만들기](guides/service-plugin.md)에 있습니다.

## 먼저 정할 것: 앱 전체용인가, 프로젝트별인가

새 플러그인을 만들기 전에 **가장 먼저** 정합니다. manifest 의 `scope` 한 줄이고, 새 플러그인은 꼭 적어야 합니다(표준 20번).

| | `"scope": "app"` — 앱 전체용 | `"scope": "project"` — 프로젝트별 |
|---|---|---|
| 켜지는 곳 | 설치하면 모든 프로젝트에서 늘 켜짐. 설치 때 범위를 묻지 않음 | 설치 때 "모든 프로젝트 / 이 프로젝트만" 을 고름(내 PC 에만 기록). 켜지지 않은 프로젝트에서는 탭 · 메뉴 · 도구 · 스킬 · 에이전트 어디에도 안 나옴 |
| 어울리는 것 | 어느 프로젝트에서나 같은 것 — 사용량 · 놀이 · 개인 도구 | 프로젝트마다 다른 것 — DB 연결 · 사내 서버 · 그 코드베이스의 언어 |
| 예 | 빛톨 키우기(token-pet) | SQL 튜닝(sql-tuning) · UI 테스트(ui-test) |

고르는 기준: 프로젝트마다 설정이나 다루는 코드가 다르면 `project`, 아니면 `app`. 플러그인은 각자 개인이 켜서 씁니다 — `project` 로 켠 기록도 내 PC 에만 남고 git 에 올라가지 않습니다. 자세한 동작과 주의할 점은 [플러그인 구조 · 적용 범위](architecture.md#적용-범위).

## 플러그인마다 README.md

플러그인 폴더마다 `README.md` 를 둡니다(표준 22번). 처음 보는 사람이 **무엇을 하는지(역할) → 무엇으로 되어 있는지(구성) → 어떻게 고치고 확인하고 올리는지(개발)** 를 이 파일 하나로 알게 하려는 것입니다.
저장소에서 보는 문서라 zip 에는 들어가지 않습니다. 사용자가 앱에서 보는 설명은 manifest 의 `description` · `details`, 업데이트 글은 `changes.txt` 입니다.

세 절은 꼭 이 제목으로 둡니다(테스트가 봅니다). 그 밖의 절(설정 · 한계 · 확인한 것 · 쓰는 법 등)은 플러그인에 맞게 더합니다.

````markdown
# <id> — <이름>

<한두 줄 — 무엇을 하는 플러그인인가. manifest description 과 같은 뜻>

## 역할

- 하는 일: 사용자가 얻는 것
- 앱에 닿는 자리: 서비스(`service`) · 패널 · AI 도구(`host.tools` · mcp · tools) · 스킬 · 언어 서버(서비스의 `host.lsp.register`) · 언어 팩 · 문법 팩 중 무엇
- 범위: `scope`(app · project) 와 그렇게 고른 이유 (언어 · 문법 팩 서비스는 `app`)
- 권한: 권한마다 왜 필요한지 (없으면 "없음")

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — … |
| `service/index.mjs` | 서비스 원본 — 앱 안에서 도는 코드(서비스 플러그인만) |
| `build.mjs` | 서비스를 `service.mjs` 한 파일로 묶기, `--dir` 이면 개발 폴더(서비스 · 번들이 있는 플러그인) |
| … | … |

## 개발

- 묶기: `build.mjs` 가 하는 일과 `--dir` 개발 폴더 (없으면 "폴더를 그대로 묶음"). 서비스 플러그인은 `service.mjs` 한 파일로 묶는다
- 테스트: `npm test -- --project <id>` 가 보는 것, 실제 서버 · DB 가 필요해 못 보는 것
- 배포: 목록에 낼 때 `npm run release -- --changed`(dev 에서는 돌리지 않고 승격 때 — [작업 흐름](https://github.com/kim-taehan/lite-harness-plugins/blob/dev/.claude/rules/workflow.md)), 플랫폼 전용이면 `npm run release <id> --platform …`
````

## 시작하기

위에서부터 순서대로 읽으면 패널 → 서비스 → AI 도구 → 팩 → 언어 서버 → 배포까지 이어집니다. 코드를 가진 플러그인은 서비스가 기본 길입니다.

| 가이드 | 만드는 것 | 시간 · 다루는 것 |
|---|---|---|
| [첫 패널 플러그인 만들기](guides/first-panel.md) | `plugin.json` 과 `index.html` 로 오른쪽 패널 탭을 만들고, 앱 통로로 값을 저장하고 프로젝트 이름을 읽고 AI 에게 말을 보냅니다. | 15분 · storage · project · chat |
| [서비스 플러그인 만들기](guides/service-plugin.md) | 패널을 닫아도 앱 안에서 도는 코드. 앱 소식 받기 · 앱 기능 부르기(`host.call`) · 패널에 밀어 보내기(`host.panel.emit`) · AI 도구 · 정리와 테스트(가짜 host). | 30분 · service · host · events |
| [MCP 플러그인 만들기](guides/mcp-plugin.md) | AI 가 부를 수 있는 도구를 MCP 서버로 싣습니다. 설정 칸 · 비밀 값 · [연결 확인] · 같이 설치되는 스킬, 그리고 `build.mjs` 로 한 파일에 묶기까지. | 30분 · mcp · settings · skills |
| [언어 팩 · 문법 팩 만들기](guides/locale-grammar.md) | 앱 문구를 다른 언어로 바꾸는 언어 팩과, 파일 개요가 새 언어를 읽게 하는 tree-sitter 문법 팩. 데이터를 앱에 올리기만 하는 작은 서비스로 만듭니다. | 20분 · service · host.locale · host.grammars |
| [언어 서버(LSP) 플러그인 만들기](guides/lsp-plugin.md) | 언어 서버를 실어 파일 보기와 AI 가 그 언어의 오류 · 정의 · 참조 · 설명을 정확하게 얻게 합니다. 서비스의 `host.lsp.register` · `${lspWorkspaceDir}` · 런타임 동봉 · 폐쇄망 설정 · 플랫폼 전용 묶기. | 30분 · service · host.lsp · build.mjs |
| [저장소로 내보내기](guides/publish.md) | 만든 플러그인을 이 저장소에 올려 앱의 [플러그인 둘러보기] 에 보이게 합니다. `dev` 에서 브랜치 · 분류 · 바뀐 것 · 변경분만 `npm run release -- --changed` · 승격 · 버전 규칙. | 10분 · catalog.json · dist |
| [막혔을 때 — 오류 원인 · 해결](guides/troubleshooting.md) | 설치가 거절되거나(`field-unknown` · `service-invalid` …) 패널 호출이 실패할 때(`service-off` · `not-on` · `method-unknown` …) 코드마다 원인과 고치는 법. | 찾아보기 · 오류 코드 |

## 참고

가이드보다 자세한 규칙과 실제 플러그인 원본.

- [플러그인 구조](architecture.md) — 닿는 곳 · 닿지 못하는 곳 · 서비스와 호스트 API · 격리 · 수명 · 새 자리 더하기
- [플러그인 표준](https://github.com/kim-taehan/lite-harness-plugins/blob/dev/.claude/rules/plugin.md) — 만들거나 고칠 때 지키는 규칙 (커밋 전 심사 · 머지 전 테스트가 확인)
- [저장소 README](https://github.com/kim-taehan/lite-harness-plugins#readme) — 구조 · catalog.json · 버전 규칙 · 앱이 읽는 법
- [실제 플러그인 원본](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins) — token-pet · sql-tuning · ui-test …
- [앱 아키텍처 5절 · 플러그인](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/docs/architecture.md) — 격리 · 권한 · 설치 검사 · 적용 범위 · 5-2 설치형 서비스
- [플러그인 서비스 작성 안내 (docs/plugin-sdk)](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/docs/plugin-sdk/README.md) — 서비스 타입 · 호스트 API · 가짜 host (이 저장소의 `sdk/` 는 그 사본)
- [manifest 정의 (shared/extensions.ts)](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/shared/extensions.ts) — 필드 · 권한 · 거절 사유의 정본

고칠 곳이 보이면 [이슈](https://github.com/kim-taehan/lite-harness-plugins/issues)나 PR 로 알려 주세요(`dev` 에서 브랜치를 따고 PR 은 `dev` 로).
