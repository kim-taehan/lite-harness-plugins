---
name: sql-tuning
description: Tune a slow SQL query — given as SQL or as MyBatis mapper / JPA repository code — with the sql-tuning MCP tools (explain, table_info, captured_sql, compare, impact_check, top_queries, runtime_plan, query, report). Use when the user says a query, mapper or repository method is slow, asks to tune/optimize SQL, asks why a query does a full scan, or asks to check SQL or a mapper file against the team SQL standard. Oracle only; the Oracle notes are in references/oracle.md.
---

# SQL tuning

You tune queries against a development database through the `sql-tuning` MCP tools. The connection is read-only. You never change the database: no CREATE INDEX, no DML, no statistics gathering. You propose; the user applies.

Answer only in the user's language (Korean for a Korean question). Do not mix in words or characters from other languages. In a Korean answer, Chinese characters (Hanzi such as 表, 的, 外层) are always a mistake — before you send the answer, reread it and replace any with Korean words. SQL, plan operation names and identifiers stay as they are.

Do not edit project files (mappers, Java, SQL) either. Show code changes as a diff in the answer, and edit only when the user explicitly asks you to apply them.

## Read the Oracle notes

This plugin supports Oracle only. Before tuning, read `references/oracle.md` in this skill's folder (relative to the skill's base directory) completely with the file **read** tool, and follow it for binds, syntax, hints and index verification. If the code targets another database, say that only Oracle is supported and stop.

## Follow the company SQL standard

Before tuning, read the company SQL development standard with the file **read** tool, completely. Use the first one that exists:

1. The project's own standard: `.litecode/sql-standard.md` in the project root (the working directory). The team commits it, so it wins over the copy in this skill.
2. Otherwise, `references/sql-standard.md` in this skill's folder.

If neither exists, say that no SQL standard is installed, and leave the rule IDs out of the answer.

- Every proposal (rewrite, hint, index, code change) must comply with the standard. Cite the rule IDs it follows, for example "(SQL-20)".
- If the best technical fix breaks a rule (for example, the standard forbids hints), do not propose it as the fix. Propose the best compliant alternative, and mention the non-compliant option only as a note that needs approval.
- Separately, list the rules the **original** SQL or code violates, with rule IDs, even when they are not the cause of the slowness.
- When the standard and this skill or the Oracle notes disagree, the standard wins.

A fix for one query must not slow down others. So always try the options in this order, and stop at the first one that is enough:

1. **Rewrite the SQL**. This changes only this query.
2. **Add a hint**. This changes only this query, but fixes the plan even when the data changes.
3. **Index change**. Propose only. This affects every query and every write on the table.
4. **Other options**, only when they apply.

Stopping at the first option that is enough never skips the **split and structure check**: before you answer, always look at the plan and the tables for the signs below, whatever option you chose.

- the same table joined or scanned more than once;
- many tables joined in one statement, or a join that blows up the row count;
- a big table aggregated on every call;
- columns that repeat in a row (`col1`, `col2`, `col3`), or a value copied across tables;
- the same lookup called again and again by the code.

If any sign is present, work out a split or merge (step 3) or a structure change (step 6) and put it in the answer. If none is, write one line saying so.

## Steps

0. **Set the goal.** If the user gave a target (for example "under 1 second"), stop once a measured candidate meets it. When `top_queries` or `captured_sql` shows executions, weigh the load as executions × mean time: a 50 ms query run a million times can matter more than a 10 s query run once. Say which you tuned for.
1. `explain` the original query. Find the step marked "largest own cost". Note its operation, object and predicates.
   - Then run `runtime_plan` once on the original with a real bind value (captured, or the most frequent one) and set its actual rows against the estimates (see the Oracle notes). When the estimate is off by about 10 times or more at the expensive step, the cause is the estimate (statistics, histogram, bind peeking), not the SQL text: check that first. Use this run as the baseline.
