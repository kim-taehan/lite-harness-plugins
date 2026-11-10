---
name: ui-test
description: Create and maintain UI test scenarios for a web screen with the ui-test MCP tools — read the screen (and its server code), draft scenarios, save the ones the user picks together with generated Playwright code (`.spec.mjs`), enrich or change saved scenarios, and refresh stale or changed code. Use for "가입설계 화면 테스트 구성해 줘", "aa.html 테스트 자동화해 줘", "시나리오 보강해 줘", "3 번 시나리오 이렇게 바꿔 줘", "set up / write / automate UI tests for this page", the panel's [보강] and [변경 요청], or "프롬프트 다시 만들어 줘". Do NOT use it to run scenarios, fix a failing run or read earlier results — that is the `ui-test-run` skill (this skill hands the run over to it).
---

# UI tests (beta)

You turn a screen into **scenarios** the user picked, generate one test file per scenario, and keep the scenarios healthy (stale code, changed source code, enrichment, change requests). Running them in the PC's own Chrome/Edge, solving failures and the run history are the **`ui-test-run`** skill. The **scenario is the only unit** — there are no suites or folders to name. Scenarios are the source of truth; generated code is derived from them. Screens and requests are only **tags** the scenarios carry (see Where things live).

Answer only in the user's language (Korean for a Korean request). File names, code and selectors stay as they are.

## First: the tools must be there

In this conversation the plugin's tools are named **`litecode_ui-test_list`**, **`litecode_ui-test_newRequest`** and **`litecode_ui-test_fingerprint`** (used here; below: `list`, `newRequest`, `fingerprint`) and **`litecode_ui-test_run`**, **`litecode_ui-test_report`**, **`litecode_ui-test_guide`** (used by `ui-test-run`). Deleting, the progress display and the other panel tools are not yours.

**If these tools are not available to you, stop immediately** and tell the user exactly this, then do nothing else:
"UI 테스트 도구가 이 대화에 붙지 않았습니다 — 설정 › 기능 › 플러그인에서 UI 테스트가 이 프로젝트에 켜져 있는지 확인해 주세요."
- Never search the app installation, `app.asar`, app data folders, config files or stored secrets to find out how the plugin is wired.
- Never try to reach the plugin server another way (running its files, spawning processes, calling ports).
- Never write or run tests by hand as a workaround.

## Project prompt (`_prompt.md`)

How this project is tested (front-end stack, back-end language/framework, where screen and server sources are and how to find them, login lines, selector conventions, what to skip) is written down once in `.litecode/plugins/ui-test/_prompt.md` (the plugin folder, next to `scenarios/` — not inside it), so you don't re-detect it or re-explore on every request. Format: `references/prompt-format.md` (read it before writing the file).

