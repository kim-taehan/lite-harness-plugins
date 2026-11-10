# File formats

All files are plain Markdown in the project's plugin folder `.litecode/plugins/ui-test/`: scenarios in `scenarios/`, reports in `reports/`. Deleting the plugin deletes this whole folder (the app asks first), including the scenarios the user wrote. Whether to commit them is the user's choice — don't add them to git or assume a team shares them.

## Scenario — `.litecode/plugins/ui-test/scenarios/<request id>-01.md`

The file name is `<request id>-<number>.md` directly in the scenario folder (ASCII, no sub-folders; the request id comes from `newRequest`, e.g. `20261110T110500_01-02.md`). The name never changes after the first save — the scenario's records are keyed by it. The title is `name:` inside the file. Scenarios imported from the old `ui-tests/` may have Korean names; they are read as they are.

```markdown
---
name: 정상 가입설계
kind: 정상
targets: [web]
tags: [가입설계, 스모크]
account: user
request: "가입설계 화면 테스트 구성해 줘"
requested: 2026-11-10T02:05:00.000Z
screens: [/join/design]
screen-names: {/join/design: 가입설계}
sources: [src/main/webapp/join/design.jsp@3f2a9c1b7d04, src/main/java/ins/join/JoinDesignService.java@9b1e0c55aa21]
---
1. 로그인한다
2. 가입설계 메뉴를 연다
3. 고객 40세 · 상품 "든든종신" 을 고르고 [보험료 계산] 을 누른다
4. 확인: 월 보험료가 보인다
5. 확인(DB): 설계 테이블에 그 고객의 행이 하나 생긴다

## 테스트 방법
- 사전 조건: 계정 user(설정의 테스트 계정), 시작 주소 /join/design, 판매 중인 상품 "든든종신"
- 입력 데이터: 생년월일 1986-01-01(40세), 상품 든든종신, 특약 A·B
- 화면 요소 찾는 법: 로그인 칸은 label(아이디·비밀번호), 버튼은 role button + 이름, 상품은 #productCode
- 기다리는 법: 로그인 뒤 URL /main, 계산 뒤 /api/premium 응답과 "월 보험료" 글
- 확인 방법: 4 — getByText("월 보험료") 가 보임 / 5 — (DB) SELECT COUNT(*) FROM JOIN_DESIGN WHERE CUST_ID = …
- 마지막 성공: 2026-11-06 · 8.2초
```

