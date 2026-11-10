# ui-test — UI 테스트 (베타)

## 역할

UI 테스트 (베타) — 화면 소스를 읽어 시나리오 초안을 대화로 고르고, 테스트 코드를 만들어 PC 의 Chrome · Edge 로 단계마다 스크린샷을 찍으며 실행하고, 한 파일 HTML 결과서와 지난 실행 비교를 남긴다 (#1248, 계획 `docs/guide/superpowers/specs/2026-11-06-ui-test-plugin-design.md`. 0.7.0 — 묶음을 없애고 기록을 host.db 로).

**0.7.0 의 개념.** **시나리오**가 유일한 단위다(묶음 · `suite.md` · `## 시나리오 순서`는 없다). 화면과 요청은 시나리오에 붙는 **태그**다.

| 말 | 뜻 |
|---|---|
| 시나리오 | md(사람 · AI 가 읽는 원본) + spec(실행 코드). 하위 폴더 없음 |
| 화면 태그 | **"확인:" 단계를 실행한 순간의 주소**(`page.url()` 의 경로)를 라우트 패턴(숫자 · uuid · 긴 해시 마디 → `:id`)으로 바꾼 것. 서버가 실행하며 단계마다 기록(`results.urls`)하고 `scenarios.screens` 에 반영 — 성공이면 이번에 본 것으로 바꾸고, 실패면 거기까지 본 것을 더한다. 거쳐 가는 로그인은 "확인:" 단계가 없으면 붙지 않는다. **로그인 시나리오**(머리 `tags` 에 `로그인` · 또는 `screens` 경로의 마지막 마디가 login · signin · sign-in · log-in — `tag.ts` 의 `isLoginScenario`)는 수행에서 관찰한 주소를 더하지 않고 머리 `screens` 선언 그대로다(선언이 비어 있으면 관찰 값) — 로그인 뒤 이동한 `/dashboard` 그룹에 끼지 않게. 이미 쌓인 태그는 reindex 가 선언으로 되돌린다. 한 번도 안 돈 시나리오는 md 머리 `screens: [/login]`(AI 가 쓴 값), 이름은 `screens` 컬렉션(머리 `screen-names: {/login: 로그인}` 또는 라우트 그대로) |
| 요청 태그 | 그 시나리오를 만든 채팅 요청 하나 — md 머리 `request: "<원문>"` · `requested: <ISO>` 에서 reindex 가 `requests` 를 만든다(파일 이름이 `<요청 id>-<번호>.md` 면 그 앞이 요청 id, 아니면 요청 글 · 시각의 해시). DB 가 비어도 파일에서 복구된다 |
| 수행 | 시나리오 N 개를 한 번에 실행한 일 — `runs` 한 줄 + 시나리오마다 `results` 한 줄. 결과서 · 화면 가이드는 수행 한 번의 결과 문서 |

- **실행 단위**: 직접 고른 시나리오들 · 화면 그룹 · 요청 그룹 · 실패한 것만(`run { scenarios? , screen? , request? , failed? }` — 여럿이면 모두 맞는 것). 결과서는 **늘 시나리오마다 따로**(`.litecode/plugins/ui-test/reports/<수행 id>/<시나리오 id>/index.html`) 낸다 — 묻지 않고 고르는 인자도 없다(시나리오가 1 개여도 같다). 옛 수행의 하나로 같이 낸 결과서(`…/<수행 id>/index.html`, 시나리오마다 절 `#s-<시나리오 id>`)는 읽기만 한다
- **패널 [▶ 실행]**: 서버를 직접 부르지 않고 `ask`(`chat.compose`)로 새 대화를 열어 짧은 요청 글을 곧바로 보낸다 — 첫 줄 `/ui-test-run 아래 시나리오를 실행하고 결과를 알려 주세요.` 다음에 `프로젝트 프롬프트: <경로> (있음|없음)` · `산출물: 결과서 + 화면 가이드|결과서만`(환경 값을 읽었을 때만)(앱이 `/ui-test-run` 으로 시작하는 글에 스킬 본문을 붙여 보낸다) + 시나리오마다 제목 · id · 시나리오 md · 생성 코드(`.spec.mjs`) · 수행 기록(`.history.md`, 없으면 `(아직 없음)`) 경로(코드 없는 시나리오는 빼고, 하나도 없으면 안내만). 파일 내용은 글에 싣지 않는다 — 절차는 스킬 `ui-test-run` 이 한다(읽기 → 지킬 것 따르기 → `run` → 문제 해결 → 수행 기록 · 지킬 것 정리 → 가이드 묻기). 처음 채팅에서 저장 뒤 "바로 실행할까요?" 에 답할 때도 같은 스킬을 쓴다. 진행 배너 · 결과는 AI 가 부른 `run` 의 소식으로 그대로 보인다
- **비교**: 시나리오(· 데이터 표 행)마다 "마지막으로 실제 실행한"(성공 · 실패) 결과와 견준다 — 값은 `scenarios.last` · `results` 에서 읽는다(일부만 실행한 수행이 끼어도 맞고, 멈춤 · 코드 없음은 덮지 않는다)
- **정리**: 시나리오마다 최근 20 개 결과만. 넘친 `results` · 스크린샷 · 결과가 모두 없어진 수행의 결과서를 지운다. 시나리오 파일을 사용자가 직접 지우면 reindex 가 DB 줄 · 기록 · 스크린샷 · 결과서 절을 같이 지운다
- **삭제**(패널 전용): 시나리오 하나 · 여럿 · 화면/요청 그룹(그 태그의 시나리오 전부, 여러 화면에 걸친 것도). 파일(md · spec) · DB · 스크린샷 · 결과서(그 시나리오만 남은 수행은 통째로)까지 지운다
- **DB 를 못 쓸 때**(`createDbClient()` 가 undefined — 앱 밖 CLI · CI · 옛 앱): 실행 자체는 된다(결과서 · 종료 코드) — 기록 · 비교만 건너뛰고 결과 글에 "기록은 남기지 않았습니다(앱 밖 실행)" 를 적는다. 목록 · 상세 · 삭제 · reindex 는 `db-unavailable` 오류(파일만 보고 목록을 대신 만들지 않는다). 옛 `history/<묶음>.json` 은 읽지 않는다 — **0.7.0 에서 이력은 새로 시작한다**(시나리오 파일은 그대로 읽고 — 옛 `ui-tests/` 는 아래 "옛 ui-tests/ 가져오기" — 결과서 파일은 가져오지 않는다)
- **PDF 저장**(패널의 결과서 · 화면 가이드 링크를 누르면 화면을 옮기지 않고 그 자리에 [PDF 로 저장] · [열기] · [취소] 가 펼쳐진다 — 열기는 앱 오른쪽 미리보기): 서버가 결과서 · 가이드 HTML 을 `file://` 로 열어 인쇄 모양으로 PDF 를 만들어 같은 폴더(`index.pdf` · `guide.pdf`)에 쓰고, 서비스가 `project.exportFile` 로 사용자가 저장 창에서 고른 곳에 복사한다(호스트 API 2 — 이 호출이 없는 옛 앱이면 패널이 버튼을 숨기고 안내). 옛 수행의 하나로 같이 낸 결과서의 PDF 는 그 결과서 전체다(시나리오 절만 따로 자르지 않는다). 프로젝트 안에 남은 PDF 는 결과서 폴더에 속해 정리 · 삭제 때 같이 지워지고, 결과서 · 가이드를 다시 쓰면(시나리오 삭제로 남은 것으로 다시 씀) 옛 PDF 는 지운다
- 용어: 사용자에게 보이는 글은 "돌리기" 대신 **실행**, 한 번의 기록은 **수행**

- 범위: `"project"` — 대상 주소 · 계정이 프로젝트마다 다르다(`settingsPer: "project"`). 프로젝트 안 산출물(시나리오 · 결과서 · `_prompt.md`)은 모두 `<프로젝트>/.litecode/plugins/ui-test/` 아래에 두고 위치를 설정으로 바꾸지 않는다 — 앱이 플러그인을 지울 때 그 폴더를 통째로 지우기 때문이다(`config.ts` 의 `PLUGIN_DIR` 상수 하나가 정한다). 플러그인을 지우면 `.litecode/plugins/ui-test/` 가 함께 지워진다(앱이 안내 후 삭제) — 사용자가 쓴 시나리오도 포함.
- 앱에 닿는 자리: 서비스(`service` — 앱 안에서 도는 얇은 중계 · 진행 밀어 보내기, 서버를 `host.mcp.register`, 스킬을 `host.skills.register` 로 올림. **호스트 API 2** — `service.api: 2` 라 옛 앱에는 설치가 거절된다) · 별도 프로세스 MCP 서버(실행기 · 기록 저장소 접근, playwright-core) · 스킬 · 패널.
- 권한: `service`(서비스를 담는다) · `project`(서비스가 결과서를 앱 파일 보기로 열고, 결과서 PDF 를 사용자가 고른 곳에 저장 — `project.exportFile`) · `chat`(서비스가 [보강] · [AI 에게 맡기기] 의 새 대화 요청을 보냄). `secrets` 권한은 없다 — 비밀번호는 설정의 secret 칸에 저장되고 서버 env 의 `${secret:password}` 로 서버 프로세스에만 가며, 서비스는 비밀을 읽지 못한다(권한 검사 없이 앱이 풀어 준다). 기록 저장소(`host.db`)는 권한이 따로 없다 — 서버는 앱이 띄우며 준 환경변수(`LITECODE_DB_URL` · `LITECODE_DB_TOKEN`)로 쓰고, 서버가 브라우저를 띄울 때는 그 환경변수를 넘기지 않는다(`driver.ts browserEnv`)

## 저장 위치

| 무엇 | 어디 | 쓰는 쪽 | 지울 때 |
|---|---|---|---|
| 대상 주소 · 브라우저 · 계정 · 비밀 | 설정 칸 | 사용자 | 플러그인을 지울 때 |
| 패널 기본값(`headed` · `output`) | `storage` 칸 `prefs`(프로젝트별) | 서비스 | 플러그인을 지울 때 |
| 시나리오 색인 `scenarios`(제목 · 종류 · 화면[] · 요청 id · 지문 · 마지막 결과 · 남은 수행 id[]) · 요청 `requests` · 수행 `runs` · 결과 `results`(단계별 상태 · 실패 이유 · 데이터 행 · 스크린샷 파일 이름[] · 본 주소[]) · 화면 `screens`(이름 · 마지막 그룹 수행) | `host.db`(프로젝트별) | 서버 | 플러그인을 지울 때(업데이트 · 재설치로는 안 지워짐). 깨져도 `reindex` 가 파일에서 시나리오 · 요청을 다시 채운다(수행 기록만 잃는다) |
| 시나리오 `<id>.md` · 생성 코드 `<id>.spec.mjs` | `<프로젝트>/.litecode/plugins/ui-test/scenarios/` — 하위 폴더 없음, ASCII 이름 `<요청 id>-<번호>` | AI(서버는 읽기만 한다) | 패널 [삭제] · 파일을 직접 지우면 reindex 가 기록을 같이 정리. **플러그인을 지우면 `.litecode/plugins/ui-test/` 가 함께 지워진다(앱이 안내 후 삭제) — 사용자가 쓴 시나리오도 포함** |
| 수행 기록 `<id>.history.md` | `<프로젝트>/.litecode/plugins/ui-test/scenarios/` — 시나리오 옆, 같은 이름. 맨 위 `## 다음 수행 때 지킬 것`(지침 한두 줄씩) + 실행할 때마다 한 건(`## 날짜 시각 — 통과 \| 실패 \| 중단` 아래 수행 id · (문제가 있었으면) 실패한 단계 · 오류 · 원인 · `해결(다른 방법)` · `해결(사용자 답변)` · 결과 · 정리). 모양은 `skills/ui-test-run/references/history.md` | AI(스킬 `ui-test-run` 이 먼저 읽고 지킬 것으로 시작하며, 실행이 끝나면 한 건 덧붙이고 지킬 것을 요약 · 해결된 건 없앰으로 다시 정리한다 — 서버는 쓰지 않는다) | 없어도 된다. 시나리오를 삭제하면 함께 지워지고(`remove.ts`), 훑을 때 시나리오로 세지 않는다. 플러그인을 지우면 폴더째 지워진다 |
| 프로젝트 프롬프트 `_prompt.md` | `<프로젝트>/.litecode/plugins/ui-test/_prompt.md`(시나리오 폴더 밖) | AI | 플러그인 폴더와 함께 지워진다 |
| 결과서 · 가이드 | `<프로젝트>/.litecode/plugins/ui-test/reports/<수행 id>/<시나리오 id>/index.html`(옛 수행은 `…/<수행 id>/index.html` 하나로 같이), 같은 폴더에 `guide.html` · [PDF 로 저장] 을 눌렀을 때 만든 `index.pdf` · `guide.pdf` | 서버 | 최근 20 개를 넘으면 서버가 지운다(수행 id · 시나리오 id 모양의 폴더만). 플러그인 폴더와 함께 지워진다. 처음 결과서를 만든 뒤 한 번 `.gitignore` 에 `.litecode/plugins/ui-test/reports/` 를 넣을지 묻는다(플러그인은 `.gitignore` 를 고치지 않는다) |
| 스크린샷 | 앱 데이터 폴더 `projects/<프로젝트 해시>/shots/<수행 id>/` | 서버 | 정리 때 · 플러그인을 지울 때 |

id 규칙: 수행 id · 요청 id 는 `20261110T110500_01`(지역 시각 + 같은 초의 번호 — 시각으로 시작해 `list`(id 순)가 곧 시간순이라 `query` 를 쓰지 않는다. 정리로 지운 id 는 같은 서버가 다시 내지 않는다). 시나리오 id 는 시나리오 폴더의 ASCII 파일이면 그 이름(`.md` 뺀 것), 한글 파일명이면 `s-<경로 sha1 12자>`(DB id 는 `A-Za-z0-9_.-` 128자, 한글 불가 — 파일 경로는 `scenarios.file` 에 색인으로 적는다). 결과 문서 id 는 `<시나리오 id>.<수행 id>`.

## 구성

- `plugin.json` — `service`(`service.mjs`, `api: 2`), 설정 칸(대상 주소 · 브라우저 Chrome/Edge · 테스트 계정 아이디 · 비밀번호(secret) · 백엔드 코드 폴더 — 옛 `testDir`(테스트 폴더) 칸은 없어졌고 저장돼 있던 값은 무시한다), `settingsPer: "project"` — "모든 프로젝트" 로 켜도 값은 프로젝트마다(설치 2 단계에 넣은 값은 그때 연 프로젝트 것), `settingsCheck: "check"`(대상 주소를 화면 없이 열어 HTTP 상태 · 제목 — 서비스가 올린 서버의 도구), 스킬, 패널. 이름에 "(베타)" — 앱에 플러그인 베타 표시가 아직 없다
- `service/index.mjs` — 서비스 원본: 스킬 폴더 둘을 `host.skills.register({ name: 'ui-test', dir: 'skills/ui-test' })` · `({ name: 'ui-test-run', dir: 'skills/ui-test-run' })` 로 올리고, 실행기 서버를 `host.mcp.register` 로 올리고(env 의 `${storage:…}` · `${secret:password}` · `${dataDir}` · 패널 전용 도구 `panelTools`), 패널이 `service.call` 로 부르는 이름들(아래 "패널 ↔ 서비스")을 서버 도구(`mcp.call`) · 앱 기능(`project.openFile` · `project.exportFile` · `chat.compose`)으로 넘기고, 실행이 도는 동안 진행을 읽어 `service.progress` 로 밀어 보낸다. `run` 은 서버의 `run` 이 끝나기를 기다리지 않고 시작만 알린다. 실패하면 `service.runError`. `exportPdf` 는 서버의 `pdf` 도구로 PDF 를 만든 뒤 `project.exportFile` 을 부르고, 던지지 않고 값으로 돌려준다. **기록 저장소 클라이언트는 가져오지 않는다**(서버만 쓴다 — 서비스가 DB 를 읽어야 하면 서버 도구를 부른다). 비밀번호는 읽지 못한다(`host.call('secrets.get')` 은 서비스에서 `method-unknown`)
- `build.mjs` — 서비스를 `service.mjs` 한 파일로, 서버를 `server/ui-test.mjs` 로 묶는다(`--dir` 지원). 기록 저장소 클라이언트(`sdk/litecode-db-client.mjs` — `server/db.ts` 가 가져온다)는 서버 번들에만 들어간다
- `server/index.ts` — MCP 입구(stdio). 같은 파일이 CI 명령: `node ui-test.mjs run [<시나리오>…] [--failed] [--screen <라우트>] [--request <요청 id>] [--headed]`, 실패가 있으면 종료 코드 1. 앱 밖이면 기록 저장소가 없어 `--screen` · `--request` · `--failed` 는 `db-unavailable`
- `server/db.ts` — `createDbClient` (`sdk/litecode-db-client.mjs` 재수출)
- `server/tools.ts` — AI 에 보이는 도구(`litecode_ui-test_<도구>`): `list { scenarios?, screen?, request?, failed?, json?, cursor? }`(글 — 파일을 먼저 읽고 시나리오 · 화면별 · 요청별) · `run { scenarios?, screen?, request?, failed?, headed? }` · `report { run? , scenario? }` · `guide { run, json? }` · `fingerprint { files }` · `newRequest { text }`(요청 id · 파일 이름 · 머리 두 줄을 돌려준다 — 아무것도 쓰지 않는다), 설정 폼용 `check`. 패널 전용(`PANEL_TOOLS` — 서비스가 `panelTools` 로 올려 AI 에 안 보인다, 결과는 JSON 글): `progress` · `stop` · `shot { run, name }` · `delete { scenarios?, screen?, request? }` · `detail { id }` · `reindex` · `pdf { run, kind: 'report' | 'guide', scenario? }`(결과서 · 가이드를 PDF 로 — `{ path, name }`. `scenario` 필요, 시나리오가 하나뿐이면 생략 가능)
- `server/runner.ts` — 시나리오 고르기(`Selector`) · 드라이버로 실행 · 결과서(늘 시나리오마다 따로) · 기록(`record`) · 비교 · 정리(`cleanup`) · 삭제(`remove`) · PDF(`pdf`) · 진행 · 멈추기. 한 번에 수행 하나. DB 없이도 실행은 된다
- `server/store.ts` — 저장 계층: host.db 컬렉션 `scenarios` · `requests` · `runs` · `results` · `screens` 의 문서 모양과 읽고 쓰는 함수(시나리오 upsert · 쪽 읽기 200개 · 삭제 batch 50개씩 · 수행 기록 · 최근 20개 정리 `pruneResults` — 지운 results · runs 를 돌려주고 파일 삭제는 runner 가 · 그룹의 마지막 수행 · id 만들기 · 검증). 서버가 DB 를 못 쓰면 `db-unavailable`
- `server/reindex.ts` — 시나리오 폴더(바로 아래만, `_`·`.` 로 시작하는 파일 제외)의 시나리오 md 를 훑어 `scenarios` · `requests` · `screens` 이름을 파일에 맞춘다(추가 · 바뀌면 갱신 · 파일이 없어진 줄은 results 와 함께 삭제). 시나리오 폴더가 없으면 아무것도 지우지 않는다
- `server/tag.ts` — 화면 태그: 주소 → 경로 → 라우트 패턴
- `server/files.ts` — 앱 데이터 폴더의 스크린샷 자리 · 처음 한 번 플래그
- `server/remove.ts` — 시나리오 파일(md · 생성 코드 · 수행 기록 `<id>.history.md`) 삭제. 시나리오 폴더 바로 아래가 아닌 것 · `_`·`.` 로 시작하는 이름 · md 가 아닌 것 · 실제 경로가 플러그인 폴더 밖인 것은 거절
- `server/history.ts` — 지난 실행과 비교(새로 실패 · 고쳐짐 · 그대로 실패, 행 단위)
- `server/scenario.ts` — 시나리오 읽기(머리 `request` · `requested` · `screens` · `screen-names` · `sources`), 지문(이 줄들은 지문에서 뺀다)
- `server/steps.ts` — 생성 코드가 쓰는 단계 API(`step` · `page` · `expect` · `data` · `account` · `baseUrl`), 단계마다 스크린샷, "확인:" 단계의 주소 기록, page 호출(셀렉터 · 기다림)과 expect 를 적어 테스트 방법 재료로 돌려준다(입력 값은 적지 않는다)
- `server/driver.ts` — 드라이버 인터페이스(`check()` · `run(cases)` · `pdf(html, pdf)` · `stop()`)와 `web` 하나(`pdf` 는 화면 없이 브라우저를 띄워 `emulateMedia('print')` + `page.pdf`, 라이트). 브라우저에는 `LITECODE_DB_*` 환경변수를 넘기지 않는다
- `server/failure.ts` — 실패 갈래 · 길잡이
- `server/report.ts` — 결과서 한 파일(스크린샷은 data: URL), 인쇄용 스타일, 시나리오마다 `id="s-<id>"` 앵커
- `server/guide.ts` — 가이드형 결과물 `guide.html` (결과서와 같은 입력)
- `skills/ui-test/` — (서비스가 올린다 — manifest `skills` 선언은 없다) `_prompt.md` 를 먼저 읽고 따르는 흐름(소스 읽기 → 초안 → 여러 개 고르기 → `newRequest` → 저장 → 코드 → (멈춰서 보여 주기) → 실행 → 요약 → 테스트 방법). 묶음 이름 짓기 · "기존에 추가/새로" 질문은 없다. 번호로 수정 요청(합치기 · 보강 · 방향 변경 · 쪼개기 · 삭제)을 받고 저장된 것은 바꾸기 전 보여 주고 묻는다. `references/formats.md` · `references/step-api.md` · `references/prompt-format.md`
- `skills/ui-test-run/` — (서비스가 올린다) 실행 스킬: `SKILL.md`(패널의 `/ui-test-run` 요청과 저장 뒤 "바로 실행할까요?" 승인에서 질문 없이 바로 — 읽기 → 지킬 것 따르기 → `run` → 문제 해결(재현 → 다른 방법 → 사용자에게 한 번에 한 가지씩) → 수행 기록 · 지킬 것 정리 → 요약 · 가이드 묻기) · `references/history.md`(`<id>.history.md` 의 지킬 것 절 + 수행 한 건의 모양 · 정리 규칙). 만들기 · 저장 · 보강은 `skills/ui-test/` 가 한다
- `index.html` — 패널(승인된 시안 `uitest-tags-v2`). 머리(제목 · 프로젝트 · 시나리오 N개 · 톱니 [환경]) · 탭 전체 / 화면별 / 요청별 + 검색 · 아래 막대(전체 탭에서 체크한 것: 선택 해제 · 삭제 · ▶ 실행) · 그룹 머리(결과서 · ▶ 실행 · 삭제) · 질문 줄(삭제 확인 — 실행은 묻지 않고 바로) · 실행 중 배너 · 완료 알림 · 상세(단계 · 최근 결과) · 결과서/가이드 보기 자리([PDF 로 저장]) · [환경] 팝업. 패널이 부르는 `expose` 이름: `reindex` `list` `progress` `run` `stop` `detail` `delete` `shot` `guide` `exportPdf` `openFile` `ask` `prefs`(앱 통로는 `service.call` 외에 `events.subscribe` · `settings.open` 뿐). 서비스가 밀어 보내는 소식: `service.progress`(수행 진행) · `service.runError`(시작 · 진행 실패). 열 때 `reindex` → `list`(`cursor` 로 끝까지) → `progress`, 삭제 · 실행이 끝난 뒤에는 `list` 만 다시 읽는다. 순수 로직은 `// <pure>` 구간으로 나뉘어 `tests/panel.test.ts` 가 시험한다. 시안에 없어서 더한 것(최소한): 환경 팝업(톱니) · 상세의 [변경 요청] [보강] [AI 에게 맡기기](실패일 때) 글자 단추 · 코드 없음 · 낡음 · 바뀜 안내 · 실행 배너를 상세에도 · 최근 결과 5줄이 넘으면 [더 보기] · 태그 없는 시나리오의 끝 그룹(화면 미정 · 요청 없음)

### 패널 ↔ 서비스

패널은 앱 통로의 `service.call { name, params }` 한 통로로만 서비스에 말한다. 서비스는 서버 도구(`mcp.call`)를 부르고 JSON 글을 풀어서 돌려준다(오류는 서버 글 그대로 던진다 — 저장소를 못 쓰면 메시지가 `db-unavailable` 로 시작, 프로젝트 없이 `run` 이면 `no-project`). 경로는 모두 프로젝트 기준 상대 경로. 소식은 `events.subscribe(['service.progress', 'service.runError'])` 로 받는다.

| 이름 | 인자 | 반환 | 비고 |
|---|---|---|---|
| `list` | `{ scenarios?: string[], screen?: string, request?: string, failed?: boolean, cursor?: string }` | `{ project: 프로젝트 폴더 이름, scenarioDir, reportDir(프로젝트 기준 경로), baseUrl, browser, running: 수행 id \| null, prompt: { file, exists }(`_prompt.md` 유무 — 서버가 직접 확인, 파일은 읽지 않는다), scenarios: Row[], cursor?, screens?: Screen[], requests?: Request[] }` | 한 쪽 200 개(선택자를 주면 걸러 한 번에). `screens` · `requests` 는 첫 쪽(`cursor` 없음)에만. `Row` = `{ id, title, kind, file, screens: string[], request: 요청 id \| null, status: 'passed' \| 'failed' \| 'no-code' \| 'stopped' \| null, lastAt, lastRun, lastReport · lastGuide(최근 수행의 결과서 · 가이드가 만들어져 있는지), hasCode, stale, changed: { path, state: 'changed' \| 'missing' }[], steps, checks, rows }`(`status` 가 `null` 이면 실행 전). `Screen` = `{ route, name, lastRun }`(`screens` 문서가 있는 화면만 — 없으면 라우트가 이름), `Request` = `{ id, text, at, count, lastRun }`, `lastRun` = `{ run, at, mode: 'one' \| 'each', report?: 결과서 경로 } \| null`(그 그룹을 마지막으로 같이 실행한 수행 — `report` 는 하나로 같이 낸 수행만) |
| `detail` | `{ id }` | `{ id, title, kind, file, source: 시나리오 원문, screens, request: { id, text, at } \| null, status, hasCode, stale, changed, steps: { no, text, kind: 'action' \| 'check' \| 'db' }[], data?, method: string[], latest: { run, at, status, steps: StepResult[], rows?, error?, urls } \| null, results: Result[] }` | `Result` = `{ run, at, status, durationMs, failure: { step?, error?, kind?, row? } \| null, report?: { file, anchor? }, guide?: { file } }` 최근 것이 앞(최대 20). `report.anchor` 는 하나로 같이 낸 결과서의 그 시나리오 절(`s-<id>`) — 시나리오마다 따로 낸 것은 앵커 없이 그 시나리오 결과서. `guide` 가 없으면 그 수행은 가이드를 만들지 않은 것(링크 비활성). `StepResult` = `{ title, status: 'passed' \| 'failed' \| 'db' \| 'not-run', durationMs, url?, shot?, failShot?, error?, failKind? }`(스크린샷 이름은 `shot` 으로 데이터 URL 을 받는다) |
| `run` | `{ scenarios?, screen?, request?, failed?, headed?: boolean }` | `{ started: true }` | 끝나기를 기다리지 않는다. 결과서는 늘 시나리오마다 따로 나오고 `report` 는 받지 않는다. 진행은 소식 `service.progress`, 시작 실패는 `service.runError { message }` |
| `progress` | — | `Progress` = `{ running, title?, target?, runId?, startedAt?, headed?, browser?, mode?: 'one' \| 'each', cases: { id, title, status: 'waiting' \| 'running' \| 'passed' \| 'failed' \| 'no-code' \| 'stopped', durationMs?, steps, rows? }[], stale?: string[], reports?: { scenario?, file }[], report?, recorded?: boolean, error? }` | 소식 `service.progress` 의 값도 같은 모양. 끝난 수행은 `reports`(하나로 같이면 1 개, 따로면 시나리오마다) · `recorded: false` 면 기록을 못 남긴 것 |
| `stop` | — | `'멈추는 중' \| '실행 중이 아닙니다'` | |
| `delete` | `{ scenarios?, screen?, request? }`(하나는 필요) | `{ scenarios: 지운 id[], files: 지운 파일[], runs: 통째로 지운 수행 수 }` | 확인을 받은 뒤 부른다. 화면 · 요청 그룹은 그 태그의 시나리오 전부(여러 화면에 걸친 것도). 실행 중인 시나리오가 있으면 거절 |
| `reindex` | — | `{ added, updated, removed }` | 패널을 열 때 한 번. `list` 앞에 부르면 목록이 파일과 맞는다 |
| `shot` | `{ run, name }` | `data:image/jpeg;base64,…` | `name` 은 `StepResult.shot` · `failShot` |
| `guide` | `{ run }` | `{ files: 가이드 파일[] }` | 환경 `output: 'both'` 면 실행이 끝난 뒤 패널이 부른다 — 서비스의 진행 소식으로 끝남을 본 수행은 `finishRun` 이, AI 가 서버 `run` 을 직접 불러 소식이 없던 수행은 목록을 새로 읽을 때(`catchUp` · 패널을 연 뒤 끝난 것만, 수행 id 당 한 번) 부른다. 요청 글의 `산출물:` 줄이 "결과서 + 화면 가이드" 면 AI 도 `lastGuide` 가 false 일 때만 부른다. 시나리오마다 하나(옛 수행의 하나로 같이는 파일 1 개) |
| `openFile` | `{ path }` | 앱의 `project.openFile` 결과 | 결과서 · 가이드 · 프로젝트 프롬프트 열기(앱 오른쪽 미리보기). **앵커(`#s-<id>`)는 못 넘긴다** — 앱의 `project.openFile` 은 `path` · `line` 만 받는다(desktop `calls/project.ts`: 경로 전체를 파일 이름으로 보므로 `#` 를 붙이면 파일을 못 찾는다). 그래서 옛 수행의 하나로 같이 낸 결과서는 시나리오 절 위치 없이 맨 위부터 열린다(`Result.report.anchor` 는 "하나로 같이 낸 결과서" 표시로만 쓴다) |
| `exportPdf` | `{ run, kind: 'report' \| 'guide', scenario? }` | `{ saved: true, name }` \| `{ saved: false }`(사용자가 저장 창을 닫음) \| `{ saved: false, code, message? }` | 서버 `pdf` 로 PDF 를 만들고 `project.exportFile` 로 저장 창을 띄운다. 던지지 않고 값으로 돌려준다(던지면 패널에는 `service-failed` 만 가므로). `code`: `busy`(저장 창이 이미 열림) · `export-limit`(분당 6번) · `permission-missing` · `too-big` · `unsupported`(옛 앱 — 알 수 없는 호출, 패널이 PDF 버튼을 숨기고 안내) · `pdf-failed`(브라우저가 PDF 를 못 만듦, `message` 에 이유) · 그 밖의 앱 오류 코드 그대로. 시나리오마다 따로 낸 수행은 `scenario` 필요 |
| `ask` | `{ text, send?: boolean }` | 앱의 `chat.compose` 결과 | `send: false` 면 입력창만 채움([변경 요청]) |
| `prefs` | `{ set?: { headed?: boolean, output?: 'report' \| 'both'} }` | `{ headed?, output? }` | 프로젝트별 저장 칸. 모르는 값 · 틀린 형태는 저장하지 않는다 |

## 개발

### 묶기 · 배포

`npm run release ui-test` (묶기만 하려면 `node plugins/ui-test/build.mjs` → `build/ui-test.zip`, 약 3 MB, `--dir` 이면 `build/ui-test/` 폴더). 서비스는 `service.mjs` 한 파일로 묶는다. 서버는 MCP SDK 와 기록 저장소 클라이언트째 `server/ui-test.mjs` 한 파일로 묶고, playwright-core 는 esbuild 로 묶이지 않아(자기 폴더를 `__dirname` 으로 찾고 쓰지 않는 chromium-bidi 를 require) `server/node_modules/playwright-core` 에 파일 그대로 싣는다. 앱이 자기 실행 파일(Node)로 띄우므로 PC 에 Node 가 없어도 되고, 브라우저는 내려받지 않고 PC 의 Chrome(없으면 Edge)을 `channel` 로 쓴다. 0.7.0(패널 포함, 3 단계까지 끝남)은 호스트 API 2 를 지원하는 앱이 나온 뒤 릴리즈한다.

### AI 없이 (CI)

zip 의 `server/` 폴더(러너 + `node_modules/playwright-core`)를 CI 에 두고, 프로젝트 폴더에서 `node <server>/ui-test.mjs run [<시나리오>…] --headless`. env: `UI_TEST_BASE_URL` · `UI_TEST_USER` · `UI_TEST_PASSWORD` · `UI_TEST_BROWSER`. 시나리오 · 결과서 위치는 프로젝트 `.litecode/plugins/ui-test/` 로 정해져 있다. 기록 저장소(`LITECODE_DB_*`)가 없으니 기록 · 비교는 건너뛰고 결과서와 종료 코드만 낸다. Node 20+ 와 Chrome 또는 Edge 가 필요하다.

### 테스트

`plugins/ui-test/tests/` (`npm test -- --project ui-test`) — 가짜 브라우저(`launch` 주입)와 SDK 가짜 host 의 `host.db`(`store-helper.ts`)로만 본다(브라우저를 띄우지 않는다): `workspace.test.ts`(시나리오 선택자 · 화면 태그 · 결과서(시나리오마다 따로) · 비교 · 최근 20 개 정리 · DB 없는 실행 · 삭제 · reindex 연동 · 도구), `reindex.test.ts`(시나리오 파일 ↔ 기록 맞추기 · 요청 · 화면 태그 · 지워진 파일 정리) · `store.test.ts` · `tag.test.ts` · `scenario.test.ts` · `remove.test.ts` · `stage2.test.ts`(낡음 · 바뀜 · 데이터 표 · 긴 실행 · 중단) · `service.test.ts`(서비스 중계 · 진행 밀어 보내기 · 감시 정리 · `exportPdf` — `project.exportFile` 은 저장 창 결과를 정하려고 테스트가 호스트에서 가로챈다) · `pdf.test.ts`(결과서 · 가이드 → PDF, 폴더와 함께 삭제) · `panel.test.ts`(패널의 `<pure>` 구간 — 그룹 · 검색 · 상태 · 삭제 확인 — 과 소스 규칙) · `guide.test.ts` · `cli.test.ts`.

**앱에서 못 본 것**: 앱이 플러그인을 지울 때 `.litecode/plugins/ui-test/` 를 실제로 통째로 지우는 것(desktop 동작) · 진짜 Chrome · Edge 로 실행해 단계 주소가 화면 태그로 붙는 것(가짜 페이지의 `url()` 로만 봤다) · 앱이 서비스를 올리고 패널이 `service.call` · `service.progress` 로 주고받는 것 · 앱이 서버에 준 환경변수로 진짜 `host.db` 중계에 쓰고 읽는 것(가짜 host 의 같은 처리기로만 봤다) · AI 가 `litecode_ui-test_<도구>` 로 부르는 종단 · Windows · `panelTools` 가 `detail` · `reindex` 까지 숨기는지 · `project.exportFile` 로 진짜 저장 창이 뜨고 파일이 쓰이는 것 · 패널이 앱의 샌드박스 iframe 안에서(CSP) 도는 것 · 한글 입력(IME)으로 검색 · Windows 의 PDF 글꼴.

**렌더로 본 것**: 패널(`index.html`)을 진짜 Chrome 에서 가짜 서비스(앱 통로 postMessage 스텁)로 열어 전체 · 선택 막대 · 실행/삭제 질문 · 화면별 · 요청별 · 검색 · 실행 중 · 완료 알림 · 상세(실패 · 스크린샷 · 실행 전) · 결과서 보기 · PDF 저장(성공 · 옛 앱) · 비어 있음 · 오류 · 환경 팝업을 라이트 · 다크, 폭 420 · 440 에서 시안과 견줘 확인했다. `Workspace.pdf` 는 진짜 Chrome 으로 결과서 · 가이드 PDF 를 만들어 열어 보았다(결과서 3쪽 · 가이드 — 약 0.6~0.9초). `project.openFile` 의 앵커는 앱 코드로 확인했다(위 `openFile` 행).

### 설치 2 단계 폼의 [연결 확인]

`settingsCheck` 는 서비스가 올린 서버의 `check` 도구를 부른다. 설치 확인창의 2 단계 폼은 서비스가 아직 안 떠 있어 [연결 확인] 이 `check-unavailable` 이다 — 설치한 뒤 설정 화면에서 누른다. 서버 도구 이름은 manifest `mcp` 때와 같이 AI 에 `litecode_ui-test_<도구>` 로 보여 스킬은 그대로다.

### 긴 실행 · 중단 · 결과서 크기

- 엔진의 MCP 도구 호출 기한은 `experimental.mcp_timeout` 300초(`src/services/opencode/engineConfig.ts` `MCP_CALL_TIMEOUT_MS`) — plugin.json 의 `timeoutMs` 30분은 앱 → 서버 구간일 뿐 엔진이 5분에 끊는다. 그래서 `run` 은 시작하고 최대 120초(`RUN_WAIT_MS`)만 기다려, 안 끝났으면 수행 id 를 돌려주고 AI 는 `report { run }` 으로 다시 기다린다(한 번에 120초). 진행은 서비스가 서버의 `progress` 를 1초마다 읽어 패널로 밀어 보낸다
- 대화가 `run` · `report` 호출을 멈추면(턴 멈춤) 실행도 멈추고, 앱이 서버를 내리면(표준입력 닫힘 · SIGTERM) 브라우저를 닫고 실행한 데까지 결과서 · 기록을 "중단됨(까닭)" 으로 남긴 뒤 끝난다. 남은 시나리오는 멈춤
- 앱 파일 미리보기의 HTML 한도는 20MB(`HTML_PREVIEW_LIMIT`). 스크린샷은 화면 배율 0.75(1280×800 배치 → 960×600) · JPEG 60, 결과서에 넣는 사진 합은 13MB(`REPORT_IMAGE_BUDGET`) — 넘치면 실패 순간을 먼저 남기고 단계 끝 사진을 빼며 결과서에 몇 장 뺐는지 적는다
- 코드 낡음(생성 코드 머리말 지문 ≠ 지금 시나리오 지문) · 코드 바뀜(`sources:` 의 파일 지문이 달라짐) · 실패 갈래(셀렉터 · 기다림 · 확인 값 · 이동 · 코드 오류)는 0.2.0 그대로. 데이터 표(`## 데이터`)는 행마다 새 창으로 한 번씩, 결과 · 결과서 · 비교가 행마다(`<id> 2행`). 0.7.0 에서 화면 규칙 덮임(옛 `suite.md ## 규칙`)은 옮기지 않았다 — `screens.rules` 자리만 있다
