# When a scenario fails — telling the test, the app, the data and the environment apart

Read this when `run`/`report` shows a failure (SKILL.md step 4). The cause is always **confirmed, never guessed**: read the error and the screenshot in the report, reproduce it, then say which of the four it is. Never name a security product, the network or "the app" as the cause unless you verified it.

Each failure carries a **갈래** (a rough guess from the error text): 셀렉터 못 찾음 · 기다림 시간 초과 · 확인 값 다름 · 이동 오류 · 코드 오류. The result prints a hint per 갈래.

## 1. The test is stale (usually 셀렉터 못 찾음 · 기다림 시간 초과 · 코드 오류 — a renamed button, a changed URL, a typo in the spec)

Read the scenario's `## 테스트 방법` and `## 시행착오` first (formats in the `ui-test` skill's `references/formats.md`; don't repeat an approach that already failed), fix the `.spec.mjs` keeping the selectors and waits that still fit, and run **that scenario only** again (`scenarios: ["<id>"]`). Do this on your own, without asking the user (self-repair): **at most 2 fix-and-rerun tries per scenario per round**.
- Passes → keep the fix, say in one line what you changed, record it as `해결(다른 방법)` in the run history, and keep going. Add one `## 시행착오` bullet (symptom → cause → fix, tagged with the step) when the lesson will help next time — none for a typo or a one-off.
- Still fails after the second try → stop and report; it may be the app or the data (below).
- Never self-repair a failure that looks like the app (확인 값 다름 on a 확인 line) or the data. Never change a scenario's steps, data or "확인:" lines without the user's OK — propose and ask (the only exception is an unusable **input value**, section 3).

## 2. The app is probably wrong (usually 확인 값 다름 — the element is there but the value or message differs from the scenario)

Do not change the test. Report a probable app defect with the evidence (step, data row, error, screenshot in the report). If the source code changed on purpose (코드 바뀜 in `list`), propose a scenario change instead (the `ui-test` skill, enrichment kind 코드 바뀜). Check the data first (section 3) before calling it an app defect when the failure comes right after a lookup.

## 3. The data is probably the cause (데이터 막힘)

The record the scenario uses is expired, closed, gone or no longer qualifies — typically 확인 값 다름 or 기다림 시간 초과 right after a lookup, or a screen message like 만료 · 종료 · 조회 결과 없음. Find a usable replacement instead of reporting an app defect. The conditions come from the **back-end code**, never from a guess.

1. **Confirm it is the data.** If a DB query tool is enabled in this conversation, read the record the scenario uses (the key is in `## 데이터` or the "입력 데이터" line of `## 테스트 방법`) — **SELECT only** — and compare its state with what the code requires. No DB tool → say so in one line and go to step 5.
2. **Derive the conditions from the code.** Find the code that decides a record is usable for this screen (use `_prompt.md` "서버 규칙 찾는 법": validators, services, mappers): status codes, expiry or date comparisons, product/channel limits, one-time-use limits. Take table and column names from the entity or mapper SQL. If the rule lives outside the code (procedures, views, batch-updated flags) or you cannot find it, **don't guess** — say what you could not confirm and go to step 5.
3. **Query for candidates**, read-only, a few rows, only the key and the columns you need. Test or development database only — if the connection looks like production, stop and ask the user. Prefer records the code or `_prompt.md` marks as test data; if a record could be used by other people or tests, ask instead of taking it.
4. **Replace when it is clear.** Exactly one fitting candidate and the scenario **passes when re-run** with it (`run { scenarios: ["<id>"] }`) → replace the input value in `## 데이터` (or the step text), refresh the code header's fingerprint with the one `list` shows if only the data changed, and say in one line afterwards what changed (masked). Replace only the input value — never the steps, the "확인:" lines, or an expected column unless the new record changes the expected result, and then say so. At most **two replacement tries per scenario per round**; if it still fails with fresh data, treat it as a real failure (test or app) and report.
5. **Ask when it is not clear** — several candidates, conditions you could not confirm, no DB tool, or no candidate. One question with the question tool: the candidates (masked) as options plus "직접 입력" and "이 시나리오 건너뛰기". Apply the choice and re-run that scenario. A value the user types always wins. Record it as `해결(사용자 답변)`.
6. **Record it** so the next time is faster: in `## 테스트 방법` write the 입력 데이터 line with the **conditions**, their **source** (file and line) and the **SELECT** you used (no personal data; mask keys like 900101-1******); add that code file to `sources:` (get the line from `fingerprint { files }`) so a later change of the rule shows as 코드 바뀜 and the conditions are derived again; add a `## 시행착오` bullet (`증권번호 P123 만료 → P456 · 조건: …`). Next time the same data is blocked, start from those recorded conditions and re-check them against the code only if the file shows 코드 바뀜.

## 4. The environment (이동 오류)

The target server is down or the address is wrong (`list` shows the address; the settings hold it) — tell the user; there is nothing to fix in the scenario. If a browser-level error (for example `net::ERR_*`) is the failure, say what you observed and what you checked yourself (for example the same address opened another way) — don't guess a cause.

## After a failure that revealed an untested case

Offer once: "이 경우도 시나리오로 남길까요?" (→ the `ui-test` skill's enrichment).