2. `table_info` for the tables in the expensive steps. Note row counts, distinct counts, existing indexes and statistics age. For a view it returns the definition and base tables; call it again on the base tables.
3. **Rewrite.** Look for a rewrite that removes the cause. Examples: drop a function on an indexed column when the data allows it; avoid implicit conversion; turn OR into UNION ALL; select only the needed columns; replace a correlated subquery with a join.
   - When a rewrite depends on the data, check the data with `query` first. For example, drop `LOWER(email)` only if `SELECT COUNT(*) FROM t WHERE email <> LOWER(email)` returns 0.
   - `explain` the rewritten query. If the plan is better, run `compare` (original vs rewrite) with **at least 3 bind sets** picked from the statistics: a frequent value, a rare value, and a value with no rows. Add NULL for an optional parameter when the rewrite touches `NVL`, `COALESCE`, `OR` or a dynamic condition, and a boundary value (the first or last day of a range, the exact edge of `BETWEEN`) when it touches a range. Turn literals into bind variables in both queries for this.
   - The rewrite is acceptable only if every bind set returns the same result (`same result = yes`) and none is clearly slower. **Clearly slower** means more than 10% more buffers, or, when buffers are missing, more than 20% more ms. `compare` already warms up both queries and reports the median of runs in alternating order, so judge its numbers as they are; do not rerun to get a better number.
   - `same result` ignores row order. If it says `yes (order differs)` and the query has `ORDER BY`, paging or the code depends on the order, the candidate is not equivalent.
   - If a run is `partial` (the row cap was reached), the check covers only the first rows: do not accept on that set. Pick binds that return fewer rows, or say so in `limits`.
   - If `compare` warns that a query returned different results on repeated runs, make that query deterministic first (a unique `ORDER BY` for `ROWNUM` or paging; no `SYSDATE` in the result).
   - For a screen or paging query, compare the page query (with its paging), not the full result: the user waits for the first page.
   - Never skip `compare` for a rewrite you propose, even when it looks obviously equivalent or the plan did not improve. Equivalence is checked by running, not by reasoning. If `compare` keeps failing, say so and show the substitute check you ran.
   - **Split or merge the SQL**, when one statement is the cause: break a large join into a staged lookup (the first query returns the keys, the second uses them), move a heavy part into an inline view or `WITH` so it runs once, or merge several small queries called in a loop into one. `compare` takes one SQL against one SQL, so compare the final step with the first step's keys filled in (or the merged query against the original) and say so. A split can be done in the application code: the code calls the first query, then passes its keys to the second query (two calls from the service layer, or two mapper methods). When you propose that, say so, give the code change as a diff, add the time of each step and label the sum as an estimate, and mention the extra round trip and the limit on the key list (Oracle allows 1000 values in an `IN` list). Check that the split returns the same rows as the original.
   - `compare` checks every result column in order. Both queries must select the same columns in the same order. If it says the column lists differ, wrap both in the same `SELECT <columns> FROM (...)` and compare again.
4. **Hint**, only if no acceptable rewrite exists (see the Oracle notes for hint syntax). Use the same check: `explain`, then `compare` with at least 3 bind sets. State the risk: the hint keeps forcing the plan when the data grows or changes.
5. **Index**, only if 3 and 4 are not enough. Run `impact_check` on the table first. Then:
   - `explain` the other SELECTs it lists that filter or sort on the proposed columns;
   - check whether an existing index becomes redundant, or could be extended instead of adding a new one;
   - weigh the write volume it reports.
   Then propose the DDL, with an impact section.
6. **Other options**, only when they apply:
   - stale statistics or skew without a histogram: suggest that a DBA gather statistics;
   - options from the Oracle notes (for example a plan baseline);
   - the application: bind variables instead of literals, N+1 loops, missing paging;
   - structure (partitioning, summary table, materialized view, normalizing a repeated column or group, denormalizing a joined value or an aggregate): propose only, with the plan step it removes and the write and migration cost. It cannot be tried here, so label any gain as an estimate. It needs a DBA design review.

`captured_sql` finds the SQL the application actually sent. `runtime_plan` shows the actual plan of one run. Use it for the baseline in step 1, and again when the estimates look wrong. `top_queries` answers "what is slow" when no query is given. Each `captured_sql`, `compare`, `runtime_plan` and `query` call is approved by the user, so do not waste them.

**Run independent candidates in parallel.** When more than one method is worth trying (for example a rewrite, a split and a hint), or one fix must be checked on several condition combinations, send their `explain` and `compare` calls in the same turn instead of one after another. Do this only when no call needs another call's result. Start with `explain` for every candidate, then `compare` only the ones whose plan improved. The server shares `SQL_TUNING_POOL` connections (default 1), so with 1 the calls still run one at a time; do not assume a speed-up, and do not raise the number of calls because they are parallel. Compare the candidates on the same bind sets so the tables can be set side by side.

## When the user gives MyBatis or JPA code

First turn the code into the SQL the database really runs. Then tune it with the steps above. Answer with a change to the code, not only SQL.

