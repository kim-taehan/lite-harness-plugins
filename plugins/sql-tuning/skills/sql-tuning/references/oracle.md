# Oracle notes

Read this before tuning. It adds to SKILL.md; where they overlap, follow this file.

## Plans and numbers

- `explain` uses `EXPLAIN PLAN` + `DBMS_XPLAN`. Costs are optimizer units, not time.
- `compare` reports buffers (logical reads), the median of the measured runs. They are steadier than milliseconds; judge by buffers first.
- `runtime_plan` prints `DBMS_XPLAN.DISPLAY_CURSOR` with `ALLSTATS LAST`. Read per step: `E-Rows` (estimate) against `A-Rows` (actual, summed over `Starts`) — a gap of about 10 times or more is an estimate problem; `Starts` far above 1 means the step repeats per row (nested loop inner side, scalar subquery); `Buffers` shows where the reads go; `Used-Tmp` (or a `1Pass`/`Multi-pass` count in `O/1/M`) means a sort or hash spilled to temp — reduce the rows or columns before the sort, or avoid the sort with an index in `ORDER BY` order.
- Operation names: a lookup on a non-unique index is an INDEX RANGE SCAN, even when the values happen to be distinct. Only a UNIQUE index or a primary key gives INDEX UNIQUE SCAN. INDEX SKIP SCAN means the filtered column is not the leading column of the index.
- A low-selectivity index: a full scan may be correct. Check the index's clustering factor in `table_info`.
- An index that does not exist cannot be simulated here. Label any cost after a proposed index as an estimate.
- Bind peeking: with skewed data, the plan for the first bind value is reused. Include a skewed value in `compare`. Adaptive cursor sharing (11g and later) can later add a child cursor with another plan for a different bind range, but only after a bad run; `captured_sql` may show the same SQL more than once for that reason. Do not rely on it to fix skew.

## Binds

- MyBatis `#{name}` becomes `:name`. Use **named binds** in the SQL you write (`:firstIndex`, `:bbsId`), even when a parameter appears several times (paging wrappers repeat `#{firstIndex}`). A named bind is passed once per name; positional `:1 :2 …` would need one value per occurrence.
- `captured_sql` also returns sampled bind values. Use one of them in `compare`.
- `CHAR(n)` columns are blank-padded, and the comparison rule depends on what you compare with:
  - a **literal** (`BBS_ID = 'BBSMSTR_900000000001'`) is compared with blank-padding, so a shorter literal still matches;
  - a **bind value** is a VARCHAR2, compared without padding, so a value shorter than `n` matches **no rows**.
  So a literal test does not prove the application's bind works. Pad bind values to the column length in `compare` and `runtime_plan`. When the application binds such a column, say that it must pad the value (or that the column should become `VARCHAR2`). A 0-row result from a short bind is not a tool error.
- Dates: a string bound against a `DATE` column is converted with the session's `NLS_DATE_FORMAT` and fails with ORA-01861. Write the conversion in the SQL (`TO_DATE(:fromDt, 'YYYY-MM-DD')`) and pass `'2026-11-01'` — the same way in the original and the candidate.

## SQL syntax

- Column aliases start with a letter (`pad_col`, not `_pad`).
- Paging: `OFFSET … ROWS FETCH NEXT … ROWS ONLY` on 12c and later; nested `ROWNUM` on older versions. A `ROWNUM` alias (`rn`) in the outer select becomes a result column — keep the column lists of both `compare` queries the same.
- `(+)` is the old outer-join syntax; propose ANSI `LEFT JOIN … ON` instead.

## Hints

- A hint goes right after `SELECT` in one `/*+ … */` comment. Oracle reads only the first hint comment, so put several hints in the same comment.
- `runtime_plan` merges its own `GATHER_PLAN_STATISTICS` into your hint comment; your hint still applies.

## Index options

- Composite index: equality columns first, then the range or `ORDER BY` columns. An index in `ORDER BY` order with `ROWNUM`/`FETCH FIRST` gives `SORT ORDER BY STOPKEY` or no sort at all (`WINDOW NOSORT STOPKEY`, `COUNT STOPKEY`).
- Covering: adding the few selected columns to the index removes `TABLE ACCESS BY INDEX ROWID`. Weigh the index size and write cost.
- Function-based index (`CREATE INDEX … ON t (UPPER(name))`) only when the function cannot be removed from the condition. The SQL must use the exact same expression.
- Unindexed foreign key columns: joins from the parent scan the child, and a parent delete or key update locks the whole child table. Check with `table_info` constraints and indexes.
- An index that exists but is not used: the leading column is not in the condition (`INDEX SKIP SCAN` or a full scan), a function or implicit conversion on the column, `IS NULL` on a single-column B-tree (all-NULL keys are not stored — `(col, 0)` would index them), low selectivity or a poor clustering factor.

## Verifying an index proposal

Give exactly these steps. Do not invent other parameter names.

1. on a development database, `CREATE INDEX … INVISIBLE` (the optimizer ignores it, so nothing else changes);
2. in the test session only, `ALTER SESSION SET optimizer_use_invisible_indexes = TRUE`;
3. run `explain` and `compare` there, before and after;
4. if it helps, the DBA decides on `ALTER INDEX … VISIBLE`.

## Other options

- SQL Plan Baseline fixes the plan for one statement without editing the SQL. The edition and license need checking.
- Do not suggest SQL Tuning Advisor (`DBMS_SQLTUNE`) or AWR reports. They need paid Tuning/Diagnostics Pack licenses.
