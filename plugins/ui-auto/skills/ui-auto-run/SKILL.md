---
name: ui-auto-run
description: UI-AUTO — run or re-run a UI test on a target page with the UI-AUTO browser tools or a saved script, and record evidence under .litecode/ui-auto/. Use for requests like '테스트 해줘', '테스트 수행', '확인해줘', '다시 돌려줘', '재수행', '회귀 테스트', '다른 데이터로 테스트', and when a saved test script fails and must be repaired.
---

# ui-auto-run

Keep written text short, complete in its core and easy to read (ui-auto-evidence "1. Brevity"). Never shorten the work: do every step, call, capture and check.

Output language: write everything the user sees (answers, log lines) and everything you record under `.litecode/ui-auto/` in Korean. Print log tags, table column names and status values exactly as written.

Terms: evidence = 증적 (everything under `.litecode/ui-auto/`), system map = `.litecode/ui-auto/system_map.md`, page doc = 페이지 문서 (`.litecode/ui-auto/pages/<page_id>.md`), edge = 이동 관계 (a row of the system map), navigation script = 이동 스크립트 (`.litecode/ui-auto/scripts/routes/<edge_id>.yaml`), script = 스크립트 (`.litecode/ui-auto/scripts/<page_id>/<tc_id>.yaml`, a list of Playwright MCP tool calls).

## Purpose

Perform one test case on a target page, give a verdict, and leave evidence so that the next run needs less exploring and less work from you.

## When to use

- The user asks to perform, check, repeat or regress something on a screen.
- The user asks to run an existing TC again, with the same or with other data.
- A saved script failed.

## Inputs

- Target page: a name, a URL or a page_id.
- What to test, or a tc_id.
- Optional: test data and expected result.
- Base URL of the system, if the user gave one. Otherwise the `base URL` of `begin`. The test opens the system by URL in the browser.
- Login is done by the `login` tool with the account of the plugin settings. Test input values come from `.litecode/ui-auto/testdata.md`. Rules: ui-auto-evidence "6. Data, login, browser, captures".

If the target page or the test content is missing, ask the user once before you do anything else.

## Procedure

Print the log line named in each step right after the step.

1. Print `[skill] ui-auto-run 로드 — <이유>`. The reason says how this skill was chosen, for example `/ui-auto-run 으로 지정됨` or `요청이 테스트 수행에 해당함`.
2. Load the `ui-auto-evidence` skill with the skill tool. Print `[skill] ui-auto-evidence 로드 — 증적 조회 규칙 적용`. Then call the `begin` tool with kind `run` and print `[tool] begin(run) — run_id <run_id>, base URL <URL>`. Then do its procedure A (lookup) and procedure B (route). Decide the page_id with procedure C. Logs: `[증적 조회]`, `[경로]`.
3. Compare the request with the `테스트 케이스` table of the page doc. If the same TC exists, use its tc_id and read its `TC 상세` block. If not, give the next tc_id. The run_id is the one of `begin`. Get the input values as ui-auto-evidence "6. Data, login, browser, captures" says.
4. Choose the highest utilization level of ui-auto-evidence whose condition is met, and print `[활용 단계]` and `[증적 활용]`.
   - 1단계: a script exists for the TC. Replay it as ui-auto-evidence "Script" says ("TC script" replay): entry URL, the navigation scripts of the route, then the TC script, calling the listed tools in the listed order. Do not take snapshots and do not look for elements. If the request only changes the data, replay with the user's values and do not edit the script. If the new expected value was not given, ask first. Log: `[스크립트] ... — 실행 — <결과>`. If it passes, go to step 8. If it fails, go to step 9.
   - 2단계: no script, but every edge of the route has a navigation script. Replay the navigation scripts to reach the target page. Use snapshots and choose elements only on the target page.
   - 3단계: an edge has no navigation script, but the system map has the route. Do each such move with MCP tools exactly as its edge row says. Do not explore.
   - 4단계: no route, or only a part of it. Use the recorded part, and explore the missing part with MCP tools.
   - If a move from the map fails in level 2 or 3, follow procedure E of ui-auto-evidence.
   - Print `[tool] <tool 이름>(<핵심 인자>) — <받은 결과 요약>` after every browser tool call.
