# sql-tuning — SQL 튜닝

## 역할

SQL 튜닝 도우미 — 개발 DB 의 실행계획 · 테이블 · 인덱스 · 통계를 AI 가 읽고 고친 SQL 과 인덱스를 제안한다 (#1051, 설계 `docs/guide/superpowers/specs/2026-11-02-sql-tuning-design.md`).
도구 9개(`server/tools.ts`)와 스킬(`skills/sql-tuning`)은 **공통**이고, 두 가지 껍데기로 쓴다:
- **litecode 플러그인** (#1072 · #1232 · 0.10.0 서비스 #1614) — `plugin.json`(서비스 · 패널 · 설정 칸 선언 — 스킬은 서비스가 올린다). DB 연결 정보는 앱의 설정 폼으로 받고, 작은 패널 `index.html` 은 카드 두 개(표준 · 연결)만 둔다. 서비스(`service/index.mjs`)가 `host.mcp.register` 로 같은 `server/index.ts` 를 앱에 등록하고, 앱이 별도 프로세스로 띄운다. 아래 "플러그인으로 쓰기"
- **표준 MCP 서버(stdio)** — `server/index.ts`. davis-code 등 다른 호스트에서. 아래 "MCP 서버로 쓰기"

- 범위: `"project"`(0.10.0 에서 적음 — 표준 21번). 프로젝트마다 DB 가 다르므로 켠 프로젝트에서만 쓰이고, 연결 정보는 `settingsPer: "project"` 라 프로젝트마다 따로.
- 저장 위치(`docs/guides/data-storage.md` 표): DB 연결 정보 · 비밀번호는 설정 칸. **결과서는 프로젝트 파일** — `<프로젝트>/.litecode/plugins/sql-tuning/reports/<시각>/index.html`(+ `meta.json`)이고 **정본**이다. 튜닝 이력 목록의 **색인은 `host.db`**(컬렉션 `reports`, id = 결과서 폴더 이름 `YYYYMMDD-HHMMSS[-n]`)라 깨지거나 비어도 폴더를 훑어 다시 만든다. 사용자가 팀과 공유하는 표준 `.litecode/sql-standard.md` 는 이 폴더 **밖**(`.litecode/` 바로 아래)이라 플러그인을 지워도 남는다. **플러그인을 지우면 앱이 `.litecode/plugins/sql-tuning/` 을 안내한 뒤 통째로 지우니 결과서가 함께 지워진다**(보관하려면 결과서를 따로 복사). 0.13 까지 결과서를 쓰던 `sql-tuning-reports/` 는 읽기 · 삭제만 한다(새로 쓰지 않고 지우지도 않는다 — 옛 결과서는 그 자리에 남아 패널에 계속 보인다).
- 호스트 API: `service.api` 2(0.14.0~) — `host.db` 가 필요해 옛 앱(api 1)에는 설치되지 않는다.
- 권한: `service`(서비스 선언과 짝 — MCP 서버 등록과 패널 중계) · `project`(패널이 이 프로젝트의 표준 문서를 읽음) · `projectWrite`(패널에서 `.litecode/sql-standard.md` 를 고침). `secrets` 권한은 없다 — DB 비밀번호는 설정의 `type: "secret"` 칸에 저장되고 `${secret:password}` 로 서버 프로세스의 환경 변수로만 가며, 이 둘에는 권한 검사가 없다(`secrets` 권한은 `secrets.get/set/delete` 호출만 막는다 — 서비스 · 패널은 부르지 않는다). 그래서 설치 확인창에 "비밀 값 저장" 안내가 뜨지 않는다.

## 구성

- `server/index.ts` — MCP 입구. 연결은 `DATABASE_URL`, 없으면 `SQL_TUNING_DB` · `_HOST` · `_PORT` · `_SERVICE` · `_USER` · `_PASSWORD` 칸으로 만든다(`connect.ts` `databaseUrlFromEnv`). 스킴으로 어댑터를 고른다(`oracle://` · `postgres://`)
- `plugin.json` — `settings` 칸(`db` · `host` · `port` · `service` · `user` · `password`(secret) · `schema`)을 앱이 설치 2 단계와 설정 › 기능 › 플러그인 › [고치기] 에 폼으로 그린다. `service` 선언(`service.mjs`) — `mcp` · `skills` 선언은 0.10.0 에서 서비스로 옮겼다.
- `service/index.mjs` — 서비스 원본(`build.mjs` 가 `service.mjs` 한 파일로 묶는다). ① `host.mcp.register` 로 MCP 서버를 등록한다: 명령 `server/sql-tuning.mjs`(묶은 서버), env 는 칸 값 자리표시(`${storage:<키>}` · `${secret:password}` — 0.7.0 이후 같은 키라 저장한 값이 그대로 쓰인다), 10분 쉬면 내린다. AI 도구 이름은 옛 `mcp` 선언 때와 같다(`attach` 없음 → `litecode_sql-tuning_<도구>`). 값을 바꾸면 앱이 다음 호출에 서버를 다시 띄운다. 도구 목록은 앱이 서버에게 묻는다 ② 스킬 `skills/sql-tuning`(SKILL.md 와 references/ 통째로)을 `host.skills.register({ name: 'sql-tuning', dir })` 로 올린다 — 패널이 읽는 플러그인 기본 표준(`references/sql-standard.md`)은 `bundledFile` 이 `host.skills.readFile` 로 읽어 준다(사용자가 `host.skills.writeFile` 로 얹은 글이 먼저, 없으면 스킬 폴더에 든 원래 파일, 둘 다 없으면 "플러그인 기본 없음") ③ 패널이 `service.call` 로 부르는 메서드(`readFile` · `fileInfo` · `writeFile` · `removeFile` · `openFile` · `projectInfo` · `settingsSummary` · `settingsCheck` · `settingsOpen`)를 같은 이름의 앱 호출(`host.call`)로 중계하고, 실패하면 오류 코드를 `{ ok: false, code }` 로 돌려준다 ④ 패널의 `deleteReport` 를 서버 도구 `delete_report`(`panelTools` — AI 목록에는 안 보인다)로 `mcp.call` 중계한다.
- `server/tools.ts` — 도구 9개(+ 패널 전용 `delete_report`): `explain`(실행 안 함) · `table_info` · `top_queries` · `runtime_plan`(실제 실행) · `impact_check`(인덱스 전 영향) · `captured_sql`(애플리케이션이 실제로 보낸 SQL · Oracle 바인드 값 표본 — MyBatis · JPA 코드의 진짜 SQL, #1056) · `compare`(원래 · 고친 쿼리를 여러 바인드 값으로 실제 실행해 비교) · `query`(확인용, 행 수 제한) · `report`(튜닝 최종 결과서 — 아래 `server/report.ts`)
- `server/db.ts` — `createDbClient` 재수출(원본은 저장소 `sdk/litecode-db-client.mjs` 의 사본). 서버 번들(`server/sql-tuning.mjs`)에만 묶이고 서비스 번들에는 들어가지 않는다 — 설치 검사가 서비스의 직접 `fetch(` 를 거절한다
- 서비스 `service/index.mjs` 의 색인 — `expose` 이름 `reports`(패널이 읽는 최신 이력) 외에 `reindex`: 새 · 옛 두 폴더를 `project.listDir` 로 훑어 색인과 맞춘다(없는 줄은 `meta.json` 을 읽어 추가, 사라진 폴더의 줄은 삭제, 같은 것은 쓰기 0번. 옛 위치 것은 `legacy: true`, 최신부터 한 번에 100개까지 10개씩 읽고 `host.db.batch` 로 쓴다, 폴더를 못 읽었거나 잘렸으면 그 위치의 줄은 지우지 않는다). 받는 소식: `project.filesChanged`(두 결과서 폴더의 것만 → reindex 후 패널에 `reports` 소식)
  - `reports` 문서 모양: `meta.json` 의 요약(`v` · `id` · `at` · `target` · `kind?` · `project?` · `db` · `verdict` · `cost?` · `compare{sets,same,partial}` · `cause?` · `index_proposed` · `file`) + `legacy`(옛 폴더의 것) + `hasMeta`(요약이 있나 — 없으면 `{ legacy, hasMeta: false }` 만). 비밀 · 접속 정보 · 데이터 행은 `meta.json` 과 같이 없다
- `server/status.ts` — [연결 확인] 도구 `server_status`(인자 없음): 비어 있는 필수 칸이 있으면 그 이름, 다 있으면 `SELECT 1` 한 번으로 "연결됨 — Oracle tuner@host:1521/FREEPDB1 (12ms)" 또는 "연결 실패 — …: <오류>" 한 줄. litecode 는 manifest `settingsCheck` 로 AI 목록에서 뺀다(davis-code 에서는 목록에 보이지만 설명이 "설정 폼 전용")
- `index.html` — 오른쪽 패널(0.9.0~, 앱과는 `service.call` 한 통로만 쓴다). **튜닝 이력 목록이 주인공**(시안 2026-11-10): 서비스의 `reports`(`service.call('reports', { reindex, limit })` — 색인 `reports` 에서 최신 30건을 최신 먼저로 돌려준다. `reindex: true` 는 열 때 · [새로 고침] · 다시 보일 때, 소식을 받아 읽을 때는 서비스가 이미 맞췄으니 false)의 문서(`meta.json` 요약 + `legacy` · `hasMeta`)를 줄로 그린다. 결과서 파일(`index.html`)은 문서의 `legacy` 로 새 · 옛 위치를 골라 읽는다 — 판정 · 대상 · 시각 / 비용 · 결과 동일 수 · [결과서 보기] / 보류 이유. [결과서 보기]는 패널 안 상세 화면(맨 위 [‹ 목록으로] · Esc)에 결과서 `index.html`(`readFile`, 256KB 까지)을 그린다 — 패널 CSP 가 iframe 을 막아 `DOMParser` 로 파싱한 `<style>` · 본문을 Shadow DOM 에 직접 넣고(CSS 는 `:root`·`html`→`:host`, `body`→`.sqr-body` 로 바꾼다), `script`·`iframe`·`on*`·링크 등은 지운다. 못 그리면 [앱에서 열기](`openFile`). 줄마다 [삭제](`service.call('deleteReport', { id })` — 줄 안 확인 상자 → 서비스가 결과서 폴더를 지움 → 패널이 바로 목록을 다시 읽음, `not-found` 는 조용히 알림). `meta.json` 이 없는 옛 결과서(`hasMeta: false`)는 "이전 결과서" 줄, `index.html` 이 없으면(`fileInfo`) "결과서 파일 없음". 서비스의 `reports` 소식(`service.reports`)을 받으면 1.5초 조용할 때(최대 5초) · 패널이 다시 보일 때 다시 읽고, 직전 읽기와 비교해 "새로" · "바뀜" 칩을 6초 보인다. 읽기 실패는 자동 재시도 없이 "낡은 목록" + [다시]. 연결 · 사내 SQL 표준은 맨 위 한 줄(눌러서 펼침) — [연결 확인](`settings.check`) · [설정 열기](`settings.open`) · 표준 [고치기] · [.md 로 바꾸기] · [플러그인 기본으로](프로젝트 파일 `.litecode/sql-standard.md`, 권한 `projectWrite`; 없으면 zip 의 `references/sql-standard.md`). 서비스가 꺼져 있으면 안내 + [다시 확인] 만 둔다(표준 "없음"으로 그리지 않는다). `chat` 권한이 없어 비어 있음 안내는 문장만
- `server/report.ts` — `report` 도구의 입력 검사(`parseReport` — 빠진 칸을 한꺼번에 알림) · 결과서 HTML 렌더러(`renderReport` — 한 파일, 외부 요청 · 스크립트 없음, 라이트 · 다크 · 좁은 폭 · 인쇄) · 파일 쓰기(`writeReport` — 프로젝트의 `.litecode/plugins/sql-tuning/reports/<YYYYMMDD-HHMMSS>/index.html` + `meta.json`. 쓰기 전에 실제 경로(링크 푼 것)가 `PLUGIN_DIR`(`.litecode/plugins/sql-tuning`) 안인지 보고 밖이면 거절한다. 그 뒤 `reports` 문서를 `ReportIndex`(= `createDbClient()` 의 결과)로 쓴다 — 없으면(앱 밖 · 옛 앱) 파일만 쓰고, 색인 쓰기가 실패해도 결과서는 남는다) · `.gitignore` 제안(`gitignoreHint` — 플러그인 폴더 `.litecode/plugins/sql-tuning/` 가 `.gitignore` 에 없으면 처음 한 번 글만, 파일은 고치지 않는다). 모든 글을 이스케이프하고 비밀번호 · 접속 주소 · 호스트 · 계정을 지우며(계정이 스키마와 같으면 객체 소유자라 둔다) 바인드 문자열은 길이만 적는다. 데이터 행은 받지 않는다 · `removeReport` — 패널의 [삭제] 가 부르는 `delete_report` 도구의 몸(결과서 폴더 하나만 지움 — 새 위치를 먼저, 없으면 옛 `sql-tuning-reports/`: 이름이 `<날짜>-<시각>` 모양이어야 하고 링크로 허용 범위(새 위치는 플러그인 폴더, 옛 위치는 프로젝트) 밖이면 거절. 짝인 `reports` 줄도 지운다. 앱의 `project.removeFile` 은 `.litecode/*.md` 만 지워서 파일 권한이 있는 서버가 지운다)
- `server/checksum.ts` — compare 의 결과 체크섬(행 순서와 상관없음)
- `server/guard.ts` — 한 문장 · SELECT/WITH 만, 오류 글의 비밀번호 지우기
- `server/adapters/oracle.ts`(node-oracledb thin — Oracle Client 불필요) · `server/adapters/postgres.ts`(pg)
- `skills/sql-tuning/SKILL.md` — MyBatis 매퍼 · JPA 코드로 요청하면 captured_sql 로 실제 SQL 을 먼저 찾고(없으면 직접 바꾸고 explain 으로 확인) 답은 코드 diff 로 (#1056). 답의 차례 ① SQL 고쳐 쓰기 → ② 힌트 → ③ 인덱스(제안만) → ④ 그 밖. ①② 는 compare 로 바인드 값 3개 이상 · 결과 동일 확인, ③ 은 impact_check 로 다른 쿼리 · 쓰기 빈도 · 겹치는 인덱스 (#1054)

- `skills/sql-tuning/references/<dbms>.md` — DBMS 별 튜닝 주의점(바인드 · 문법 · 힌트 · 인덱스 검증 절차). SKILL.md 는 어느 DB 에나 같은 절차만 두고, 연결된 DB 의 파일을 읽게 한다. DBMS 를 더하면 이 폴더에 파일 하나 (#1078)
- SQL 개발 표준은 우리가 정하지 않는다 — 사내 표준 문서를 md 로 바꿔 쓴다. 스킬은 프로젝트의 `.litecode/sql-standard.md`(팀이 커밋, 패널에서 고침)를 먼저, 없으면 `skills/sql-tuning/references/sql-standard.md`(플러그인 기본, 지금은 비어 있음)를 튜닝 전에 읽고, 제안을 그 규칙에 맞추며 규칙 번호를 근거로 단다. 답의 Standard 줄에 어느 파일인지 적는다. 둘 다 없으면 표준 판정은 하지 않는다. 플러그인 기본은 zip 을 만들 때 `--standard` 로 넣거나, 묶기 전에 그 자리에 파일을 둔다

TypeScript 를 그대로 `node` 로 돌린다(Node 22.18+ 의 타입 걷어 내기 — 파라미터 속성 · enum 같은 걷어 낼 수 없는 문법은 쓰지 않는다).

## 플러그인으로 쓰기 (litecode)

1. `node plugins/sql-tuning/build.mjs [--standard <사내 표준.md>] [--dir]` → `build/sql-tuning.zip`(`--dir` 이면 `build/sql-tuning/` 폴더 — 앱 개발 모드가 연결한다) (표준 없이 올릴 때는 `npm run release sql-tuning`). `--standard` 를 주면 그 문서를 스킬의 `references/sql-standard.md` 로 싣는다(Word · PDF · HWP 는 먼저 Markdown 으로). 앱이 스킬 폴더를 통째로 엔진에 옮기므로(#1081) AI 가 읽는다 (서버는 드라이버째 한 파일로 묶여 PC 에 Node 가 없어도 된다 — 앱이 자기 실행 파일로 돌린다)
2. 설정 › 기능 › 플러그인 에서 zip 을 설치한다. 쓸 범위(이 프로젝트 · 모든 프로젝트)를 고르고, 다음 단계 폼에 DB 연결 정보를 넣는다. **설치 2 단계 폼의 [연결 확인] 은 서비스가 아직 안 떠 있어 안 된다(`check-unavailable`)** — 설치한 뒤 설정 › 기능 › 플러그인 › SQL 튜닝 에서 [연결 확인] 을 눌러 "연결됨 — …" 이 보이면 된다
3. 대화에서 튜닝을 요청한다. 스킬은 플러그인이 켜져 있는 동안 앱 스킬로 보인다
4. (선택) 오른쪽 패널 `+` › SQL 튜닝 — 이 프로젝트의 표준 문서를 고치거나 바꾸고(새 대화부터 적용, 커밋하면 팀에도), 연결을 확인 · 고친다

DB 연결 정보는 "이 프로젝트" 로 켜면 프로젝트마다 따로, "모든 프로젝트" 면 플러그인 하나에 하나. 바꾸려면 설정 › 기능 › 플러그인 › SQL 튜닝 › [고치기] 또는 패널의 [연결 정보 고치기](같은 폼). 서버는 AI 가 처음 부를 때 뜨고(프로젝트 폴더마다), 10분 안 쓰면 앱이 내린다. DB 접속은 서버가 쥐고 있다가 5분 안 쓰면 닫는다(`SQL_TUNING_IDLE_MS`).

## MCP 서버로 쓰기 (davis-code 등, 이 저장소에서)

1. DB 계정은 **조회 전용**으로 만든다 — 서버는 권한을 대신 지킬 수 없다(읽기 전용 트랜잭션 · 문장 검사는 둘째 담).
   - Oracle: `CREATE SESSION` + 대상 테이블 `SELECT` + `SELECT_CATALOG_ROLE`(V$SQLAREA · DISPLAY_CURSOR). INSERT 권한 없이도 `EXPLAIN PLAN` 은 된다(PLAN_TABLE 은 세션 임시 테이블, 실측 2026-11-02 Oracle Free 23).
   - PostgreSQL: 대상 테이블 `SELECT` + `pg_read_all_stats`(top_queries). `top_queries` 는 `pg_stat_statements` 가 있어야 한다.
2. 앱 MCP 팝업에서 이 프로젝트에 서버를 더한다 — 명령 `node plugins/sql-tuning/server/index.ts`, env `DATABASE_URL` 은 **비밀 변수**로(앱이 암호화, AI 는 값을 못 본다). 파일로 쓰면:
   ```json
   { "mcpServers": { "sql-tuning": { "command": "node", "args": ["plugins/sql-tuning/server/index.ts"], "env": { "DATABASE_URL": "${DB_URL}" } } } }
   ```
3. 스킬: `skills/sql-tuning` 폴더를 통째로(references 포함) 호스트의 스킬 폴더로 복사한다. 사내 표준은 그 안 `references/sql-standard.md` 로 넣는다.
4. 승인: 쿼리를 실제로 실행하는 `runtime_plan` · `compare` · `query` 와 실제 바인드 값을 읽는 `captured_sql` 은 매번 묻게 둔다 — 엔진 권한에서 `sql-tuning_runtime_plan` · `sql-tuning_compare` · `sql-tuning_query` · `sql-tuning_captured_sql` 을 `ask`.

선택 env: `SQL_TUNING_SCHEMA`(스키마 없는 테이블 이름을 찾을 기본 스키마 — 매퍼 SQL 은 보통 이름만 쓴다. Oracle `CURRENT_SCHEMA`, PostgreSQL `search_path`) · `SQL_TUNING_ROW_LIMIT`(기본 50) · `SQL_TUNING_TIMEOUT_MS`(기본 10000, 실행 한 번마다) · `SQL_TUNING_POOL`(기본 1 — DB 연결 수 상한. 한 프로젝트 폴더의 대화들이 서버 하나를 같이 쓰므로, 여러 대화를 동시에 돌리면 늘린다. 1 이면 도구 호출이 한 줄로 선다) · `SQL_TUNING_IDLE_MS`(기본 300000 — 이만큼 도구 호출이 없으면 DB 연결을 닫고 다음 호출에서 다시 잇는다, 0 이면 닫지 않음. 서버가 떠 있어도 쓰기 전에는 접속하지 않는다) · `SQL_TUNING_COMPARE_ROWS`(기본 100000 — compare 가 한 번 실행에서 읽는 최대 행 수, 넘으면 partial).

기록된 쿼리(`top_queries` · `impact_check`)에서는 SYS · SYSTEM 과 **이 도구의 접속 계정** 것을 뺀다 — 도구 자신의 사전 조회와 compare 실행은 업무 부하가 아니다. 그래서 튜닝 계정은 업무 계정과 따로 둔다.
Oracle 의 인덱스 사용 수(`DBA_INDEX_USAGE`, 12.2+)는 표본 추적이고 약 15분마다 반영된다 — 0 이어도 안 쓰인다는 뜻은 아니다. 쓰기 수(`ALL_TAB_MODIFICATIONS`)는 마지막 통계 이후이고 몇 분 늦게 반영된다.

## 데이터가 나가는 범위

도구 결과(SQL · 테이블 · 열 이름 · 실행계획 · 통계 · compare 의 행 수와 체크섬)는 대화의 일부로 사내 LLM(Gateway 경유)까지 간다. `explain` · `table_info` · `top_queries` · `impact_check` · `runtime_plan` · `compare` 는 데이터 행을 돌려주지 않는다(`table_info` 는 열 통계의 최소 · 최대값도 뺀다). `top_queries` 의 SQL 글에는 리터럴 값이 들어 있을 수 있다. 데이터 행은 `query` 만 — 매번 승인. `captured_sql` 의 바인드 값(Oracle)은 실제 값이다(이메일 등이 들어 있을 수 있다) — 매번 승인. `report` 가 만드는 결과서는 프로젝트 폴더의 로컬 파일이라 어디로도 나가지 않는다(비밀번호 · 접속 정보 · 데이터 행 없음, 문자열 바인드는 길이만) — 다만 SQL 글은 그대로 들어가니 개인정보가 든 리터럴이 있으면 결과서에도 있다.

## 라이선스 (Oracle)

`DBMS_SQLTUNE`(Tuning Pack) · AWR `DBA_HIST_*`(Diagnostics Pack)은 쓰지 않는다. `EXPLAIN PLAN` · `DBMS_XPLAN` · `V$SQLAREA` 는 팩 없이 쓰는 것으로 알고 있으나 고객사 적용 전에 라이선스 담당 확인.

## 개발

- 묶기: 위 "플러그인으로 쓰기" 1번 — `node plugins/sql-tuning/build.mjs [--standard <사내 표준.md>]`, `--dir` 이면 `build/sql-tuning/`(앱 개발 모드에서 연결).
- 테스트: `plugins/sql-tuning/tests/` (`npm test -- --project sql-tuning`) — 가짜 어댑터 · 가짜 드라이버로만(실물 DB 테스트는 두지 않는다).
- 앱에서 못 본 것: 앱 안에서 AI 가 `report` 를 불러 서버가 `LITECODE_DB_URL` 로 색인을 쓰는 종단, 프로젝트 `.litecode/plugins` 폴더가 `project.listDir` · `readFile` 로 읽히는지, Windows. 실제 DB(Oracle · PostgreSQL)가 필요한 확인(튜닝 도구)은 하지 못했다 — 이번 변경은 결과서 저장 위치 · 색인만 바꿨다.
- 배포: `npm run release sql-tuning`.
