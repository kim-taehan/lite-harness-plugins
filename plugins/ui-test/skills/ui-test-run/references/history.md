# Run history file — `<scenario folder>/<scenario id>.history.md`

One optional file per scenario, **next to** its `<id>.md` and `<id>.spec.mjs` (same stem). You write it; the server never does. Deleting the scenario deletes it, and scanning does not treat it as a scenario. No passwords or personal data in it (mask like in 테스트 방법).

It has two parts, in this order.

## Part 1 — `## 다음 수행 때 지킬 것` (first section of the file)

Directive lines for the **next** run of this scenario — what you learned while running it. One or two lines each, written as an instruction:

```
## 다음 수행 때 지킬 것
- 로그인 버튼은 [로그인] 텍스트가 아니라 data-testid=login 으로 찾는다
- 계정은 super 를 쓴다(사용자 답변: "테스트 계정은 super 만 열려 있어요")
```

Rewrite this section after **every** run, reading the whole file (the entries below) — never cut mechanically, never keep only the first lines:

1. **Summarize** — similar or old lines become one line.
2. **Remove what no longer matters** — a problem whose root cause is now fixed in the scenario, the generated code or the settings (it passes without the directive), or a one-time environment problem. When you remove a line, leave `- 정리: <removed directive> 은 해결돼 지침에서 뺌` in the entry of the run you are writing. History is never deleted — only this section changes.
3. **Keep what code cannot do for you** — selector know-how, which account to use, answers the user gave.
4. Keep the section body to about **1500 characters**.

## Part 2 — one entry per run, appended below, newest last

```
## 2026-11-10 16:20 — 실패            (통과 | 실패 | 중단)
- 수행: 20261110T162346_01 (결과서 .litecode/plugins/ui-test/reports/20261110T162346_01/<scenario id>/index.html)
- 실패한 단계: 3. 확인: [로그인] 버튼이 활성화된다
- 오류: <the error text, one line>
- 원인: <what you confirmed yourself — never a guess>
- 해결(다른 방법): <solved another way because the first way failed — new selector, added wait, another route in, other account or data>
- 해결(사용자 답변): <the question you asked> → <the user's answer>   (when you could not solve it alone)
- 결과: <re-run passed / "못 고침" and what you tried>
- 정리: <removed directive> 은 해결돼 지침에서 뺌
```

A run that passed without any problem is just the heading and the 수행 line. Only lines that apply are written (a failure that was solved another way has no 해결(사용자 답변) line, and vice versa).
