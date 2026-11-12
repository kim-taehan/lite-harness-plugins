---
name: ui-auto-tc
description: UI-AUTO — derive test cases for a target page from its current UI and add them to the page doc without running them. Use for requests like '테스트 케이스 뽑아줘', 'TC 도출', 'TC 정리해줘', '뭘 테스트해야 해', '테스트 항목 만들어줘'.
---

# ui-auto-tc

Keep written text short, complete in its core and easy to read (ui-auto-evidence "1. Brevity"). Never shorten the work: do every step, call, capture and check.

Output language: write everything the user sees (answers, log lines) and everything you record under `.litecode/ui-auto/` in Korean. Print log tags, table column names and status values exactly as written.

Terms: evidence = 증적 (everything under `.litecode/ui-auto/`), system map = `.litecode/ui-auto/system_map.md`, page doc = 페이지 문서 (`.litecode/ui-auto/pages/<page_id>.md`), edge = 이동 관계 (a row of the system map), navigation script = 이동 스크립트 (`.litecode/ui-auto/scripts/routes/<edge_id>.yaml`), script = 스크립트 (`.litecode/ui-auto/scripts/<page_id>/<tc_id>.yaml`, a list of Playwright MCP tool calls).

## Purpose

Look at the real screen of a page and list the test cases worth running, without duplicates of existing TCs.

## When to use

- The user asks what to test on a page, or asks to derive, list or organize test cases.

## Inputs

- Target page: a name, a URL or a page_id.
- Optional: viewpoints (정상, 오류, 경계값, 권한 and so on).
- Base URL of the system, if the user gave one. Otherwise the `base URL` of `begin`. The page is opened by URL in the browser.
- Login is done by the `login` tool with the account of the plugin settings. Test input values come from `.litecode/ui-auto/testdata.md`. Rules: ui-auto-evidence "6. Data, login, browser, captures".

If the target page is missing, ask the user once before you do anything else.

## Procedure

Print the log line named in each step right after the step.

1. Print `[skill] ui-auto-tc 로드 — <이유>`. The reason says how this skill was chosen, for example `/ui-auto-tc 로 지정됨` or `요청이 TC 도출에 해당함`.
2. Load the `ui-auto-evidence` skill with the skill tool. Print `[skill] ui-auto-evidence 로드 — 증적 조회 규칙 적용`. Then call the `begin` tool with kind `derive` and print `[tool] begin(derive) — run_id <run_id>, base URL <URL>`. Then do its procedure A (lookup) and procedure B (route). Decide the page_id with procedure C. Logs: `[증적 조회]`, `[경로]`.
3. If the page doc exists, read its `화면 요소` table, `테스트 케이스` table, `확인 사항` table and `수행 이력`. Note the TCs that ended in `실패` or `차단` and the `불일치` lines.
4. Move to the target page using the utilization levels of ui-auto-evidence (levels 2 to 4). If the route is recorded, do not explore. Logs: `[활용 단계]`, `[증적 활용]`, `[tool]`.
5. Take the page capture `.litecode/ui-auto/captures/<page_id>/page.png` (ui-auto-evidence, "6. Data, login, browser, captures") and a snapshot of the current screen. Compare its elements with the `화면 요소` table and update the differences in the page doc. Create the page doc from the template if the page is new.
6. Derive cases for every input field, button, state change and navigation point, from the viewpoints the user asked for (all viewpoints if none was given). Leave out a case whose content is the same as an existing TC, and name the tc_id it duplicates. Derive more cases around elements where an earlier run failed or a `불일치` was recorded. Use the values in `testdata.md` and the answers in `확인 사항` as input data and expected results. If an expected result is unclear, follow ui-auto-evidence "2. Basics" (asking).
7. For every case write: tc_id, 제목 (written noun phrase, ≤ 20 characters, for example `신규 요구사항 추가`), 목적, 전제조건, 절차, 입력 데이터, 기대 결과, 도출 근거 (the screen element it comes from).
8. Add each case to the `테스트 케이스` table of the page doc with 상태 `미수행` and 스크립트 상태 `없음`, and write its `TC 상세` block with the fields of step 7. Do not perform them.
8b. If reaching or reading the page took several attempts (a crashing menu, a hidden element, an unusual login), write a block in `lessons-learned.md` as ui-auto-evidence "7. Lessons learned" says (`[교훈 기록]`). When a move fails twice, read the matching block before the third try (`[교훈 조회]`).
9. Call `browser_close`. The derivation needs no more browser calls. Then do procedure D (record and merge) for the page doc and for the system map (new pages and edges, 흐름도, and the block of the page in `## 페이지 설명`), then procedure F (integrity check). Save the run log to `.litecode/ui-auto/logs/<run_id>.md`. Log: `[증적 갱신]`.
10. Report the derived cases as a table with the columns of step 7, list the duplicates you left out, print the summary table of ui-auto-evidence "Work log", and ask the user which TCs to perform.
11. When the user chooses TCs, load the `ui-auto-run` skill and perform the chosen TCs one at a time, in tc_id order, each as its own run. ui-auto-run sets each TC row to `성공`, `실패` or `차단`.

## Outputs

- A table of derived test cases.
- Page doc with updated `화면 요소` and new `미수행` rows. Run log.

## Done when

- The new TCs are in the page doc with 상태 `미수행`.
- The user was asked which TCs to perform.
- The browser is closed.

## Do not

- Do not derive a case from an element you did not see on the screen.
- Do not perform the derived cases inside this skill. Performing is the job of ui-auto-run, after the user chose.
- Do not invent test data.
- Do not add a case that duplicates an existing TC.
- Do not explore a part of the route that the system map already has.
