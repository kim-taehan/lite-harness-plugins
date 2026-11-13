---
name: ui-auto-ask
description: UI-AUTO — answer questions from the recorded evidence in .litecode/ui-auto/ only, without opening the browser. Use for requests like '어떻게 들어가', '경로 알려줘', '지난 테스트 결과', '어떤 화면이 있어', '이력 알려줘', '어떤 TC가 있어', '화면 구조 알려줘'.
---

# ui-auto-ask

Keep written text short, complete in its core and easy to read (ui-auto-evidence "1. Brevity"). Never shorten the work: do every step, call, capture and check.

Output language: write everything the user sees (answers, log lines) in Korean. Print log tags, table column names and status values exactly as written.

Terms: evidence = 증적 (everything under `.litecode/ui-auto/`), system map = `.litecode/ui-auto/system_map.md`, page doc = 페이지 문서 (`.litecode/ui-auto/pages/<page_id>.md`), edge = 이동 관계 (a row of the system map), navigation script = 이동 스크립트 (`.litecode/ui-auto/scripts/routes/<edge_id>.yaml`), script = 스크립트 (`.litecode/ui-auto/scripts/<page_id>/<tc_id>.yaml`, a list of Playwright MCP tool calls).

## Purpose

Answer questions about routes, past runs and screen structure quickly, using only what earlier tests recorded.

## When to use

- The user asks about a route, a past result, the history, the list of screens or TCs, or the structure of a screen.
- The user does not ask to perform anything on a screen.

## Inputs

- A question in natural language. If there is no question, ask the user what they want to know.

## Procedure

Print the log line named in each step right after the step.

1. Print `[skill] ui-auto-ask 로드 — <이유>`. The reason says how this skill was chosen, for example `/ui-auto-ask 로 지정됨` or `요청이 증적 질의에 해당함`.
2. Load the `ui-auto-evidence` skill with the skill tool. Print `[skill] ui-auto-evidence 로드 — 증적 조회 규칙 적용`. Then call the `begin` tool with kind `query` and print `[tool] begin(query) — run_id <run_id>, base URL <URL>`.
3. Do not open the browser. Read only files inside `.litecode/ui-auto/`.
4. Read the place that fits the question, and print `[증적 조회] <파일 경로> — <찾은 내용 요약 | 해당 없음>` after every read:
   - Route, screen structure, list of screens: the system map. Build the route with procedure B of ui-auto-evidence and print `[경로]`. For a question about the flow between screens, also show the part of the `## 흐름도` diagram that answers it.
   - Screen elements, TC list, TC details (`TC 상세`), answers the user gave before (`확인 사항`), latest results: the page doc. For a question about the whole system, read the system map and only the `요약` of the page docs.
   - Exact steps and input values of a TC: the script.
   - The result of a certain run, with its captures: the report `.litecode/ui-auto/reports/<run_id>.md`. Give its path so the user can open it.
   - What happened at a certain time: the run logs in `.litecode/ui-auto/logs/`, and `.litecode/ui-auto/pages/history/` for old runs.
5. Answer. Put the path of the evidence file behind every statement, for example `(근거: .litecode/ui-auto/system_map.md)`. For a route, name the edge_ids.
6. If the `최근 확인일` of what you used is older than the freshness limit of `begin`, say that it is `오래된 정보`.
7. If the evidence does not have the answer, say that it is not recorded, and suggest which test would find it out. If the question is about server-side logic, say that evidence only holds what was observed on screen.
8. Save the log lines of this task to `.litecode/ui-auto/logs/<run_id>.md` and print the summary table of ui-auto-evidence "Work log". Do not change any other evidence file.

## Outputs

- An answer in Korean in which every statement has its evidence file path.

## Done when

- The question is answered from evidence, or the user was told that the evidence does not have it.

## Do not

- Do not open the browser or call any browser tool.
- Do not fill gaps with general knowledge or guesses.
- Do not change evidence files other than the run log.
