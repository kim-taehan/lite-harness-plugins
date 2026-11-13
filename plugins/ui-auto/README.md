# UI-AUTO

증적 우선 화면 테스트. opencode 하네스(Playwright MCP + 스킬 4종 + 증적 폴더)를 Lite Harness 플러그인으로 옮긴 것이다. AI 가 브라우저 도구로 화면을 수행하며 페이지 · TC · 스크립트 · 캡처 · 보고서 · 교훈을 증적으로 남기고, 다음 수행은 증적을 먼저 읽어 탐색을 줄인다. 오른쪽 패널에서 화면별 TC 와 흐름 지도를 보고, 스크립트가 있는 TC 는 AI 없이 바로 재생하며, 보고서와 테스트 가이드를 PDF 로 받는다.

## 역할

- **하는 일**
  - 대화: `/ui-auto`(패널 열고 현황), `/ui-auto-tc`(TC 도출), `/ui-auto-run`(수행 · 재수행 · 자가 복구), `/ui-auto-ask`(증적 질의), `/ui-auto-guide`(테스트 가이드 작성). 모든 작업은 `[skill]` · `[증적 조회]` · `[경로]` · `[활용 단계]` · `[tool]` · `[스크립트]` · `[불일치]` · `[증적 갱신]` · `[판정]` · `[교훈 조회]` · `[교훈 기록]` 로그 줄을 대화에 남기고 `logs/<run_id>.md` 로 저장한다(opencode 의 AGENTS.md 규칙을 `ui-auto-evidence` 스킬로 옮김).
  - 패널: 요약(성공률 · 최근 수행 · 미수행) → 탭(대상 페이지 · 흐름 지도 · 수행 기록 · 교훈) → 페이지의 TC(펼치면 스크립트 단계 · 수행 기록, 재수행 · 보고서 · 삭제) → 증적 보고서(대상 페이지 다음에 단계마다 한 장 — 손댄 요소를 붉은 번호 상자로 표시한 캡처 · 설명 · 한 일 · 기대 · 실제 · 판정) → 보고서 PDF · 테스트 가이드 PDF(단계마다 한 쪽). 흐름 지도는 이동마다 사용자 동작(메뉴 경로 · 클릭 대상)과 페이지 아래 모달을 보인다.
  - 패널 수행: LLM 없이 TC 스크립트를 재생(활용 단계 1)하고 AI 와 같은 형식으로 증적을 갱신한다. 판정이 안 맞으면 실패, 단계가 오류면 차단(스크립트 불일치 — 고치기는 AI 몫).
