---
name: ui-auto
description: UI-AUTO entry — open the UI-AUTO panel and show the target pages for running or deriving tests, from the evidence in .litecode/ui-auto/. Use for '/ui-auto', 'UI-AUTO 열어줘', '테스트 대상 페이지 보여줘', '증적 현황', '어떤 화면을 테스트할 수 있어'.
---

# ui-auto

Keep written text short, complete in its core and easy to read (ui-auto-evidence "1. Brevity"). Never shorten the work: do every step, call, capture and check.

Output language: Korean. Print log tags exactly as written.

## Purpose

Open the UI-AUTO panel (page list, flow map, TC lists, evidence reports) and give the user a short, exact picture of what can be tested or derived next. Nothing is performed here.

## Procedure

1. Print `[skill] ui-auto 로드 — <이유>` (for example `/ui-auto 로 지정됨`).
2. Call the tool `ui-auto_panel`. Print `[tool] ui-auto_panel() — <결과>`. If it says the panel could not be opened, tell the user how to open it and go on.
3. Load the `ui-auto-evidence` skill with the skill tool. Print `[skill] ui-auto-evidence 로드 — 증적 조회 규칙 적용`. Call `begin` with kind `query` and print its `[tool]` line.
4. Read `.litecode/ui-auto/system_map.md` and the `테스트 케이스` table of every page doc. Print one `[증적 조회]` line per file. Do not open the browser.
5. Answer with one table, one row per page of `## 페이지 목록`: 페이지(화면명, page_id) · TC 수 · 성공 · 실패 · 차단 · 미수행 · 최근 확인일 (`오래된 정보` when older than the freshness limit). Count only what the TC tables say.
6. Below the table, list what can be done next, each with its slash command:
   - pages with `미수행` TCs that have a script: `/ui-auto-run <tc_id>` (or [▶ 수행] in the panel);
   - pages with no TC: `/ui-auto-tc <page>`;
   - failed or blocked TCs: `/ui-auto-run <tc_id>` to look at them again.
   If the evidence folder is empty, say so and suggest `/ui-auto-tc <대상 화면 이름 또는 URL>`.
7. Save the log lines to `.litecode/ui-auto/logs/<run_id>.md` (ui-auto-evidence "Run log" in "8. File formats", 대상 `질의`, 결과 `답변`).

## Do not

- Do not open the browser or run any test.
- Do not count or guess anything the evidence files do not say.
