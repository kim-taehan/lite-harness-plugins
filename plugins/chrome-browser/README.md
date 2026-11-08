# chrome-browser — Chrome in Lite Harness

AI 전용 Chrome 창을 띄워, 동봉한 Playwright MCP 서버로 AI 가 페이지를 읽고 누르고 글자를 입력하게 한다.

## 역할

- 하는 일: AI 가 대화 중에 웹 페이지를 열어 읽고 조작한다. 평소 쓰는 Chrome 과 프로필이 따로라 그 창의 로그인만 남는다. Windows 에서 Chrome 이 없으면 Edge 를 쓴다.
- 앱에 닿는 자리: AI 도구(MCP)와 상태만 보이는 작은 패널. 오른쪽 패널의 브라우저 탭과는 다른 브라우저다.
- 범위: `scope` 없음(배포된 옛 플러그인 — 다음 업데이트 때 정한다, 표준 21번).
- 권한: `mcp` — Playwright MCP 를 중계하는 서버를 앱이 띄운다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `extension.json` | manifest — `mcp`(`server.mjs ${dataDir}`, 10분 쉬면 내림), 패널 |
| `server.mjs` | 중계 MCP 서버 — 동봉한 `@playwright/mcp` 를 같은 Node 로 띄우고, 위험하거나 드문 도구(`DENIED`: 임의 코드 · 파일 올리기 등)를 목록에서 빼고 불러도 거절한다(남는 도구 12개). 지난 실행이 남긴 전용 프로필 Chrome 을 닫고, 내려갈 때 자식 서버를 끝낸다. 프로필은 `<dataDir>/profile`, 스크린샷 등은 `<dataDir>/output` |
| `index.html` | 패널 — 상태(확인 중 · 다시 보기)와 쓰는 법 · 막아 둔 것 안내 |
| `build.mjs` | 묶기 — `@playwright/mcp` · `playwright-core` 를 고정 버전 · sha512 로 받아 안 쓰는 폴더를 빼고 함께 묶는다 |

## 개발

- 묶기: `node plugins/chrome-browser/build.mjs` → `build/chrome-browser.zip`, `--dir` 이면 `build/chrome-browser/`(앱 개발 모드에서 연결). 받은 tgz 는 `build/cache/` 에 두고 다시 쓴다. 망 밖에서 묶는다 — 앱은 내려받지 않는다(표준 7번).
- 버전을 올릴 때: `@playwright/mcp` 는 0.0.x 라 도구 이름이 바뀐다 — 새 `tools/list` 와 `server.mjs` 의 `DENIED` 를 다시 댄다.
- 테스트: 자동 테스트 없음. 앱에 연결해 AI 에게 페이지를 열게 하고 막은 도구가 목록에 없는지 본다.
- 배포: `npm run release chrome-browser` (순수 JS 라 플랫폼 구분 없음).