- **앱에 닿는 자리**: 서비스(`service.mjs`) — MCP 서버 올리기(`host.mcp.register`), 스킬 6개(`host.skills.register`), AI 도구 `ui-auto_panel`(`host.tools.register`, 패널 열기). 오른쪽 패널 탭(`index.html`). 서비스가 부르는 앱 통로: `mcp.call` · `project.openFile` · `project.exportFile` · `chat.compose` · `panel.open` · `panel.fullscreen` · `settings.open`.
- **범위**: `scope: "project"` — 대상 시스템 · 계정 · 증적이 프로젝트마다 다르다. `settingsPer: "project"`.
- **권한**: `service`(서비스 · MCP 서버 · 도구 · 스킬), `project`(보고서 열기 · PDF 저장 창 · 파일 열기), `chat`(새 대화에 `/ui-auto-run …` 등 요청 보내기).
- **비밀 값**: 테스트 계정 비밀번호는 secret 설정 칸 → 서버 env `${secret:password}` 로만 간다. AI · 증적 · 보고서 · 로그에 나가지 않는다(`scrub`). 로그인은 서버가 playwright-core 로 하고 세션(쿠키)은 프로젝트 밖 `${projectDataDir}/state.json` 에 둔다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — 설정 칸(대상 주소 · 브라우저 · 창 · 계정 · 비밀번호 · 로그인 경로 · 칸 이름), `settingsCheck: "check"`, 서비스 선언 |
| `service/index.mjs` | 서비스 원본 → `service.mjs`. 서버 · 스킬 · 패널 열기 도구를 올리고, 패널의 service.call 을 서버 도구로 넘기고, 패널 수행 중 진행을 밀어 보낸다 |
| `server/index.ts` | MCP 서버 입구 → `server/ui-auto.mjs`. AI 도구 `browser_*`(중계) · `begin` · `format` · `guide` · `capture`(단계 직전 표시 캡처) · `login` · `check`, 패널 전용 `list` · `detail` · `replay` · `progress` · `stop` · `shot` · `report` · `guide_read` · `delete` · `view` · `pdf` |
| `server/browser.ts` | 동봉한 Playwright MCP(@playwright/mcp 0.0.83) 자식 프로세스 — opencode 와 같은 옵션(`--isolated --storage-state --save-session --output-dir --init-script`), AI 와 패널 사이 · 같은 프로젝트의 대화끼리 브라우저 잠금(대화는 앱이 요청 `_meta` 에 싣는 id 로 가른다) |
| `server/evidence.ts` | 증적 읽기 — system_map · 페이지 문서 · 스크립트 · 보고서 · 가이드 · testdata → 패널 모양(원본은 파일, DB 없음) |
| `server/record.ts` | 패널 수행 결과를 증적에 남기는 줄 고치기(TC 줄 · 수행 이력 · 확인일 · TC 건수 · 최근 통과일) |
| `server/replay.ts` | 패널 수행 — 진입점 → 이동 스크립트 → 단계마다 바로 전 표시 캡처(`browser.ts` 의 `markedShot`: 요소에 번호 상자 → 캡처 → 지우기) → 판정 → 보고서 · 로그 · 페이지 문서 |
| `server/render.ts` · `markdown.ts` | 보고서 · 가이드 md → 한 파일 HTML(캡처는 data:), PDF(Pretendard 포함) |
| `server/auth.ts` | 로그인 · [연결 확인] · PDF 인쇄 (playwright-core, PC 의 Chrome · Edge) |
| `skills/` | `ui-auto`(진입) · `ui-auto-evidence`(공통 규칙 · 로그 형식 · 증적 형식 · 교훈) · `ui-auto-run` · `ui-auto-tc` · `ui-auto-ask` · `ui-auto-guide` |
| `assets/skeleton/` | 증적 빈 틀 — 처음 쓸 때(또 빠진 파일이 있을 때) 프로젝트에 복사. 있는 파일은 덮지 않는다 |
| `assets/fonts/` | Pretendard Variable(SIL OFL 1.1)과 라이선스 — 패널(`fonts.css`, build 가 만든다) · PDF |
| `assets/browser-badge.js` | AI 브라우저 탭의 남색 `UA` 아이콘 |
| `index.html` | 패널 — 디자인 시스템 "UI-AUTO"(남색 한 색조 · 4px · Section 상자) |
| `build.mjs` | 묶기 (아래) |
| `tests/` | vitest — fixtures 는 opencode 하네스가 실제로 남긴 증적 3회분(주소 · 제품명만 바꿈, 캡처는 1×1) |

**프로젝트에 남는 파일**

```
.litecode/ui-auto/                 증적 — 팀이 커밋해 공유, 플러그인을 지워도 남는다
  system_map.md  lessons-learned.md  testdata.md
  pages/<page_id>.md  pages/history/  scripts/<page_id>/<tc_id>.yaml  scripts/routes/<edge_id>.yaml
  captures/<page_id>/  reports/<run_id>.md  guides/<guide_id>.md  logs/<run_id>.md
.litecode/plugins/ui-auto/         생성물 — 플러그인을 지우면 함께 지워진다
  out/reports/<run_id>.html|.pdf  out/guides/<guide_id>.html|.pdf  mcp/(브라우저 세션 기록)
${projectDataDir}/state.json       로그인 세션 — 이 PC 전용, 프로젝트 밖
```

증적 폴더는 표준 29번의 "팀이 공유할 파일은 `.litecode/` 바로 아래" 에 따른 것이다(플러그인 폴더 밖이라 지우지 않는다). 쓰기 전에 실제 경로가 두 폴더 안인지 본다(`guardWrite`).

