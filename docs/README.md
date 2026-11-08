# 플러그인 가이드

Lite Harness 에 화면 · AI 도구 · 언어를 더하는 플러그인을 만드는 법. 가이드마다 하나를 처음부터 끝까지 만들고, 15~30분이면 따라 할 수 있습니다.

## 시작하기

위에서부터 순서대로 읽으면 패널 → AI 도구 → 팩 → 배포까지 이어집니다.

| 가이드 | 만드는 것 | 시간 · 다루는 것 |
|---|---|---|
| [첫 패널 플러그인 만들기](guides/first-panel.md) | `plugin.json` 과 `index.html` 로 오른쪽 패널 탭을 만들고, 앱 통로로 값을 저장하고 프로젝트 이름을 읽고 AI 에게 말을 보냅니다. | 15분 · storage · project · chat |
| [MCP 플러그인 만들기](guides/mcp-plugin.md) | AI 가 부를 수 있는 도구를 MCP 서버로 싣습니다. 설정 칸 · 비밀 값 · [연결 확인] · 같이 설치되는 스킬, 그리고 `build.mjs` 로 한 파일에 묶기까지. | 30분 · mcp · settings · skills |
| [언어 팩 · 문법 팩 만들기](guides/locale-grammar.md) | 코드 없이 데이터만 담는 플러그인. 앱 문구를 다른 언어로 바꾸는 언어 팩과, 파일 개요가 새 언어를 읽게 하는 tree-sitter 문법 팩. | 20분 · type: locale · grammar |
| [저장소로 내보내기](guides/publish.md) | 만든 플러그인을 이 저장소에 올려 앱의 [플러그인 둘러보기] 에 보이게 합니다. 분류 · 바뀐 것 · `npm run release` · 버전 규칙. | 10분 · catalog.json · dist |

## 참고

가이드보다 자세한 규칙과 실제 플러그인 원본.

- [플러그인 구조](architecture.md) — 닿는 곳 · 닿지 못하는 곳 · 격리 · 수명 · 새 자리 더하기
- [플러그인 표준](https://github.com/kim-taehan/lite-harness-plugins/blob/main/.claude/rules/plugin.md) — 만들거나 고칠 때 지키는 규칙 (커밋 전 심사 · 머지 전 테스트가 확인)
- [저장소 README](https://github.com/kim-taehan/lite-harness-plugins#readme) — 구조 · catalog.json · 버전 규칙 · 앱이 읽는 법
- [실제 플러그인 원본](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins) — token-pet · sql-tuning · ui-test …
- [앱 아키텍처 5절 · 플러그인](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/docs/architecture.md) — 격리 · 권한 · 설치 검사 · 적용 범위
- [manifest 정의 (shared/extensions.ts)](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/shared/extensions.ts) — 필드 · 권한 · 거절 사유의 정본

고칠 곳이 보이면 [이슈](https://github.com/kim-taehan/lite-harness-plugins/issues)나 PR 로 알려 주세요.
