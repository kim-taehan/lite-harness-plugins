---
name: ui-test-run
description: Run saved UI test scenarios with the ui-test MCP tools, solve what goes wrong while running, and keep a run history per scenario. Use when the request starts with "/ui-test-run" (the panel's [▶ 실행]), when the user says yes to "바로 실행할까요?" right after scenarios were saved, when they ask to run saved scenarios — "어제 가입설계 테스트 다시 실행해 줘", "실패한 것만 다시", "run the login tests again" — to fix a failing scenario ("AI 에게 맡기기"), or to read an earlier result or report ("어제 테스트 결과 알려 줘"). Do NOT use it to create, enrich or change scenarios or their generated code from scratch — that is the `ui-test` skill (it hands the run over to this one).
---

# Running UI test scenarios

Tools (exact names): `litecode_ui-test_list`, `litecode_ui-test_run`, `litecode_ui-test_report`, `litecode_ui-test_guide`. Answer in the user's language (Korean for a Korean request); file names, code and selectors stay as they are.

**If these tools are not available, stop** and say exactly: "UI 테스트 도구가 이 대화에 붙지 않았습니다 — 설정 › 기능 › 플러그인에서 UI 테스트가 이 프로젝트에 켜져 있는지 확인해 주세요." Do nothing else — never search the app installation, never start the plugin server another way, never run tests by hand.

## When to ask, when to go

- **Go straight through, ask nothing** about what to run or how to split reports: a request starting `/ui-test-run 아래 시나리오를 실행하고 결과를 알려 주세요.` (it lists, per scenario, its id and three paths — scenario md, generated code `.spec.mjs`, run history `.history.md`, marked "(아직 없음)" when missing) or a yes to "바로 실행할까요?". For a plain "run it (again)" request find the scenarios yourself (step 1) and go straight on; ask only when several groups fit.
- **Ask with the question tool, one thing at a time,** only for something a failure cannot be solved without (step 4).
- Never ask whether to combine reports — they are always written per scenario.

## Steps

1. **Read first.** For every scenario to run read its md, its `.spec.mjs` and its `.history.md` (when it exists); read `.litecode/plugins/ui-test/_prompt.md` when the request's line `프로젝트 프롬프트: … (있음)` (or `list`'s `prompt.exists`) says it exists — and say it is missing only when that line says `(없음)`; if the request carries no such line, call `list` and use its `prompt.exists`. Never guess whether a file exists (glob skips the hidden `.litecode` folder). A scenario named loosely ("로그인 테스트") → `list` and match by title, screen or request.
2. **Take the history's `## 다음 수행 때 지킬 것` as this run's instructions.** If an entry already solved the same problem, start with that solution and never ask the user the same question twice. No history file → nothing to follow yet. If `list` shows 코드 낡음 for a scenario, regenerate its code first (`ui-test` skill, "Keeping it healthy") — never trust a run of stale code.
3. **Run:** `run { scenarios: ["<id>", …] }` with the ids from the request. For "again" requests the other selectors work too: `screen` (route or screen name), `request` (a request id), `failed: true` (only those whose last real run failed); several selectors must all match; no selector = every scenario. `headed: true` only when the user wants to watch ("보면서 실행해 줘"). Reports are always written per scenario (there is no `report` argument).
   - `run` waits up to 2 minutes. If it answers "아직 실행 중 … 수행 id …", call `report { run: "<id>" }` until it answers "실행 끝" (each call waits up to 2 minutes). Don't start another run meanwhile.
   - If it says "기록은 남기지 않았습니다(앱 밖 실행)", nothing is compared or listed — tell the user.
4. **When something goes wrong, in this order:**
   1. **Reproduce it yourself** and confirm the cause from the error text, the screenshot and the report. Say a cause only after you confirmed it; never blame a security product or the network unless you verified it. Which of test / app / data / environment it is → `references/failures.md`.
   2. **Solve it another way** — another selector, an added wait condition, another route into the screen, another account or data (self-repair rules and limits are in `references/failures.md`).
   3. **Still not solved → don't guess; ask the user with the question tool, one thing at a time** (account, data, screen condition, expected behaviour). Fix the scenario and generated code from the answer and run that scenario again.
   4. **The user does not answer** (no reply, or "모르겠다") → stop on that scenario, leave it failing, write "못 고침" and the open question into its history, and continue with the other scenarios.
5. **Write the history** for every scenario that ran. Append one entry to its `.history.md` — create the file when it does not exist, with `## 다음 수행 때 지킬 것` as its first section. A pass without any problem is just the first two lines; otherwise add the failed step, error, cause, `해결(다른 방법)` and/or `해결(사용자 답변)` (question and answer, one line each) and the result ("못 고침" and what you tried when unfixed). Then **rewrite `## 다음 수행 때 지킬 것`** from the whole file: summarize, remove what is solved, keep what code cannot do. Shape and rules: `references/history.md`.
6. **Summarize** from the tool result: counts, the comparison with each scenario's last real run (새로 실패 · 고쳐짐 · 그대로 실패; data tables compare per row, "<id> 2행"), each failure with the failed step, error and 갈래, what you did about it, and the report path. Earlier results: `report { run: "<id>" }` or `report { scenario: "<id>" }` (last run of one scenario). Then ask **once**: "가이드로도 만들까요?" — if yes, call `guide { run }` (id from `run`/`report`) and give the path(s); never write the guide yourself. If the panel's 환경 setting is "결과서 + 가이드" the panel already made it — don't call `guide` again unless asked. Offer next steps in one short line: 결과서 열기 · 실패만 다시 · 고치기 · 보강.
7. **Scenarios just written in this conversation:** after a pass, continue with the `ui-test` skill's "Write `## 테스트 방법`" step.

## Also

- "확인(DB):" steps come back as "대화에서만 확인": check each with the DB tool if one is enabled and report it; if not, ask the user to check.
- The result shows "본 화면" per `확인:` step — those become the scenario's screen tags. If a tag looks wrong (a pass-through screen got tagged), tell the user which `확인:` line caused it.
- If the result says the report folder is not in `.gitignore`, ask whether to add it; edit `.gitignore` only if they say yes.
- Never change a scenario's steps, data or "확인:" lines without the user's OK (exceptions are listed in `references/failures.md`). Past reports stay as they are.