**패널 ↔ 서비스** (`service.call` 이름 → 하는 일)

| 이름 | 하는 일 |
|---|---|
| `list` | 페이지 · TC(수행 가능 여부, 지난 수행과 비교한 흐름) · 흐름 지도(이동 · `모달`) · 보고서(원인 한 줄 · 흐름) · 가이드 · 교훈 색인 · 상태 |
| `detail` `{ tc }` | TC 상세 · 스크립트 단계 · 확인 사항 · 수행 이력 |
| `report` `{ id }` | 보고서 md → 머리 · 절 · 캡처마다 설명 · 한 일 · 기대 · 실제 · 판정, 원인 단계, 같은 TC 의 지난 성공 캡처 |
| `guide` `{ id }` | 테스트 가이드 md → 개요 · 절 · 따라 하기 단계(서버 도구 `guide_read`) |
| `shot` `{ path }` | `captures/` 아래 이미지 → data: URL |
| `run` `{ tcs }` · `progress` · `stop` | 패널 수행 — 진행은 `service.progress` 소식(TC 마다 작업 기록 줄) |
| `delete` `{ tc, script? }` | TC 를 `폐기`로(번호는 다시 쓰지 않는다), 원하면 스크립트 파일도 |
| `open` · `exportPdf` `{ kind: report\|guide, id }` | 앱 미리보기로 열기 · PDF 저장 창(`{ saved, name }` · `{ saved: false, code }`) |
| `ask` `{ text, send? }` | 새 대화에 요청 |
| `openLessons` · `settings` · `fullscreen` `{ on }` | 교훈 파일 열기 · 설정 열기 · 패널 전체 화면 |

서비스가 받는 앱 소식: 없음(진행은 서비스가 서버에서 읽어 `host.panel.emit('progress')`).

**증적 형식에 더한 것**(opencode 대비): 스크립트 단계의 `expected`, 판정 줄의 `expect`(`ok` · `found` · `equals` — 패널이 LLM 없이 판정), `changes_data`; 보고서 캡처마다 `- 설명 / - 한 일 / - 기대 / - 실제 / - 판정`(단계 캡처는 그 단계 바로 전 화면 + 표시); system_map 의 `모달` 표와 사용자 동작으로 적는 `이동 관계`; 수행 이력의 `- 자가 복구:` · `- 원인 추적:` · `- 교훈:`; `lessons-learned.md`(맨 위 색인 + 돌파 사례, 같은 동작이 두 번 실패하면 세 번째 전에 읽는다). 옛 스크립트(`expect` 없음)는 `browser_wait_for` 는 오류 없음, `browser_find` 는 1건 이상으로 판정한다.

## 개발

- 묶기: `node plugins/ui-auto/build.mjs` → `build/ui-auto.zip` (`--dir` 이면 `build/ui-auto/` 폴더 — 앱 개발 모드에서 연결). @playwright/mcp · playwright-core 를 npm 레지스트리에서 고정 버전 + sha512 로 받는다(chrome-browser 와 같은 값, `build/cache/`). 설치는 앱의 설정 › 기능 › 확장 추가 (zip).
- 시험: `npm test -- --project ui-auto`. 진짜 Playwright MCP + Chrome 으로 패널 수행 한 바퀴는 PR 에 결과를 적는다(로컬 시험 페이지로 확인).
- 배포: 저장소 흐름대로 `release/<날짜>` 에서 `npm run release -- --changed`.
- 앱에서 못 본 것: 패널 화면(앱 iframe 안), `panel.open` 허락 창, `project.exportFile` 저장 창, 앱 엔진에서 스킬이 다른 스킬을 불러 읽는지(opencode CLI 에서는 됨), 앱이 MCP 서버 자식 프로세스의 `.litecode/ui-auto/` 쓰기를 막지 않는지.
- 디자인 시스템: claude.ai 의 "UI-AUTO" 디자인 시스템 artifact(토큰 · 컴포넌트 · README). 패널 CSS 의 토큰은 거기 `tokens.json` 과 같은 값이다.
