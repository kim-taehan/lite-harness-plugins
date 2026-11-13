---
name: ui-auto-evidence
description: UI-AUTO shared rules (brevity, work log, evidence lookup, route, page_id, record and merge, mismatch, integrity check, lessons, file formats) for .litecode/ui-auto/. Not a response to a user request by itself. Loaded as the first step of ui-auto-run, ui-auto-tc, ui-auto-ask and ui-auto-guide, before reading or writing anything under .litecode/ui-auto/.
---

# ui-auto-evidence

Write in Korean (answers, log lines, evidence). Write tags, headings, column names and status values exactly as here.

## 1. Brevity of written text — never of the work

Brevity applies only to what you write (chat answers, log lines, evidence files, reports, guides). The work itself is never shortened: do every step of the procedure, every tool call, every capture, every check, every evidence update and the integrity check, exactly as this document says, however long it takes.

- Write only the core. One sentence per cell or field, no restating, no background, no plans of what you will do next.
- Log: one line per step, `<태그> <대상> — <결과>`, about 100 characters at most. Still one line for every step and every browser call.
- Final answer to the user: at most 5 lines, then the summary table. No repeated explanation of rules or of earlier failures.
- Evidence files: fill the format completely, nothing extra. `요약` ≤ 3 lines, `실제 결과` ≤ 2 sentences with the exact screen text, a lesson ≤ 6 lines.
- Short, but never without the core. Always keep: the verdict, the exact screen text or number it rests on, what failed and why, what was changed (file paths), what the user must do next. Cut only background, repetition and filler.
- Readable: plain Korean, one idea per sentence and per line, the most important fact first. Use a table for several facts of the same shape, a numbered list for steps, quotes for screen text. Keep ids, paths, numbers and messages exact. In answers to the user, no tool internals or English jargon unless they ask.

## 2. Basics

You test web screens with the UI-AUTO browser tools and leave evidence under `.litecode/ui-auto/`. The next task reads the evidence first to explore less. You never create a tool.

Tools (in your tool list as `litecode_ui-auto_<name>`; this document writes bare names):

| Tool | Use |
|---|---|
| `begin` | First call of every task. Gives run_id (and guide_id), date-time, base URL, freshness limit, test data, login state, lessons index. Never compute these yourself, never run `date` |
| `login` | Logs in with the account of the plugin settings and saves the session. You never see or type a password |
| `guide` | Writes the test guide of one TC (`guides/guide-<tc_id>.md`) from its newest passed report. Call it after the report of every passed run |
| `format` | Returns one file format of section 8 or 7 (`system_map` · `page` · `run_log` · `report` · `script` · `route` · `lessons`). Call it whenever you need a format again during a task |
| `browser_*` | Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot`, `browser_find`, `browser_wait_for`, `browser_close` …) |

Files:

| Path (under `.litecode/ui-auto/`) | Content |
|---|---|
| `system_map.md` | 진입점 · 페이지 목록 · 이동 관계 · 흐름도 · 페이지 설명 |
| `pages/<page_id>.md` · `pages/history/<page_id>.md` | One page: 요약, 화면 요소, 테스트 케이스, TC 상세, 확인 사항, 수행 이력(최근 10건) · older runs |
| `scripts/<page_id>/<tc_id>.yaml` · `scripts/routes/<edge_id>.yaml` | TC script · navigation script (lists of browser tool calls) |
| `captures/<page_id>/` | `page.png` and `<run_id>-<tc_id>-step<NN>.png` of the target page only |
| `reports/<run_id>.md` · `guides/<guide_id>.md` · `logs/<run_id>.md` | Report · test guide · run log |
| `testdata.md` · `lessons-learned.md` | Test input values `이름=값` · hard-won lessons (index on top) |

Data structure and references (what points to what — keep these links valid when you write):

```
system_map.md ─ 페이지 목록.문서 ─────────▶ pages/<page_id>.md
             └ 이동 관계.이동 스크립트 ──▶ scripts/routes/<edge_id>.yaml