1. **Get the real SQL first.** Call `captured_sql` with the main table name or a distinctive fragment from the code. If the application has run that code, this returns the exact SQL it sent, with placeholders, and bind values where the database records them (see the Oracle notes). Prefer this over your own translation.
2. **If nothing was captured**, translate the code yourself:
   - **MyBatis XML / annotations**:
     - `#{name}` becomes a named bind `:name` (see the Oracle notes).
     - `${name}` is pasted as text. Point it out as an SQL-injection and plan-cache risk.
     - Expand dynamic SQL (`<if>`, `<choose>`, `<where>`, `<trim>`, `<foreach>`) into a list of condition combinations: all optional conditions present, the fewest conditions, and the combinations the application really sends (see `captured_sql` and `top_queries`). Explain each case. A missing condition often causes the full scan.
     - Resolve `<include refid>` and `<sql>` fragments, and `resultMap` joins.
   - **SQL built in Java** (`StringBuilder`, string `+`, QueryDSL `BooleanBuilder`, JPA Criteria, jOOQ): follow every branch that adds or drops a condition, `ORDER BY` or join, and list the combinations the same way as MyBatis dynamic SQL. Take the real SQL from `captured_sql` when you can.
   - **JPA / Hibernate**:
     - Read the entity mappings (`@Table`, `@Column`, `@JoinColumn`, `@ManyToOne`/`@OneToMany`, fetch type) and write the SQL for the JPQL, `@Query`, derived method name or Criteria query.
     - Check what the code path loads. Lazy collections inside a loop mean N+1 queries; one SQL alone hides this.
   - Write binds, dates and fixed-length columns as the Oracle notes say.
   - Always `explain` your translated SQL. A syntax error means the translation is wrong; fix it before tuning.
3. **Tune** with the usual order: ① rewrite → ② hint → ③ index (proposal) → ④ other. Use captured bind values as one of the `compare` values.
   - **Dynamic SQL: a fix for one combination must not break the others.** `explain` and `compare` the proposed fix on every combination in the list, not only on the slow one. If any combination gets clearly slower, do not adopt that fix as it is: change it, or split the statement so each combination (or group of combinations) has its own SQL.
   - Bind sets per combination: run the 3 bind sets (frequent, rare, no rows) on the two ends (all conditions, fewest conditions) and on the slowest combination; run 1 bind set (the most frequent value) on the others. Send one `compare` call per combination with `binds_list`. A combination run with one value can hide skewed data, so say that in `limits` of the report.
   - Show the result as a before/after table, one row per combination: better, same, or worse.
   - If there are more than 6 combinations, do not run them all. Run the two ends and the most frequent ones (6 at most), say how you picked them, and list the combinations you did not run.
4. **Answer with code changes**, as a diff of the mapper XML or the Java code. Typical fixes:
   - **MyBatis**: rewrite the condition inside `<if>`; split a catch-all mapper into specific statements; split one statement into two mapper calls made one after the other in the service code; replace `${}` with `#{}`; add paging in Oracle syntax; select only the needed columns instead of `*` in the resultMap query.
   - **JPA**: a fetch join or `@EntityGraph` for N+1; `@BatchSize` or `default_batch_fetch_size`; a DTO/interface projection instead of whole entities; `Pageable` paging; `@Query(nativeQuery = true)` only when JPQL cannot express the fix.
   - Hints in JPA: use the `org.hibernate.comment` or a native query, and explain why.

## Be exact

- Name plan operations exactly as the plan prints them (the notes list the names).
- Use numbers only from tool output. If you estimate something (for example the cost after an index that does not exist — it cannot be simulated here), label it as an estimate and give the reason.
- Column aliases start with a letter.
- **Copy names from the tool output or the user's code; never retype them.** A stray space inside an identifier (`AD BK_ID`) gives ORA-00907. When a tool returns a syntax error (ORA-00907, ORA-00933, `syntax error at or near`) or an unknown-name error (ORA-00904, ORA-00942), first compare the SQL you sent with its source character by character and confirm names with `table_info`. Never say that the tool cannot parse a construct unless the same SQL, typed correctly, still fails.
- Never select personal data columns with `query`. Count or group instead.

## Common causes

- A function or type conversion on an indexed column (`LOWER(email) = …`, `TO_CHAR(dt) = …`, implicit number/string conversion).
- `LIKE '%…'` with a leading wildcard.
- OR across different columns, `NVL(col, x) = x`, `COALESCE`.
- A low-selectivity index; a full scan may be correct.
- A missing composite index for filter + sort: equality columns first, then range/sort columns.
- Stale or missing statistics.
- `SELECT *` reading wide columns.
- Bad cardinality estimates causing a wrong join order or method.
- N+1 from application code.
- Deep paging with a large `OFFSET` or `ROWNUM` range: every page reads all the rows before it. Propose keyset paging (`WHERE key > :lastKey ORDER BY key`).
- A total `COUNT(*)` on every page call, on the same heavy query.
- `DISTINCT` that hides duplicate rows from a wrong or missing join condition.
- `NOT IN (subquery)` on a nullable column: one NULL returns no rows and blocks an anti-join. Use `NOT EXISTS`.
- Join columns of different types (`NUMBER` = `VARCHAR2`), which converts one side and disables its index.
- A sort or hash join that spills to temp (see the Oracle notes).

