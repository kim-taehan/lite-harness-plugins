# ui-test — UI 테스트 (베타)

## 역할

UI 테스트 (베타) — 화면 소스를 읽어 시나리오 초안을 대화로 고르고, 테스트 코드를 만들어 PC 의 Chrome · Edge 로 단계마다 스크린샷을 찍으며 돌리고, 한 파일 HTML 결과서와 지난 수행 비교를 남긴다 (#1248, 계획 `docs/guide/superpowers/specs/2026-11-06-ui-test-plugin-design.md` 1 단계 — web, 2 단계 — 유지보수 · 보강, 0.2.0).

- 범위: `"project"` — 대상 주소 · 계정 · 테스트 폴더가 프로젝트마다 다르다(`settingsPer: "project"`).
- 앱에 닿는 자리: 서비스(`service` — 앱 안에서 도는 얇은 중계 · 진행 밀어 보내기, 서버를 `host.mcp.register`, 스킬을 `host.skills.register` 로 올림) · 별도 프로세스 MCP 서버(실행기, playwright-core) · 스킬 · 패널.
- 권한: `service`(서비스를 담는다) · `project`(서비스가 결과서를 앱 파일 보기로 엶) · `chat`(서비스가 [보강] · [AI 에게 맡기기] 의 새 대화 요청을 보냄). `secrets` 권한은 없다 — 비밀번호는 설정의 secret 칸에 저장되고 서버 env 의 `${secret:password}` 로 서버 프로세스에만 가며, 서비스는 비밀을 읽지 못한다(권한 검사 없이 앱이 풀어 준다).

## 2 단계 (0.2.0) — 유지보수 · 보강

- **코드 낡음**: 생성 코드 머리말의 지문 ≠ 지금 시나리오 지문(머리 · 단계 · `## 데이터`, `sources:` 줄과 테스트 방법은 뺀다). AI 가 지문을 못 구해 `000000000000` 을 쓰거나 머리말이 없어도 낡음 — `list` 가 시나리오마다 맞는 지문을 보이고 스킬은 그것을 베낀다. `run` 결과 맨 위에 경고
- **코드 바뀜**: 시나리오 머리 `sources: [경로@지문, …]`(AI 가 `fingerprint { files }` 도구로 받아 붙인다)의 파일 내용이 바뀌거나 없어지면 표시 — 스킬이 기대 메시지 등 고칠 점을 보강으로 제안
- **실패 갈래**(어림): 셀렉터 못 찾음 · 기다림 시간 초과 · 확인 값 다름 · 이동 오류 · 코드 오류 (`server/failure.ts`) — 결과에 갈래와 길잡이(낡은 테스트 → 코드 고침 / 앱 결함 가능성 → 보고)
- **데이터 표**: 시나리오의 `## 데이터` 마크다운 표 → 행마다 새 창으로 한 번씩, 생성 코드는 `data.<열>` 로 읽는다. 결과 · 결과서 · 지난 수행 비교가 행마다(`04-나이 2행`)
- **규칙 덮임**(어림값): suite.md `## 규칙`(`- [검증|업무] 규칙 — 다루는 시나리오`) → `list` · 패널에 "검증 규칙 5/7 · 업무 규칙 2/4" 와 안 다룬 규칙. 코드 커버리지가 아니다
- **패널**: 두 화면 — 목록(묶음 카드 · 결과 비율 막대 · 시나리오 줄: 코드 없음 · 코드 낡음 · 코드 바뀜 · 마지막 결과) → 시나리오 상세(지난 수행 · 단계 · 실패 · 묶음 최근 수행 · [결과서]). 머리의 [환경] 은 팝업(연결 값 · 기본값 · `_prompt.md` 열기). 스크린샷은 패널에 싣지 않고 결과서에만 둔다. [보강] · [AI 에게 맡기기] · 안 다룬 규칙 누르기 — 모두 `chat.compose { text, send: true }`(새 대화에 요청을 바로 보냄, `chat` 권한). 고르기 · 고치기는 대화에서 스킬이(여러 개 고르기 카드)
- **가이드**: 결과서(`index.html`, 합격 · 실패를 표로 모음)와 별개로, 같은 수행을 화면 흐름 순서로 풀어 쓴 한 파일 HTML(`guide.html`, 결과서 옆). 단계마다 스크린샷, 실패한 단계도 빼지 않고 붉게 원인(갈래 · 오류)과 같이 적고, 맨 위에 "확인이 필요한 곳"을 모은다. 결과서와 같은 스크린샷 예산 · 비밀 값 거르기. `server/guide.ts`. 만드는 길 셋 — AI 가 `guide` 도구, 패널 상세의 [가이드], 환경 팝업의 산출물 기본값 "결과서 + 가이드"(수행이 끝나면 패널이 자동으로). 스크린샷은 이력(데이터 폴더)에 남은 것만 들어간다
- **긴 수행**: 엔진의 MCP 도구 호출 기한은 `experimental.mcp_timeout` 300초(`src/services/opencode/engineConfig.ts` `MCP_CALL_TIMEOUT_MS`) — plugin.json 의 `timeoutMs` 30분은 앱 → 서버 구간일 뿐 엔진이 5분에 끊는다. 그래서 `run` 은 시작하고 최대 120초(`RUN_WAIT_MS`)만 기다려, 안 끝났으면 수행 id 를 돌려주고 AI 는 `report { suite, run }` 으로 다시 기다린다(한 번에 120초). 수행 중의 진행은 서비스가 서버의 `progress` 를 1초마다 읽어 패널로 밀어 보낸다(`service.progress`)
- **중단됨**: 대화가 `run` · `report` 호출을 멈추면(턴 멈춤 — MCP 요청 취소) 수행도 멈추고, 앱이 서버를 내리면(표준입력 닫힘 · SIGTERM) 브라우저를 닫고 돈 데까지 결과서 · 이력을 "중단됨(까닭)" 으로 남긴 뒤 끝난다. 남은 케이스는 멈춤
- **결과서 크기**: 앱 파일 미리보기의 HTML 한도는 20MB(`HTML_PREVIEW_LIMIT`). 스크린샷은 화면 배율 0.75(1280×800 배치 → 960×600) · JPEG 60, 결과서에 넣는 사진 합은 13MB(`REPORT_IMAGE_BUDGET`, base64 로 약 17MB) — 넘치면 실패 순간을 먼저 남기고 단계 끝 사진을 빼며 결과서에 몇 장 뺐는지 적는다. 확장이 바깥 브라우저로 여는 통로는 앱에 없어 패널은 전처럼 프로젝트 안이면 미리보기, 밖이면 경로

## 프로젝트의 파일

```
<project>/ui-tests/                    테스트 폴더 (설정 "테스트 폴더", 프로젝트 안만) — 저장소에 올릴지는 사용자가 정한다
  <묶음>/suite.md                       요청 원문 · 만든 날 · 대상 · 시나리오 순서 · AI 없이 돌리는 명령
  <묶음>/01-<이름>.md                   시나리오 + ## 테스트 방법 (첫 성공 뒤 AI 가 쓴다)
  <묶음>/01-<이름>.spec.mjs             생성 코드 — 시나리오 옆에 같은 이름, import 없이 단계 API 만 쓴다
  _reports/<묶음>/<YYYYMMDD-HHmmss>/index.html   결과서 (테스트 폴더 안 고정 — 폴더 설정은 하나)
```

수행 이력(비교 기준 · 스크린샷)은 이 PC 의 플러그인 데이터 폴더에 프로젝트(실제 경로)마다 따로, 묶음마다 최근 20 개. 시나리오마다의 "마지막 결과"(list · 실패만 다시 수행 · 지난 수행과의 비교 기준)는 가장 최근 수행 하나가 아니라 **그 시나리오가 실제로 마지막에 돈**(성공 · 실패) 기록에서 가져온다(`SuiteInfo.lastCases` — 일부만 다시 수행해도 나머지 결과가 남고, 멈춤 · 코드 없음은 덮지 않는다). 넘친 수행의 결과서 폴더도 지운다.
파일은 AI 가 자기 파일 도구로 쓰고, 서버는 읽기만 한다 — 패널의 [삭제] 가 부르는 `delete` 만 예외로 시나리오 · 묶음 파일을 지우고 suite.md 를 고친다(`.gitignore` 도 고치지 않는다 — 결과서 폴더(`<테스트 폴더>/_reports`)가 `.gitignore` 에 없으면 처음 한 번 AI 가 넣을지 묻는다).

## 구성

- `plugin.json` — `service`(`service.mjs`), 설정 칸(대상 주소 · 브라우저 Chrome/Edge · 테스트 계정 아이디 · 비밀번호(secret) · 백엔드 코드 폴더 · 테스트 폴더 — 결과서는 그 안 `_reports`), `settingsPer: "project"` — "모든 프로젝트" 로 켜도 값은 프로젝트마다(설치 2 단계에 넣은 값은 그때 연 프로젝트 것), `settingsCheck: "check"`(대상 주소를 화면 없이 열어 HTTP 상태 · 제목 — 서비스가 올린 서버의 도구), 스킬, 패널. 이름에 "(베타)" — 앱에 플러그인 베타 표시가 아직 없다
- `service/index.mjs` — 서비스 원본: 스킬 폴더를 `host.skills.register({ name: 'ui-test', dir: 'skills/ui-test' })` 로 올리고, 실행기 서버를 `host.mcp.register` 로 올리고(env 의 `${storage:…}` · `${secret:password}` · `${dataDir}` · 패널 전용 도구 `progress` · `stop` · `shot` · `delete`), 패널이 `service.call` 로 부르는 `list` · `run` · `progress` · `stop` · `shot` · `openFile` · `ask` · `prefs`(패널 기본값 headed · output — 프로젝트별 저장 칸 `storage.*`) · `guide`(서버 도구 중계) 를 서버 도구(`mcp.call`) · 앱 기능(`project.openFile` · `chat.compose`)으로 넘기고, 수행이 도는 동안 진행을 읽어 `service.progress` 로 밀어 보낸다. `run` 은 서버의 `run` 이 끝나기를 기다리지 않고 시작만 알린다. 실패하면 `service.runError`. 비밀번호는 읽지 못한다(`host.call('secrets.get')` 은 서비스에서 `method-unknown`) — 서버 env 의 `${secret:password}` 로 서버에만 간다
- `build.mjs` — 서비스를 `service.mjs` 한 파일로, 서버를 `server/ui-test.mjs` 로 묶는다(`--dir` 지원)
- `server/index.ts` — MCP 입구(stdio). 같은 파일이 CI 명령: `node ui-test.mjs run <묶음> [--failed] [--headed]`, 실패가 있으면 종료 코드 1
- `server/tools.ts` — 도구 `list` · `run { suite, scenarios?: string[] | "failed", headed? }` · `report { suite, run? }` · `delete { suite, scenario? }`(패널 전용 — 확인을 받은 뒤 삭제, AI 에는 노출하지 않음) · `guide { suite, run? }`(가이드형 결과물 `guide.html` — 결과서 옆, 아래 "가이드") · `fingerprint { files }` (AI · 패널), `progress` · `stop` · `shot` (패널), `check` (설정 폼)
- `server/failure.ts` — 실패 갈래 · 길잡이
- `server/runner.ts` — 묶음 읽기 · 시나리오 고르기 · 드라이버로 돌리기 · 결과서 · 이력 · 진행 · 멈추기. 한 번에 수행 하나
- `server/driver.ts` — 드라이버 인터페이스(`check()` · `run(cases)` · `stop()`)와 `web` 하나. client · mobile 은 드라이버를 더한다
- `server/steps.ts` — 생성 코드가 쓰는 단계 API(`step` · `page` · `expect` · `data` · `account` · `baseUrl`), 단계마다 스크린샷, page 호출(셀렉터 · 기다림)과 expect 를 적어 테스트 방법 재료로 돌려준다(입력 값은 적지 않는다)
- `server/remove.ts` — 삭제: 시나리오 하나(md · 생성 코드 · suite.md 의 순서 · 규칙) 또는 묶음 전체. 이 플러그인 파일(suite.md · 시나리오 .md · .spec.mjs)만 지우고 폴더에 다른 파일이 있으면 폴더를 남긴다. 묶음 삭제는 이어서 결과서 · 가이드 · 스크린샷 · 수행 이력까지 모두 지우고(runner.removeSuite), 시나리오 삭제는 그 시나리오의 수행 이력 · 스크린샷을 지우고 결과서를 남은 시나리오로 다시 쓴다(runner.removeScenario). 수행 중인 묶음은 거절
- `server/guide.ts` — 가이드형 결과물 `guide.html` (결과서와 같은 입력)
- `server/report.ts` — 결과서 한 파일(스크린샷은 data: URL), 인쇄용 스타일, 케이스마다 단계 표 · 오류 · 테스트 방법
- `server/history.ts` — 이력 · 지난 수행과 비교(새로 실패 · 고쳐짐 · 그대로 실패)
- `server/scenario.ts` — 시나리오 · suite.md 읽기, 지문
- `server/store.ts` — 0.7.0 저장 계층(1 단계 — 아직 아무도 부르지 않는다, 2 단계에서 서버에 연결). host.db 컬렉션 `scenarios` · `requests` · `runs` · `results` · `screens` 의 문서 모양과 읽고 쓰는 함수: 시나리오 upsert · 쪽 읽기(200개) · 삭제(results 까지, batch 50개씩) · 요청 · 수행 기록 · 마지막 결과 · 시나리오별 최근 20개만 남기는 정리(`pruneResults` — 지운 results · runs 를 돌려주고 스크린샷 · 결과서 파일 삭제는 부르는 쪽) · id 만들기 · 검증(`A-Za-z0-9_.-` 128자, 한글 불가). 서버가 DB 를 못 쓰면(`createDbClient()` 가 undefined) `db-unavailable`, 파일 대체 길은 없다. 원본은 파일이고 DB 는 색인 · 기록이다(`scenarios.file` 은 한글 파일명 id 를 위한 색인 값)
- `server/reindex.ts` — 테스트 폴더의 시나리오 md 를 훑어 `scenarios` 를 파일에 맞춘다(추가 · 지문이 바뀌면 갱신 · 파일이 없어진 줄은 results 와 함께 삭제, 같은 것은 그대로) + 옛 `suite.md` 를 요청 태그로 가져온다. 테스트 폴더가 없으면 아무것도 지우지 않는다
- `skills/ui-test/` — (서비스가 올린다 — manifest `skills` 선언은 없다) `_prompt.md`(프로젝트 환경 · 소스 찾는 법 · 로그인 · 셀렉터 관례 — 없으면 한 번 조사해 쓰고, 실제와 다른 줄은 수행 뒤 물어보고 고친다)를 먼저 읽고 따르는 흐름(소스 읽기 → 초안 → 여러 개 고르기 → 저장 → 코드 → 수행 → 요약 → 테스트 방법. 데이터 문제로 막히면(만료 · 종료 · 없어짐) 앱 결함으로 보고하기 전에 DB 조회 도구(SQL 튜닝 등 — 같은 프로젝트에 켜져 있을 때)로 확인하고, 조건은 백엔드 코드에서 뽑아(근거 파일 · 줄을 `## 테스트 방법` 과 `sources:` 에 남김) 읽기 전용 SELECT 로 후보를 찾는다 — 후보가 하나이고 다시 수행이 통과하면 입력 값만 바로 바꾸고 알리며, 아니면 질문 도구로 묻는다(직접 입력 · 건너뛰기 포함). 낡은 테스트(셀렉터 · 기다림 · 코드 오류) 실패는 AI 가 묻지 않고 코드를 고쳐 그 시나리오만 다시 돌린다(한 케이스 한 번에 최대 2번, 앱 결함 · 데이터로 보이는 실패는 제외). `## 데이터` 값만 바뀐 "코드 낡음" 은 코드를 다시 만들지 않고 머리말 지문만 갱신한다. 실패를 고친 뒤 시나리오 md 의 `## 시행착오`(증상 → 원인 → 해결, 단계 번호 · 단계당 3줄 · 지문에 영향 없음)에 교훈을 남겨 다시 수행 · 코드 재생성 때 같은 시도를 반복하지 않는다. 시나리오마다 번호로 수정 요청(합치기 · 보강 · 방향 변경 · 쪼개기 · 삭제)을 받는다 — 저장된 것은 바꾸기 전 보여 주고 묻는다), `references/formats.md` · `references/step-api.md` · `references/prompt-format.md`
- `index.html` — 패널(디자인 규칙 `.interface-design/system.md` — 한 `:root` 토큰 세트 라이트 · 다크, 결과는 장식 없이 글 한 줄 요약): 목록 → 시나리오 상세 두 화면 · [다시 수행 ▾](전체 · 실패만 · 시나리오 고르기 · 보면서/화면 없이) · 지금 수행의 진행 · [멈추기] · 시나리오 상세는 원문(단계 · `## 데이터` 표 · 테스트 방법)을 보이고 [변경 요청](새 대화의 입력창만 채워 연다 — `ask` 의 `send: false`) · [보강] · [수행](그 시나리오만) 을 둔다. 시나리오를 눌러도 바로 수행하지 않는다. 상세의 [삭제](시나리오) · 목록 카드의 휴지통(묶음)은 확인 상자를 거쳐 서비스 `delete` 로 지운다 — 파일 권한이 있는 서버가 지운다(`projectWrite` 는 `.litecode/*.md` 만 되므로 서비스는 지울 수 없다). [환경] 팝업(디자인 규칙 `.interface-design/system.md` — 연결은 주소창 한 줄, 기본값은 도판이 있는 큰 선택 타일로 방향키 · 누르면 바로 저장(저장 · 닫기 단추 없음), 프롬프트는 파일 줄. 기본값 `prefs` · [설정 열기] 는 앱 통로 `settings.open` — 설정 값은 읽기만 되고 쓰기 통로가 없어 값은 앱의 설정 폼에서 고친다). 패널이 받는 단계 기록은 서버가 기억하는 마지막 수행(`progress`)뿐이라 상세의 단계는 그 시나리오를 다시 수행하면 채워진다. 앱과는 `service.call` 한 통로로만 말하고 진행은 `service.progress` 소식으로 받는다

비밀번호는 env 로만 서버에 가고, 결과서 · 도구 결과 · 오류 글에서 한 번 더 지운다(password 칸 스크린샷은 브라우저가 가린 그대로). "확인(DB):" 단계는 실행기가 돌리지 않는다 — 결과서에 "대화에서만 확인", AI 가 DB 조회 도구가 있으면 대화에서 확인한다.

## 개발

### 묶기 · 배포

`npm run release ui-test` (묶기만 하려면 `node plugins/ui-test/build.mjs` → `build/ui-test.zip`, 약 3 MB, `--dir` 이면 `build/ui-test/` 폴더). 서비스는 `service.mjs` 한 파일로 묶는다. 서버는 MCP SDK 째 `server/ui-test.mjs` 한 파일로 묶고, playwright-core 는 esbuild 로 묶이지 않아(자기 폴더를 `__dirname` 으로 찾고 쓰지 않는 chromium-bidi 를 require) `server/node_modules/playwright-core` 에 파일 그대로 싣는다. 앱이 자기 실행 파일(Node)로 띄우므로 PC 에 Node 가 없어도 되고, 브라우저는 내려받지 않고 PC 의 Chrome(없으면 Edge)을 `channel` 로 쓴다.

### AI 없이 (CI)

zip 의 `server/` 폴더(러너 + `node_modules/playwright-core`)를 CI 에 두고, 프로젝트 폴더에서 `node <server>/ui-test.mjs run <묶음> --headless`. env: `UI_TEST_BASE_URL` · `UI_TEST_USER` · `UI_TEST_PASSWORD` · `UI_TEST_BROWSER` · `UI_TEST_DIR` (결과서는 그 안 `_reports`, 이력은 그 안 `.history`). Node 20+ 와 Chrome 또는 Edge 가 필요하다.

### 테스트

`plugins/ui-test/tests/` (`npm test -- --project ui-test`) — 가짜 브라우저로만(단위 테스트는 브라우저를 띄우지 않는다). `service.test.ts` 는 SDK 가짜 host 로 서비스의 중계 · 진행 밀어 보내기 · 감시 정리를 본다. **앱이 서비스를 올리고 패널이 `service.call` · `service.progress` 로 주고받는 것, 진짜 서버로 수행되는 것은 앱에서 확인**한다(못 봄).

### 설치 2 단계 폼의 [연결 확인]

`settingsCheck` 는 서비스가 올린 서버의 `check` 도구를 부른다. 설치 확인창의 2 단계 폼은 서비스가 아직 안 떠 있어 [연결 확인] 이 `check-unavailable` 이다 — 설치한 뒤 설정 화면에서 누른다. 서버 도구 이름은 manifest `mcp` 때와 같이 AI 에 `litecode_ui-test_<도구>` 로 보여 스킬은 그대로다.