- **Missing** (check right after the first `list`): survey the project once — front end, back end (in this project and in each back-end code folder), login form, a few real screens for selector conventions, DB tool — ask with the question tool only what the files can't answer, write the file, and say so in one line ("이 프로젝트의 UI 테스트 방식을 .litecode/plugins/ui-test/_prompt.md 에 적어 두었습니다"). Then continue with the request.
- **Present**: read it and **follow it — don't redo what it already answers**. Check once that the folders/files it names still exist (one listing). A path gone is a mismatch (below).
- **Mismatch**: if a line proves wrong while you work (a path or search pattern that finds nothing, a login selector that changed, a convention that doesn't hold), carry on with what you actually found and note the line. Don't stop for it and never edit the file silently.
  At the end of the turn, after the summary, ask **once** with the question tool, `multiple: true`: "_prompt.md 의 이 줄들이 실제와 달라 보입니다 — 고칠까요?" — options are the lines as "옛 내용 → 새 내용". Apply only the picked ones and set `updated:` to today. No answer or none picked → leave the file as it is.
  Only facts that change results count (paths, search patterns, selectors, login lines) — not wording.
- The user asking "프롬프트 다시 만들어 줘" → survey everything again and rewrite it (show what changed).
- Never put passwords in it.

Read `references/formats.md` (scenario head and file names, `## 데이터`, `sources:` and `## 테스트 방법` formats) and `references/step-api.md` (how to write the `.spec.mjs` files) with the file **read** tool before you write any file. They are in this skill's folder.

## Where things live

Call `list` first. Its first line tells you the **scenario folder** (always `.litecode/plugins/ui-test/scenarios/`, not configurable), the report folder (`.litecode/plugins/ui-test/reports/`), the target address, the browser, the test account id and the **back-end code folders** (`백엔드 코드:` — absolute paths set by the user when the server code lives outside this project, or `(프로젝트 안만)`). Then every scenario: id, title, the screens it ran on (**화면**), the chat request that made it (**요청**), its **fingerprint** (`지문 …`), whether its code is **코드 낡음** (stale), whether its source files are **코드 바뀜** (changed) and its last real result; then the groups by screen and by request. `list` first re-reads the scenario files, so files you just wrote show up. Everything you write goes in the scenario folder of the current project:

```
<scenario folder>/<request id>-01.md          scenario (+ ## 데이터, ## 테스트 방법)
<scenario folder>/<request id>-01.spec.mjs    generated code, same stem, right next to its scenario
<scenario folder>/<request id>-01.history.md   run history — written by the `ui-test-run` skill, not by you here; deleting the scenario in the panel deletes it too
```

New scenarios go **directly in the scenario folder**, with an ASCII name `<request id>-<number>` (the id comes from `newRequest`, numbers start at 01); the title lives inside the file (`name:`). No sub-folders. Write these with your normal file tools. Deleting or renaming a scenario file by hand is fine too: the next `list`/`run` fixes the records. Never write passwords anywhere — the account password lives in the plugin settings and reaches the code as `account.password` at run time. If the target address is "(설정 안 됨)", ask the user to fill it in (설정 › 기능 › 플러그인 › UI 테스트 › [고치기], values are per project).

**Tags.** A scenario carries two kinds of tag; there are no free tags.
- **요청 (request)**: the chat request that made the scenario — written by you in the head (`request:`, `requested:`, from `newRequest`) and never changed afterwards, even when you edit the scenario later.
- **화면 (screen)**: decided by the run — the address (route pattern; numbers and long ids become `:id`) the scenario's **`확인:` steps** ran on. A step that only passes through a screen (the login you repeat in every scenario) gives it no tag **unless you put a `확인:` line there** — so keep `확인:` lines on the screen under test and write pass-through steps as plain actions ("로그인한다", not "확인: 로그인됨"). Until a scenario has run once, its screens are what you wrote in the head `screens: [/admin/menu]` (route patterns of the screen under test, from the router/controller you read); give readable names with `screen-names: {/admin/menu: 메뉴 관리}`.

The panel groups scenarios by these tags, so a second request for the same screen simply adds scenarios to the same screen group — **never ask whether to add to existing ones or make new ones**.

## New scenarios: from a screen to results

1. **Read the screen**, using the places and search patterns in `_prompt.md`. The front-end source is required: the HTML/JSP/JS/screen definition the user pointed at, plus the scripts it loads. Pull out validation rules (required, regex, length, ranges), messages, what happens after save, and selectors (label text, role, id, name, data-*). Optional, when available — use them, don't ask for them:
   - the back-end code behind the screen (controller/service): business rules only the server enforces (age limits, product conditions, combinations, formulas), error codes and messages → precise "확인:" lines. Look in this project, and in each back-end code folder `list` shows (search there by the screen's URL/API path or form names). Reading outside the project may ask the user for permission once — that is expected;
   - a DB query MCP tool if one is enabled in this conversation (e.g. SQL 튜닝's `query`): find usable test data, and write "확인(DB):" lines. If no DB tool is available, write no "확인(DB):" lines and say so in one line: "DB 조회 도구가 없어 확인(DB) 줄은 만들지 않았습니다 — SQL 튜닝을 이 프로젝트에 켜면 같이 씁니다".
   - If the address is reachable and an in-app browser is available, you may look at the live page to confirm selectors.
   Say in one line what you read (files, DB lookups).
2. **Draft 1..n scenarios in the chat — do not save yet.** Cover normal flow, missing required values, format errors, boundaries, business rules, permissions and error flows as the code justifies. Show a numbered list; for each: title · kind (정상 · 검증 · 업무 규칙 · 권한 · 예외) · numbered steps · "확인:" lines. A boundary family (age 69 · 70 · 71) can be one scenario with a `## 데이터` table.
3. **Ask with the question tool**, one question, `multiple: true`: "어느 시나리오를 저장할까요?" — options are the scenario titles ("1. 정상 가입설계" …). Pre-select every option if the tool lets you set defaults; otherwise add "아무것도 고르지 않고 보내면 전부 저장합니다" to the question and treat an empty answer as all. Keep the free-text field: the user writes edits there ("4 번에 70세 경계값도 넣어 줘").
   - If the answer has change requests ("1, 3, 5 는 합쳐서 하나로" · "2 번은 시나리오 조금 더 보강해 줘" · "5 번은 이런 방향으로 진행하면 어떨까?"), handle them as in **Change requests** below, show the whole numbered list again (numbers are renumbered after a merge or split) and ask once more the same way.
   - Save only the picked ones.
4. **Save**: call `newRequest { text: <the user's request as asked> }` once — it returns the request id, the file names and the two head lines (`request:`, `requested:`). Write one md per picked scenario as `<scenario folder>/<request id>-01.md`, `-02.md` … in the chosen order, each with those two head lines. Don't invent a name for a group, don't write any index file, and don't ask where to put them.
   - **sources**: call `fingerprint { files: [<the screen and server files you read — project-relative, or absolute for files in a back-end code folder>] }` and put the returned `sources: [...]` line into each scenario's front matter (the files that scenario depends on).
   - **screens**: add `screens: [<route pattern of the screen under test>]` (and `screen-names:` when the screen has a natural name) to each head — a first guess; the run replaces it with what the `확인:` steps actually saw.
5. **Generate code**: one `<same stem>.spec.mjs` per scenario, following `references/step-api.md` — one `step()` per numbered scenario line, title copied exactly ("1. 로그인한다"), header comment with source file and the **fingerprint `list` shows for that scenario** (call `list` again after saving the md).
6. **Stop here — do not run yet.** New scenarios are never run in the same turn they were written. Say in a short summary what was saved (scenario count, code written) and ask once: "바로 실행할까요? 고칠 시나리오가 있으면 번호와 함께 말씀해 주세요".
   - **Yes** → step 7. **Run later from the panel's [▶ 실행]** → stop here.
   - **A change** ("3 번에 70세 경계값 추가", "2, 4 합쳐 줘") → handle it as in **Change requests** on the saved files (md first, then regenerate the `.spec.mjs` and refresh the fingerprint), show what changed, and ask again — still without running.
   - **Skip this stop** only when the user's request already said to run ("만들어서 바로 실행해 줘").
7. **Run:** load the **`ui-test-run`** skill with the skill tool and follow it (see **Running** below).
8. **Write `## 테스트 방법`** for every scenario that passed its first run and has none yet (or whose way of testing changed in this round) — from the per-step "쓴 것" (selectors/waits/checks) and durations in the run result. Format in `references/formats.md`. No passwords; mask personal-looking data.

## Keeping it healthy

- **코드 낡음** (in `list`, the panel, or a warning at the top of a `run` result): the scenario md changed after its code was generated. Before running it, read the scenario (steps, `## 데이터`), its `## 테스트 방법` and `## 시행착오`, and the `.spec.mjs`, then decide what actually changed:
  - **Only `## 데이터` values** (the steps, "확인:" lines and head are the same as the spec's `step()` titles, and every column the spec reads as `data.<column>` still exists): the logic is unchanged — **don't regenerate**. Just write the new fingerprint from `list` into the header and run. Adding or removing a row needs no code change either.
  - **Steps, "확인:" lines, columns the code uses, or the head changed**: regenerate the `.spec.mjs` keeping the selectors/waits that still fit, and write the new fingerprint into the header.
  Never run stale code and trust the result without one of the two.
- **코드 바뀜**: a file in the scenario's `sources:` changed (or is gone). Read the changed file(s) (and `git diff` of them if available), then propose concrete updates to the scenario — expected messages, error codes, new required fields, flow — as an enrichment (below, kind 코드 바뀜). When the user accepted (or there is nothing to change), refresh the `sources:` line with `fingerprint` so the mark goes away. Refreshing `sources:` alone does not make the code stale.

## Change requests (수정 요청)

The user can ask for changes **per scenario by number or title**, in the draft list (step 3) and for saved scenarios later ("3 번 시나리오 이렇게 바꿔 줘", the panel's [AI 에게 맡기기]/[보강] message). One message may hold several requests — handle each against the numbers the user saw. Kinds:
- **합치기** ("1, 3, 5 는 합쳐서 하나로"): one scenario whose steps are the merged flows in order — shared steps (login, opening the screen) once, each "확인:" line kept, a `## 데이터` table if the merged cases differ only by values. Say which steps were merged or dropped as duplicates.
- **보강** ("2 번은 조금 더 보강해 줘"): add missing checks, boundaries, data rows or error paths for that scenario only, justified by the code you read (and `_prompt.md`). Show what was added.
- **방향 변경** ("5 번은 이런이런 방향으로 하면 어떨까?"): the user proposes an approach — a question, not an order. Say in one or two lines whether it fits the code (if it doesn't, say why and what you'd do instead), then show the changed scenario as the proposal.
- **쪼개기 · 삭제 · 순서 · 제목** — as asked. Dropping a scenario from a draft needs no confirmation.

Deleting scenarios, a screen group or a request group is done by the panel's **[삭제]** (the plugin removes the files, records, screenshots and report sections itself, after a confirmation) — you have no tool for it; when the user asks you in chat to delete or merge saved scenarios, use the rules below (list the files, get the OK first) — the next `list`/`run` clears the records of a file you removed.

The panel's **[변경 요청]** opens a new conversation with the scenario (id, file) already filled in and a last line `변경 내용:` — the text the user adds after it is the request. Read that scenario file first, then handle it as below. Never run anything because of a change request; after the change is applied and the code regenerated, ask whether to run it.

Rules:
- **Draft** (not saved yet): apply the changes to the draft list, then show it again. Nothing is written until the user picks what to save.
- **Saved scenarios**: show the before/after of the scenario first and ask once with the question tool ("이렇게 바꿀까요?") — never edit saved files first. After a yes: edit the md in place (keep its file name, `request:`, `requested:` and id — the request tag never changes), refresh `sources:` with `fingerprint` if you read new code, and update `screens:` only if the screen under test itself changed. A changed scenario is 코드 낡음 → regenerate its code before running (see Keeping it healthy).
- **Merging or deleting saved scenarios removes files** (the md and its `.spec.mjs`): list the files and get the user's OK in the same question before deleting. Keep the names of the other files as they are — renaming breaks the `source:` header of the code and the scenario's records. A new merged scenario is a new file: call `newRequest` with the merge request and use its id.
- Past reports stay as they are.

## Enrichment (보강)

Triggered by "…시나리오 보강해 줘", the panel's [보강] on a scenario, or a 코드 바뀜 mark. Propose, then let the user pick — never edit first.

1. `list`, then read the scenario(s), the files in `sources:` (and other front/back-end code of the screen), and use a DB tool if one is enabled.
2. Draft proposals of four kinds, each one short and concrete:
   - **빠진 확인** — a step whose "확인:" is weak: add the exact message text, the page it moves to, or a "확인(DB):" line (only if a DB tool is available).
   - **데이터 변형** — the same flow with several values: a `## 데이터` table (boundary values from validation and business rules, with the expected column). Show the table.
   - **변형 시나리오** — a code branch no scenario covers (e.g. a product with a different age limit): a new scenario (title · steps · 확인).
   - **코드 바뀜** — for changed `sources:`: what changed and how the scenario's expectations must follow (old → new message, code).
3. Show them as a numbered list grouped by kind, then ask with the question tool, `multiple: true`: "어느 보강을 반영할까요?" — options are the proposals ("1. [데이터 변형] 나이 경계값 69 · 70 · 71" …). Treat an empty answer as none (ask nothing else). Keep the free-text field for edits.
4. Apply **only the picked ones**: changes to existing scenarios go into their md files in place; each new scenario is a new file named with a fresh `newRequest` id (request text: the user's enrichment request) and gets `screens:` like any new scenario. Refresh `sources:` with `fingerprint` where you handled a 코드 바뀜.
5. Every changed scenario is now 코드 낡음 — regenerate its code (see "Keeping it healthy") before the next run, and offer to run it.

## Running

- **When**: right after saving new scenarios, ask once (step 6). When the user asks to run — the panel's [▶ 실행] request (`/ui-test-run …`), "어제 가입설계 테스트 다시 실행해 줘", "실패한 것만 다시" — run **without asking**.
- **How**: load the **`ui-test-run`** skill with the skill tool and follow it — don't call `litecode_ui-test_run` first. It holds the steps, solving failures, the per-scenario run history (`<id>.history.md`), the summary and the 가이드; none of that is repeated here.
- **The `litecode_ui-test_run` tool in short**: `scenarios: ["<id>", …]` (also `screen`, `request`, `failed: true`), `headed: true` only to watch; reports are always written per scenario; the result is read with `litecode_ui-test_report { run }`.
- **After a result**: a failure → `ui-test-run`'s problem solving. 코드 낡음 or 코드 바뀜 → regenerate or enrich here ("Keeping it healthy", "Enrichment").

## Rules for the code

- Selectors — the conventions in `_prompt.md` win; otherwise in this order: label text (`getByLabel`), role + accessible name (`getByRole('button', { name: '저장' })`), visible text for messages (`getByText`), then `#id`, `[name=…]`, `[data-*=…]`. No XPath, no nth-child, no generated class names.
- Waiting: wait for a signal, never sleep — a message to appear (`expect(...).toBeVisible()`), a URL (`page.waitForURL`), a response (`page.waitForResponse`), an element state. No `waitForTimeout`. **Wait and action go together**: `await Promise.all([page.waitForResponse(…), page.goto(…)])` — never keep a wait promise in a variable and await it later (a failing step in between leaves it dangling and it can kill the run).
- Accounts: `account.user` / `account.password` from settings. A scenario's `account:` names which account it means; only one account exists for now.
- Each scenario (and each data row) starts from a fresh browser context — log in inside the case when it needs a login.
- Data tables: read the row from `data.<column>` (e.g. `data.나이`, `data.기대`) and branch on the expected column where the outcome differs; one spec serves every row.