5. When you arrive at the target page, take the page capture if ui-auto-evidence "6. Data, login, browser, captures" says so. Then perform the test, and take a step capture after every step and of the verdict screen, as ui-auto-evidence "6. Data, login, browser, captures" says. The number of captures follows the number of steps. It is never fixed. Whenever something is unclear, follow ui-auto-evidence "2. Basics" (asking): check `확인 사항` first, otherwise ask, wait, and apply the answer. Take a capture of the screen that justifies the verdict, saved under `.litecode/ui-auto/captures/<page_id>/`. Decide `성공`, `실패` or `차단` by comparing the actual result with the expected result.
6. If you worked at level 2, 3 or 4, add what is missing, in this order:
   1. A navigation script for every edge you passed that has none. Rules: ui-auto-evidence, "Navigation script".
   2. The script for this TC, written from the tool calls that worked. Rules: ui-auto-evidence, "TC script".
7. Verify the new script with one replay as ui-auto-evidence "TC script" says. If the TC creates, changes or deletes data, ask the user before that replay. Set `검증됨` only after you saw a replay pass. Otherwise it stays `미검증`. Log: `[스크립트] ... — 생성 — <결과>`.
8. Do procedure D (record and merge) of ui-auto-evidence. Write `changes_data` and an `expect` for every verify item into a new or changed script. Update: system map, page doc (TC table row with the new 상태 and 최근 수행일, `TC 상세`, `확인 사항` rows for the answers you got, the block of the page in `## 페이지 설명` of the system map, and a `수행 이력` entry with 수행 방식, 입력 데이터, 기대 결과, 실제 결과, 캡처, 연관 페이지, 로그, 보고서), the report `.litecode/ui-auto/reports/<run_id>.md` with the captures as images, then (only when the verdict is `성공`) the `guide` tool for this tc_id, and the run log. Add `- 제목:` to `TC 상세` when it is missing. Logs: `[증적 갱신]`, then `[판정] <tc_id> — <성공|실패|차단> — <근거>`.
9. If a script replay failed (in step 4 or in step 7), follow procedure E of ui-auto-evidence: look at the real screen with the MCP tools, decide between 화면 변경, 실제 결함 and 차단, and act as procedure E says. Log: `[불일치]`. Write what you repaired as `- 자가 복구:` and what you dug out as `- 원인 추적:` in the `수행 이력` entry. Then continue with step 8.
   - Whenever the same action fails twice anywhere in this task, read the matching block of `lessons-learned.md` before the third try (`[교훈 조회]`).
   - If the run needed several attempts to get through, write a block in `lessons-learned.md` as ui-auto-evidence "7. Lessons learned" says (`[교훈 기록]`).
10. Call `browser_close` if this task opened the browser. No browser tool call comes after it. Then do procedure F (integrity check) of ui-auto-evidence. Save the run log to `.litecode/ui-auto/logs/<run_id>.md`.
11. Report the result briefly and print the summary table of ui-auto-evidence "Work log": 참고한 증적 / 새로 만든 증적 / 갱신한 증적 / 증적 덕분에 생략한 작업.

## Outputs

- A verdict for the TC.
- Updated system map (tables, 흐름도, 페이지 설명), page doc, script, navigation scripts, captures and run log.
- The report `.litecode/ui-auto/reports/<run_id>.md`.

## Done when

- The verdict is recorded.
- The TC row in the page doc shows `성공`, `실패` or `차단` (these mean the TC is done) with today's date, and `수행 이력` has the new entry.
- Every test step on the target page has its step capture, and the report shows all of them.
- The run log file is saved.
- The browser is closed.

## Do not

- Do not repeat a test by exploring the screen when a script exists. Replay the script.
- Do not write a script as source code. A script is a list of Playwright MCP tool calls.
- Do not record a script as `검증됨` unless you saw it pass.
- Do not record account data as input data, and do not type a user name or password into the browser.
- Do not guess when something is unclear, and do not invent test data. Ask the user.
- Do not explore a part of the route that the system map already has.
- Do not capture a page other than the target page.
- Do not leave the browser open when the task ends.
- Do not skip or limit the step captures on the target page.
- Do not call a browser tool before steps 1 to 4 are done.
- Do not change a script to make it pass when the system really behaves wrongly.