- Head: `name` (title), `kind` (정상 · 검증 · 업무 규칙 · 권한 · 예외; shown as the scenario's kind), `targets` (`[web]` for now), `tags` (kept for older files, shown as kind-like labels at most), `account` (an account name, never the password), and the tag lines below.
- `request: "<the chat request, one line>"` and `requested: <ISO time>` — the **request tag**: copy both lines exactly from the `newRequest` result into every scenario of that request. Never change them later. (Use single quotes inside the text; no line breaks.)
- `screens: [<route>, …]` — the **screen tag** you expect: route patterns of the screen under test (`/admin/menu`, `/orders/:id` — numbers and long ids written as `:id`). Used only until the scenario has run once; after that the run's `확인:` steps decide and this line is ignored — **except for a login scenario** (tags include `로그인`, or a `screens` route ends in login · signin · sign-in · log-in): it keeps exactly the screens written here and never gets the screens it lands on after logging in (`/dashboard` …) as tags. `screen-names: {<route>: <name>, …}` (optional) gives screens readable names. These four lines do not change the scenario fingerprint.
- `sources: [<path>@<fingerprint>, …]` — the front-end and back-end files this scenario was drafted from, each with its content fingerprint: project-relative, or an absolute path for a file in a back-end code folder (settings). An absolute path is tied to this PC — on another PC it shows as 코드 바뀜(없음). Get the exact line from the `fingerprint { files }` tool; never compute it yourself. `list` marks the scenario **코드 바뀜** when one of these files changes or disappears. Changing this line does not change the scenario fingerprint (the code does not become stale).
- Steps: a numbered list before the first `##` heading, one action or check per line, written in plain words. A line starting with `확인:` is a check the runner executes **and the moment the scenario's screen tag is taken** (the address at that moment). A line starting with `확인(DB):` is a database check the runner does **not** execute — it is checked in the chat with a DB tool. Pass-through screens (login) should have no `확인:` line, so they don't become screen tags.
- `## 데이터` (optional) — a Markdown table; the runner runs the scenario **once per row** in a fresh browser, and the code reads the row as `data.<column>`. Columns are the variables plus an expected column (e.g. `기대`). Put it after the steps and **before** `## 테스트 방법`. Don't name columns `today`, `stamp`, `row` or `label` (the runner sets those). Escape a `|` inside a cell as `\|`. Results, report and comparison are per row ("<id> 2행").

```markdown
## 데이터
| 나이 | 기대 |
|---|---|
| 69 | 계산됨 |
| 70 | 계산됨 |
| 71 | 가입 가능 나이가 아닙니다 |
```

- `## 테스트 방법` — written by the AI after the scenario first passes, updated when a fix changes how it is tested. Short bullets, in this order: 사전 조건 (account name, start address/menu path, required data state) · 입력 데이터 (values actually used, personal-looking values masked like 900101-1******; when the value came from a lookup, also the **conditions** it had to meet, their code source `file:line` and the read-only SELECT — see Data problems in SKILL.md) · 화면 요소 찾는 법 (selector style per step, only the key ones) · 기다리는 법 (which signal: message, response, URL) · 확인 방법 (how each 확인 line was judged; for 확인(DB) the query) · 마지막 성공 (date · duration). A person can follow it by hand; the AI follows it when regenerating code. The fingerprint of a scenario ignores this section (and the `sources:`, `request:`, `requested:`, `screens:`, `screen-names:` lines), but includes the head, steps and `## 데이터`.

- `## 시행착오` (optional) — lessons from fixing this scenario, **after** `## 테스트 방법` (the fingerprint ignores everything from `## 테스트 방법` to the end, so editing it never makes the code stale). One bullet per lesson, tagged with the step it concerns:
  `- 3단계 · 11-09 · 증상: 로그인 뒤 /main 대기가 시간 초과 → 원인: SPA 라 URL 이 안 바뀜 → 해결: "프로젝트 현황" 제목이 보이길 기다림`
  Keep only lessons that help next time (not typos or one-off errors) and only test-side ones — an app defect is not a lesson. At most 3 bullets per step, newest first; no total cap, but when the section passes about 40 lines merge duplicates and drop bullets for steps that no longer exist or whose screen/code changed. No passwords or personal data (mask like in 테스트 방법).

## Running without the AI (CI)

Copy the CI command line exactly as `list` prints it ("AI 없이: …") — it points at the plugin's bundled runner: `run [<scenario id>…] [--failed] [--screen <route>] [--request <request id>] --headless`. Environment: UI_TEST_BASE_URL (target), UI_TEST_USER, UI_TEST_PASSWORD (from the CI secret store), UI_TEST_BROWSER (Chrome · Edge). The scenario and report folders are fixed under the project (`.litecode/plugins/ui-test/`) — run the command from the project folder. Exit code 1 when any scenario fails. Outside the app there is no record store: the run and its report work, nothing is recorded or compared, and `--screen` / `--request` / `--failed` are not available (name the scenarios instead). To run in CI, copy the plugin's `server/` folder (runner + its `node_modules/playwright-core`) next to the repo or onto the CI machine and adjust the path; the machine needs Node 20+ and Chrome or Edge.

Reports: `.litecode/plugins/ui-test/reports/<run id>/<scenario id>/index.html` — always one report per scenario (older runs may have `.litecode/plugins/ui-test/reports/<run id>/index.html`, a section per scenario); the guide and PDFs sit in the same run folder.

## Generated code — `.litecode/plugins/ui-test/scenarios/<request id>-01.spec.mjs`

Same stem as its scenario. First line:

```js
// ui-test source: .litecode/plugins/ui-test/scenarios/20261110T110500_01-01.md · fingerprint: <12 hex>
```

Copy the fingerprint `list` shows for the scenario (`지문 …`) — don't compute it. (It is the first 12 hex characters of SHA-256 over the scenario file's non-empty lines, trailing spaces removed, **before** `## 테스트 방법`, without the front-matter `sources:`, `request:`, `requested:`, `screens:` and `screen-names:` lines, joined with `\n`.) When the scenario changes, `list` marks the code **코드 낡음** until you regenerate it with the new fingerprint. Body: see `step-api.md`.