pages/<page_id>.md ─ 테스트 케이스.스크립트 ─▶ scripts/<page_id>/<tc_id>.yaml ─ edges ─▶ scripts/routes/<edge_id>.yaml
                   │                                                          └ data $NAME ─▶ testdata.md (or plugin settings)
                   └ 수행 이력 <run_id> ─ 보고서 ─▶ reports/<run_id>.md ─ images ─▶ captures/<page_id>/*.png
                                       └ 로그 ──▶ logs/<run_id>.md
                                       └ 교훈 ──▶ lessons-learned.md L-NNN (관련 page_id ◀─)
guides/guide-<tc_id>.md ─ based_on ─▶ reports/<run_id>.md (newest 성공)
```

- One id joins everything: page_id (map row ↔ page doc ↔ captures folder ↔ scripts folder), tc_id (TC row ↔ TC 상세 ↔ script ↔ 수행 이력 ↔ guide), run_id (수행 이력 ↔ report ↔ log ↔ capture names), edge_id (map row ↔ route file ↔ script `edges`).
- Write order in a run: captures → script / routes → page doc (TC row, 수행 이력) → system_map → report → guide (passed runs) → lessons (if hard) → run log. The panel reads these files directly, so a missing link shows as an empty part of the panel.

Ids: page_id = lowercase hyphen words from the URL path (`/orders/list` → `orders-list`, `/` → `main`, popup → `<parent>--<구분어>`). edge_id = `<출발>__<도착>` (`-2` for a second way). tc_id = `<page_id>-TC-<NNN>`, never reused. run_id / guide_id from `begin`. Dates `YYYY-MM-DD`.

Routing: perform or re-run → ui-auto-run. derive TCs → ui-auto-tc. questions → ui-auto-ask. guide document → ui-auto-guide. Two intents (derive and run): ui-auto-tc first. Unclear: ask once.

Rules:
- Stay inside the project. Read and write only under `.litecode/ui-auto/`. Never use the shell, never search the file system (`find`, `mdfind`, `ls` outside the project), never read files outside the project (the skill files, app folders, tool-output files). To see a rule or a format again, call `format` or load this skill again with the skill tool.
- For every test task read `system_map.md` first. Do not fill gaps with guesses; say what is not recorded.
- Never write an account, password, token or personal data anywhere. Never type a password.
- When unclear, ask one short question with the choices. Check `확인 사항` of the page doc first; record every answer there.
- Freshness: a row older than the limit of `begin` is "오래된 정보": use it, say so in the log.
- A task that opened the browser ends with `browser_close`, also on 실패 or 차단.
- Stuck rule: when the same action fails twice, before the third try find the matching row of the lessons index (from `begin`) and read that block. Log `[교훈 조회]`.
- Panel runs: the UI-AUTO panel can replay scripts without you and writes the same formats (수행 이력 line `- 수행: UI-AUTO 패널 (LLM 없이 스크립트 재생)`). A panel run 차단 with `스크립트 불일치` needs procedure E from you.

## 3. Work log

Print one line right after each step, and save the same lines to `logs/<run_id>.md` at the end.

```
[skill] <이름> 로드 — <이유: /ui-auto-run 으로 지정됨 | 요청이 테스트 수행에 해당함>
[증적 조회] <파일> — <찾은 것 | 해당 없음>
[경로] <a → b → c> — 근거 edge: <ids> | 탐색 필요 구간: <… | 없음>
[활용 단계] <1~4단계> — <근거>
[증적 활용] <증적> → <생략한 일>
[tool] <tool>(<핵심 인자>) — <결과>
[스크립트] <파일> — <실행|생성|수정> — <결과>
[불일치] <증적> ≠ <실제> — <조치>
[증적 갱신] <파일> — <바꾼 것>
[교훈 조회] lessons-learned.md <id> — <힌트 | 해당 없음>
[교훈 기록] lessons-learned.md <id> — <한 줄 요약>
[판정] <tc_id> — <성공|실패|차단> — <근거>
```

One `[tool]` line per browser call. End the task with this table (`없음` in empty cells):

| 참고한 증적 | 새로 만든 증적 | 갱신한 증적 | 증적 덕분에 생략한 작업 |
|---|---|---|---|

## 4. Procedures

**A. Lookup** (print `[증적 조회]` after each read, also `해당 없음`): 1) `system_map.md` — is the page in `페이지 목록`, is there a route (B)? 2) `pages/<page_id>.md` if it exists. 3) list `scripts/<page_id>/` and the 스크립트 상태. 4) `logs/` only for the reason of a recent failure. 5) lessons index rows that name the page or the kind of work → read those blocks.

**B. Route**: start at an `진입점`, join `이동 관계` rows to the target. Prefer edges with 상태 `유효` and the newest 최근 확인일; never `폐기`. Use the recorded part and explore only the missing part. Print `[경로]`.

**C. page_id**: URL path without query → same pattern in `페이지 목록`? use it. Else make one (Ids). Never two page_ids for one screen or one page_id for two screens; if the name is taken by another URL, add the differing path part; if two ids share a URL, merge into the older one.

**D. Record and merge**: read before write and merge, never overwrite a whole file. Existing row: update only 최근 확인일 and 상태; add missing rows. Update map, page doc, scripts, routes, report and run log together. Write only what you observed (`미확인` otherwise). Print one `[증적 갱신]` per file.
- system_map: new page → a `페이지 목록` row and a page doc (also pages passed on the way); each new move → one `이동 관계` row; each dialog seen on a page → one `모달` row; then rewrite `흐름도` and the page's `페이지 설명` block.
- page doc: new page from `pages/_template.md`; keep `화면 요소`, `테스트 케이스`, `TC 상세` in step; a `확인 사항` row per answer; a `수행 이력` entry per run (newest first; over 10 → move the oldest to `pages/history/<page_id>.md`).
- ui-auto-run writes `reports/<run_id>.md`; ui-auto-tc and ui-auto-ask write no report.

**E. Mismatch**: a move or arrival check fails → set that edge `불일치`, explore only that part, fix the row and its navigation script, set `유효` again. A script fails → look at the screen and decide: 화면 변경 (fix the script and the map, re-run, record the re-run) · 실제 결함 (keep the script, TC `실패` with captures and reason) · unclear (TC `차단`, ask the user). A script broken by 화면 변경 and not yet fixed is `깨짐`. Print `[불일치]`. In the `수행 이력` entry add `- 자가 복구:` (what broke, each attempt, what worked, changed files) when you repaired something, `- 원인 추적:` (symptom, what you checked, cause) when you dug out a cause. If it took several attempts, write a lesson (section 7).

**F. Integrity check** (end of a task that wrote evidence; fix and log each): 1) every `페이지 목록` row has a page doc and vice versa; 2) every 출발/도착 is in `페이지 목록`; 3) every script, report, capture and image path named exists; 4) every `이동 스크립트` file exists; 5) no duplicate page_id or URL 패턴; 6) `흐름도` = pages and modals as nodes, non-`폐기` edges and modal openings as arrows; 7) one `페이지 설명` block per page; 8) lessons index rows and blocks match; 9) no `이동 관계` row with 동작 `URL 이동` — write the user action you saw (menu path, link) from the route file's notes or the run log, `미확인` if none was seen.

## 5. Utilization levels (use the highest that applies)

| 단계 | Condition | Do |
|---|---|---|
| 1 | TC script exists (`검증됨`, or `미검증` to verify now) | Replay navigation scripts then the TC script. No snapshots, no element search |
| 2 | No TC script, every edge has a navigation script | Replay the routes, work with MCP tools on the target page only |
| 3 | An edge has no navigation script, the map has the route | Do each move as its row says, find only the named element |
| 4 | No route | Explore |

Print `[활용 단계]` and `[증적 활용]`.

## 6. Data, login, browser, captures

- **Base URL**: user's request → `begin` (plugin settings) → `진입점` of the map. Write it into `진입 방법`. Ask before mixing two systems.
- **Login** comes only from the plugin settings, never from `testdata.md`. If `begin` says login is set and no session is saved, call `login` before the first browser call. If a page shows the login screen, call `login` once and navigate again. If `begin` or `login` says an item is missing, tell the user that item (for example "설정의 테스트 계정 아이디가 비어 있습니다") and stop.
- **Test input**: user's request → `testdata.md` (from `begin`) → `확인 사항` → ask the user once, proposing a value taken from the TC content (for example "요구사항명은 '신규 요구사항 추가 테스트' 로 할까요?"). An empty `testdata.md` is normal; never stop because of it. Record a value you will need again in `testdata.md` as `이름=값` (never an account). In a script write such a value as `$이름`; in `수행 이력` as `name=값 (testdata: NAME)`.
- **Browser**: use only tools in your list. The UI-AUTO browser shows a navy `UA` tab icon; it is not part of the system. Results may give the snapshot as a `.yml` link: call `browser_snapshot` instead of reading files outside the project. If a tool says the panel is running, wait for the user.
- **Captures** (target page only): `.litecode/ui-auto/captures/<page_id>/page.png` on arrival when missing or at levels 2–4 (`browser_take_screenshot` with `filename`); `.litecode/ui-auto/captures/<page_id>/<run_id>-<tc_id>-step<NN>.png` with the `capture` tool — right before step NN, with `step` = NN and `targets` = that step's `target` / `element` (all fields of a fill_form), so the capture shows the screen where the step is done with a red numbered box on the acted element; after the last step and the verify, one more `capture` without targets of the verdict screen (also of a failed or blocked screen). No upper limit.

## 7. Lessons learned (`lessons-learned.md`)

Write a block only when it was hard: worked only after 2+ failed attempts, a non-obvious self-repair, a cause dug out (console, network, hidden or duplicate element, timing, data), or behavior a tester would not expect. Not for easy things or what `확인 사항` already holds. Same case again → add `- 다시 겪음: <날짜> <run_id>` to its block.

```markdown
## 색인
| id | 분류 | 한 줄 요약 | 관련 page_id | 기록일 |
|---|---|---|---|---|
| L-001 | 이동 | 메뉴 클릭은 클라이언트 예외 → 직접 URL 로 이동 | orders-list | 2026-11-10 |

## L-001 메뉴 클릭은 클라이언트 예외 → 직접 URL 로 이동
- 상황: 메뉴 "주문 목록" 클릭 시 "Application error" 표시
- 시도한 것: 1) 메뉴 클릭 2) 새로 고침 후 클릭 3) 콘솔 확인 — 라우터 오류
- 해결: `/orders/list/41715` 로 바로 이동하면 정상
- 다음에 이렇게: 이동 스크립트 `scripts/routes/main__orders-list.yaml`(URL 이동) 사용
- 근거: logs/20261110-001.md
```

id `L-NNN` never reused; 분류: 이동 · 로그인 · 요소 찾기 · 입력 · 대기·타이밍 · 데이터 · 판정 · 환경 · 기타; 한 줄 요약 = `<증상> → <해결>`. Update the index row and the block together; add `- 교훈: <id>` to the run's `수행 이력` entry; print `[교훈 기록]`.

## 8. File formats

### system_map.md

```markdown
## 진입점
| page_id | 진입 방법 |
|---|---|
| main | https://portal.example.com/ 로 이동 (로그인 필요) |

## 페이지 목록
| page_id | 화면명 | URL 패턴 | 도착 확인 방법 | 문서 | 최근 확인일 |
|---|---|---|---|---|---|
| orders-list | 주문 목록 | /orders/list | URL이 /orders/list 로 끝남 + heading "주문 목록" 표시 | pages/orders-list.md | 2026-11-10 |

## 이동 관계
| edge_id | 출발 | 동작 | 대상 요소(역할·이름) | 전제조건 | 도착 | 이동 스크립트 | 최근 확인일 | 상태 |
|---|---|---|---|---|---|---|---|---|
| main__orders-list | main | 메뉴 선택 | 주문 관리 › 주문 목록 | 로그인 상태 | orders-list | scripts/routes/main__orders-list.yaml | 2026-11-10 | 유효 |

## 모달
| modal_id | 페이지 | 모달 이름 | 여는 동작 | 대상 요소(역할·이름) | 캡처 | 최근 확인일 |
|---|---|---|---|---|---|---|
| orders-list__order-new | orders-list | 주문 등록 | 클릭 | button "추가하기" | captures/orders-list/20261110-001-orders-list-TC-001-step02.png | 2026-11-10 |

## 흐름도
(mermaid flowchart LR from the tables)

## 페이지 설명
### orders-list 주문 목록
![주문 목록](captures/orders-list/page.png)
- 설명: 1~3 sentences
- 주요 요소: role "name", up to 8
- 들어가는 방법: main → orders-list
- 테스트 케이스: 2건 (성공 1, 미수행 1)
```

- 화면명 as the screen shows it. URL 패턴: path only, `*` for data parts. 동작 = what a user does to get there: 클릭 · 입력 후 제출 · 메뉴 선택 (대상 요소 = the menu path `상위 › 하위 › 메뉴`). Write the user action even when the navigation script uses a direct URL because the click fails (note it in 전제조건, for example `메뉴 클릭 오류로 스크립트는 URL 이동 (L-001)`); `URL 이동` only when the user really types the address. 대상 요소: `<role> "<name>"` from the snapshot, never a `ref`. 상태: 유효 · 불일치 · 폐기. 이동 스크립트 `없음` until the file exists.
- 모달: every dialog (`dialog`, `alertdialog`, a layer with its own title) a step opened on a page. modal_id = `<page_id>__<short-name>`. 여는 동작 / 대상 요소 = what opened it. 캡처 = a step capture that shows it open, `-` if none.
- 흐름도: node id = page_id with `-` → `_`; text `화면명<br/>page_id`, with `<img src='captures/<page_id>/page.png' width='220'/><br/>` in front when the file exists; entry `id(["…"])`, others `id["…"]`; arrow `출발 -->|"<동작>: <대상 요소>"| 도착`; `불일치` as `-.->`; `폐기` not drawn; a modal as `<modal_id with - → _>{{"모달 이름"}}` with `<page> -.->|"<여는 동작>: <대상 요소>"| <modal>`. Rewrite the whole block when a table changes.
- 페이지 설명: one block per page, in table order; no capture → `캡처 없음 (아직 테스트 대상이 된 적 없음)`.

### Page doc (`pages/_template.md`, keep headings and columns)

- Front matter: page_id, title, url_pattern, arrive_check (same as the map), last_verified, related_pages.
- `화면 요소` | 요소 | 역할 | locator | 비고 | — every operable element and every result element; locator usable as a script `target`; 비고 = observed facts or `미확인`, `삭제됨 (날짜)` when gone.
- `테스트 케이스` | tc_id | 내용 | 상태 | 최근 수행일 | 스크립트 | 스크립트 상태 | — 내용 `<조건·입력> → <기대 결과>` with exact text; 상태 미수행 · 성공 · 실패 · 차단 · 폐기; 스크립트 상태 없음 · 검증됨 · 미검증 · 깨짐; `-` for no date or script.
- `TC 상세` `### <tc_id>` with `- 제목:` (the core as a written noun phrase, ≤ 20 characters, for example `신규 요구사항 추가`, `요구사항명 수정`, `필수 항목 누락 시 안내`), `- 목적:` `- 전제조건:` `- 절차:` `- 입력 데이터:` `- 기대 결과:` `- 도출 근거:`. The panel shows `제목` as the TC title; add it when it is missing.
- `확인 사항` | 날짜 | 질문 | 사용자 답변 | 적용 대상 |.
- `수행 이력 (최근 10건)` entry:

```markdown
### 20261110-001 orders-list-TC-001 (성공)
- 수행 방식: 스크립트 | 이동 스크립트+MCP | map+MCP | 탐색
- 입력 데이터: customer=홍길동
- 기대 결과: 상태 메시지에 "조회 결과 1건" 표시
- 실제 결과: 상태 메시지 "조회 결과 1건"
- 캡처: .litecode/ui-auto/captures/orders-list/20261110-001-orders-list-TC-001-step*.png (3장)
- 연관 페이지: main
- 로그: .litecode/ui-auto/logs/20261110-001.md
- 보고서: .litecode/ui-auto/reports/20261110-001.md
```

Add `- 불일치:`, `- 자가 복구:`, `- 원인 추적:`, `- 교훈:` only when they happened.

### Run log (`logs/<run_id>.md`)

```markdown
# 20261110-001

- 일시: (begin) · 요청: (user's words, no secrets) · skill: ui-auto-run · 대상: <page_id> / <tc_id> · 결과: 성공

## 로그
(every log line, unchanged)

## 요약
(the summary table)
```

대상/결과 for ui-auto-tc: `<page_id> / TC N건` · `TC N건 도출`; for ui-auto-ask: `질의` · `답변 | 증적 없음`.

### Report (`reports/<run_id>.md`, one per ui-auto-run)

```markdown
# 테스트 수행 보고서 20261110-001

| 항목 | 내용 |
|---|---|
| 일시 | 2026-11-10 14:05 |
| 요청 | (user's words) |
| 대상 페이지 | 주문 목록 (orders-list) |
| 테스트 케이스 | orders-list-TC-001 <내용> |
| 판정 | 성공 |
| 수행 방식 | 탐색 |

## 경로
main → orders-list (edge: main__orders-list)

## 수행 절차
1. 고객명에 "홍길동" 입력

## 입력 데이터
- customer=홍길동

## 기대 결과
## 실제 결과
## 판정 근거

## 캡처
### 대상 페이지 (수행 전)
![주문 목록](../captures/orders-list/page.png)

### 1. 고객명에 "홍길동" 입력
- 설명: 표시한 ① 고객명 입력란에 "홍길동"을 입력하면 입력란에 그 값이 보여야 합니다.
![step01](../captures/orders-list/20261110-001-orders-list-TC-001-step01.png)
- 한 일: "고객명 입력란"에 "홍길동" 입력
- 기대: 입력란에 "홍길동"
- 실제: 입력란 값 "홍길동"
- 판정: 일치

## 불일치·확인 사항
없음

## 관련 증적
- 페이지 문서 · 스크립트 (상태) · 로그 paths
```

- Every step capture, in order: the step's capture is the screen where it was done with the acted element marked; the last block is the verdict screen. Each block has `- 설명:` (one sentence a person can follow: what the marked element is, what to do, what must happen) and exactly the four lines `- 한 일:` `- 기대:` (the step's `expected`, or the TC's 기대 결과 for the verdict screen) `- 실제:` (exact screen text after the step) `- 판정:` (일치 · 다름 · 멈춤, or 수행됨 for a step with no own check). The panel, the PDF and the guide show each block as one page.
- 판정 근거: for 실패 how actual differs, for 차단 what blocked it. Values equal the `수행 이력` entry. Image files must exist. Print `[증적 갱신] .litecode/ui-auto/reports/<run_id>.md — 보고서 작성`.
- After the report of a passed run call `guide` with the tc_id: it writes the test guide (a different document for people who follow the steps) from this report. Print `[증적 갱신] .litecode/ui-auto/guides/guide-<tc_id>.md — 테스트 가이드 작성`. So write `- 한 일` / `- 기대` / `- 실제` so that a person can follow them.

### TC script (`scripts/<page_id>/<tc_id>.yaml`)

```yaml
tc_id: orders-list-TC-001
page_id: orders-list
edges: [main__orders-list]
생성일: 2026-11-10
최근 통과일: 2026-11-10
data:
  customer: $CUSTOMER_NAME
  expectedMessage: 조회 결과 1건
steps:
  - tool: browser_type
    args:
      element: 고객명 입력란
      target: "getByLabel('고객명')"
      text: "{customer}"
    expected: 입력란에 "{customer}"
  - tool: browser_click
    args:
      element: 조회 버튼
      target: "getByRole('button', { name: '조회' })"
    expected: 표가 다시 그려진다
verify:
  - tool: browser_wait_for
    args:
      text: "{expectedMessage}"
    pass: 오류 없이 끝남
    expect: { ok: true }
changes_data: false
```

- `steps`: target-page actions only; `tool` = bare tool name; `args` = exactly its arguments; `target` = a locator from "Ran Playwright code" (never a `ref`, in double quotes); `expected` = what the screen shows after it. Prefer click · type · fill_form · select_option · press_key · hover · file_upload · handle_dialog; `browser_run_code_unsafe` / `browser_evaluate` only when nothing else works.
- `verify`: each item with `pass` (words) and `expect`: `{ ok: true }` (wait_for text/textGone), `{ found: ">=1" }` (find; also `"0"`, `"=2"`), `{ equals: "{이름}" }` (evaluate). Without `expect` the panel cannot replay it. No fixed waits (`time`).
- `changes_data: true` when the TC creates, changes or deletes data. No account or password anywhere.
- Valid YAML: a value that starts with a quote must end with it. Write `expected: 등록 대화상자가 열린다` or `expected: '"등록" 대화상자가 열린다'`, never `expected: "등록" 대화상자가 열린다`. Quote a value that contains `: ` (`element: '검색 버튼 (default: 전체)'`). Never write a bare `-` as a value (`최근 통과일: -` is read as a list): leave the line out until the first pass. Update a key in place; never add the same key again at the end.
- Replay (level 1): navigate to the entry URL → each edge's navigation script → fill `{이름}` (user values override, file unchanged) → each step, with its marked capture right before it → each verify → the verdict capture; all pass → 성공; an error or failed check → capture, stop, procedure E. Print `[tool]` per call and `[스크립트] … — 실행 — <결과>`.
- New script = `미검증`, and write its path in the TC row's `스크립트` column at once; replay it once right after saving (ask first if `changes_data`); passed → `검증됨`, update `최근 통과일`; up to 3 fix-and-replay tries, else keep `미검증` with the reason.
- Data-only change requests: replay with the user's values, do not edit the script; ask for the new expected value if not given.

### Navigation script (`scripts/routes/<edge_id>.yaml`)

```yaml
edge_id: main__orders-list
from: main
to: orders-list
steps:
  - tool: browser_click
    args:
      element: 주문 목록 링크
      target: "getByRole('link', { name: '주문 목록', exact: true })"
arrive:
  - tool: browser_wait_for
    args:
      text: 주문 목록
    pass: heading "주문 목록" 표시
    expect: { ok: true }
```

Create it the first time you pass the edge; change it with the edge row. An entry point has no file. There is no login edge (login is the `login` tool).

## Do not

- Write evidence you did not observe, or example rows. Overwrite a file without merging. Record a `ref`, an account, a password or personal data. Reuse a tc_id. Answer the user with this skill alone. Write long texts.