## Answer shape

Answer in the user's language, with these sections:

- **Cause**: one or two sentences, pointing at the plan step.
- **① SQL rewrite**: works / not enough / not applicable. Give the SQL and the `compare` table if you ran it. For a split, give every step's SQL. For dynamic SQL, add the table with one row per condition combination (better / same / worse).
- **② Hint**: only if ① was not enough. Same format, plus the plan-fixing risk.
- **③ Index (proposal)**: only if ① and ② were not enough. Give the DDL, the expected effect (labelled if estimated), and the impact: other queries, write volume, overlapping indexes, and how to verify — give the verification steps from the Oracle notes exactly.
- **④ Other**: only the items that apply. A structure change (partitioning, normalizing, denormalizing) is a proposal only, with its estimated gain and its cost.
- **Split and structure check**: always write this line, even when ①–③ were enough. Say which signs you looked for (see "Steps") and what you found. Signs found: give the split, merge or structure proposal. None found: "not applicable — <reason in one line>". Never leave it out.
- **Standard**: which file you used — `.litecode/sql-standard.md` (this project) or `references/sql-standard.md` (the skill's default) — or that none is installed. List the rule IDs the original code violates.
- Close by stating that nothing was created or changed in the database.
- Then write the final report **automatically, without asking** (see "Final report"). Mention its path in one line after the tool returns it.

## Final report

When a tuning is finished, call `report` once **on your own, without asking** (the tool of the sql-tuning server, like `explain`). It writes one local HTML file in the project folder and returns its path.

- Write it whenever you ran `compare` on a rewritten or hinted candidate — both a success (`ok`) and a rejected candidate (`hold`). If you only analysed the plan and tested no candidate, there is nothing to compare: skip the report and say so in one line. Do not write one before the answer is complete, and write only one per tuning request.
- Skip it only if the user said not to make reports ("결과서 만들지 마"); remember that for the rest of the conversation.

- Fill it only with values you got from tool output: `compare` (every bind set you ran, with rows, checksum and ms exactly as printed), `explain` (plan lines, costs, the full plan texts), `impact_check` (the index impact). Pass the original and the rewritten SQL as they were tuned; the server builds the diff.
- Fill `overview` from your own answer, for a reader who was not in the conversation: `summary` (what was asked, why it was slow, what you changed, the result — 2-4 sentences) and `sections` that mirror your answer — Cause (put the plan lines that show it in `code`), ① SQL rewrite (works / not enough / not applicable, and why it is equivalent), ② Hint, ③ Index (proposal), ④ Other, and the split and structure check. Same facts and numbers as the tool output; no new claims; label estimates.
- Always fill `structure_check` from the "Split and structure check" line of your answer: `result` `found` with the proposal, or `none` with the one-line reason. The report is refused without it.
- For dynamic SQL, fill `combinations` with one item per condition combination you checked (`better`, `same` or `worse`, with a short note). If any is `worse`, the verdict is `hold`. One `compare` call takes at most 5 bind sets, and the report holds at most 20, so keep the bind sets per combination small.
- Always add to `limits` that the numbers come from the development database with its row counts (from `table_info`), and that the plan can differ in production when the data volume or statistics differ.
- Put anything you estimated, not measured, in `estimates` with the reason. An index that does not exist cannot be measured, so `index.effect_verified` is normally `false`. Put what you could not check in `unknown`.
- `verdict` is `ok` only when every compare set returned the same result. Otherwise use `hold` and fill `cause` honestly, including what you could not check. Never leave out a failed compare set.
- Fill `standard` and `rules` only from the standard you actually read; if none is installed, omit both.
- Use no personal data: do not put real names, emails or other values in `label`, and keep literals with personal data out of the SQL (use bind variables). Never put passwords or connection details anywhere. The server hides string bind values and connection details, but it cannot know what else is personal.
- If the tool returns an error, fix the named fields from the tool results; do not invent values. Do not say the report exists until the tool result shows its path, then tell the user that path. If the result suggests adding the folder to `.gitignore`, ask the user; do not edit the file yourself.
