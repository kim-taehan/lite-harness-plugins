# `_prompt.md` format

One Markdown file at `<test folder>/_prompt.md` (default `ui-tests/_prompt.md`). The `list` tool ignores it (only folders with a `suite.md` are suites). It is a prompt **for you**: how UI testing is done in this project, already resolved, so you follow it instead of re-detecting the stack and re-searching the code on every request. Imperative, short, concrete (paths, patterns, commands) — under about 80 lines. Every line comes from files or tool output you saw; unknown → `확인 안 됨`, never a guess. No passwords.

```markdown
---
updated: 2026-11-09
---

# UI 테스트 — 이 프로젝트에서 하는 법

## 환경
- 화면: JSP + jQuery (src/main/webapp/WEB-INF/views, js/)
- 서버: Java 8 / Spring MVC (src/main/java/**/controller), 밖: /abs/other-repo
- DB 조회 도구: 있음(SQL 튜닝 query) | 없음

## 화면 소스 읽는 법
- 주소 /a/b.do → views/a/b.jsp. 같이 읽을 것: js/common/validate.js
- 검증 규칙은 validate.js 의 rules 와 화면의 data-valid 속성에 있다

## 서버 규칙 찾는 법
- `grep -rn '@RequestMapping("/a/b")' src/main/java` → 처리부 → *Service.java
- 오류 메시지: messages.properties, 코드: ErrorCode.java

## 로그인
- /login.do — 아이디 `#userId`, 비밀번호 `#userPw`, 버튼 "로그인"

## 셀렉터 · 기다림 관례
- label 이 없고 id 가 안정적이다 → #id 우선. 메시지는 .err-msg

## 건너뛸 것 · 하지 말 것
- vendor/, *.min.js 는 읽지 않는다. 삭제 같은 되돌릴 수 없는 버튼은 시나리오에 넣지 않는다

## 확인 안 됨
- 찾지 못한 것
```
