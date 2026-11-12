---
name: ui-auto-guide
description: UI-AUTO — write a test guide document (화면 테스트 가이드) for one or more pages or TCs from the recorded evidence only, step by step with the captures of passed runs, without opening the browser. Use for requests like '테스트 가이드 만들어줘', '가이드 문서 작성', '사용 가이드', '화면 가이드', '테스트 절차서', '따라 하기 문서'.
---

# ui-auto-guide

Keep written text short, complete in its core and easy to read (ui-auto-evidence "1. Brevity"). Never shorten the work: do every step, call, capture and check.

Output language: write everything the user sees (answers, log lines) and the guide in Korean. Print log tags, table column names and status values exactly as written.

Terms: evidence = 증적 (everything under `.litecode/ui-auto/`), system map = `.litecode/ui-auto/system_map.md`, page doc = 페이지 문서 (`.litecode/ui-auto/pages/<page_id>.md`), report = 보고서 (`.litecode/ui-auto/reports/<run_id>.md`), guide = 테스트 가이드 (`.litecode/ui-auto/guides/<guide_id>.md`).

## Purpose

Turn what earlier runs observed into a document a person can follow: how to reach the screen, what to prepare, and for each function the steps with the screen after each step and the expected screen. The panel opens it in the app and saves it as PDF.

## When to use

- The user asks for a test guide, a usage guide, a step-by-step document or a 절차서 of a screen or of TCs.

## Inputs

- The target: one page, several pages or a list of tc_ids. If none is given, ask the user once and offer the pages of the system map.

## Procedure

For one TC with a passed run, do not write the guide yourself: call the `guide` tool with the tc_id (it builds `guides/guide-<tc_id>.md` from the newest passed report in the standard layout) and report its path. Write a guide by hand only for several pages or TCs in one document, as below.

Print the log line named in each step right after the step.

1. Print `[skill] ui-auto-guide 로드 — <이유>`. The reason says how this skill was chosen, for example `/ui-auto-guide 로 지정됨` or `요청이 테스트 가이드 작성에 해당함`.
2. Load the `ui-auto-evidence` skill with the skill tool. Print `[skill] ui-auto-evidence 로드 — 증적 조회 규칙 적용`. Then call the `begin` tool with kind `guide` and print `[tool] begin(guide) — guide_id <guide_id>, run_id <run_id>`.
3. Do not open the browser. Read only files inside `.litecode/ui-auto/`, and print `[증적 조회] <파일 경로> — <찾은 내용 요약 | 해당 없음>` after every read:
   1. The system map: `## 진입점`, the route to each target page (procedure B, print `[경로]`) and the `## 페이지 설명` block.
   2. The page doc of each target page: `요약`, `진입 경로`, `화면 요소`, `테스트 케이스`, `TC 상세`, `확인 사항`, `수행 이력`.
   3. For each TC: the newest report whose 판정 is `성공` (from `수행 이력` → `보고서`). Its `수행 절차` and `캡처` are the steps and the pictures of the guide.
4. Choose the TCs of the guide: every target TC that has a `성공` run with a report. A TC without one is not in the guide. List it in `## 6. 가이드에서 뺀 것` with the reason (`미수행`, `실패만 있음 (<run_id>)`, `차단 (<이유>)`, `보고서 없음`).
5. Write `.litecode/ui-auto/guides/<guide_id>.md` in the format of "Guide" below. Use only what the evidence says. Do not invent a step, a value, a message or a picture. Image paths are relative to the guide file (`../captures/...`) and every image file must exist.
6. If the `최근 확인일` of a page or the date of a used report is older than the freshness limit of `begin`, write `오래된 정보 (최근 확인일 <날짜>)` under the title of that function.
7. Print `[증적 갱신] .litecode/ui-auto/guides/<guide_id>.md — 테스트 가이드 작성 (TC N건, 캡처 N장)`. Save the log lines to `.litecode/ui-auto/logs/<run_id>.md` (ui-auto-evidence "Run log" in "8. File formats", 대상 = page_ids and `가이드 <guide_id>`, 결과 = `가이드 작성`). Do not change any other evidence file.
8. Tell the user the guide path and that the UI-AUTO panel (가이드 tab) opens it and saves it as PDF. Print the summary table of ui-auto-evidence "Work log".

## Guide

File: `.litecode/ui-auto/guides/<guide_id>.md`. Always these parts, in this order. The names and values below only show the shape.

````markdown
---
guide_id: guide-20261111-001
title: 주문 목록 화면 테스트 가이드
pages: [orders-list]
tcs: [orders-list-TC-001, orders-list-TC-002]
created: 2026-11-11 10:20
based_on: [20261110-001, 20261110-003]
---
# 주문 목록 화면 테스트 가이드

| 항목 | 내용 |
|---|---|
| 대상 화면 | 주문 목록 (orders-list) |
| 대상 시스템 | https://portal.example.com |
| 포함한 TC | 2건 |
| 근거 수행 | 20261110-001, 20261110-003 |
| 작성일 | 2026-11-11 |

## 1. 목적
이 문서로 확인할 수 있는 것을 2~3문장으로. 페이지 문서의 요약과 TC 목적에서 가져온다.

## 2. 준비
- 계정: UI-AUTO 설정의 테스트 계정으로 로그인한 상태 (계정 값은 적지 않는다)
- 입력값: 각 기능에서 쓰는 값 (testdata.md 의 이름이면 이름도)
- 전제조건: TC 상세의 전제조건

## 3. 들어가는 길
main → orders → orders-list (edge: main__orders, orders__orders-list)
1. https://portal.example.com/ 로 이동
2. "주문관리" 링크 클릭
3. "주문 목록" 링크 클릭 → heading "주문 목록" 이 보이면 도착

![주문 목록](../captures/orders-list/page.png)

## 4. 기능별 따라 하기
### 4-1. 고객명으로 조회 (orders-list-TC-001)
- 목적: 고객명 조건으로 주문이 걸러지는지 확인
- 입력: customer=홍길동

1. 고객명에 "홍길동" 입력
![1단계](../captures/orders-list/20261110-001-orders-list-TC-001-step01.png)
2. "조회" 클릭
![2단계](../captures/orders-list/20261110-001-orders-list-TC-001-step02.png)

기대 화면: 상태 메시지에 "조회 결과 1건" 표시
![기대 화면](../captures/orders-list/20261110-001-orders-list-TC-001-step03.png)

## 5. 주의할 점
- 확인 사항: 고객명 검색은 부분 일치 (2026-11-10 사용자 답변)
- 불일치 · 실패 이력: 없음

## 6. 가이드에서 뺀 것
| tc_id | 내용 | 이유 |
|---|---|---|
| orders-list-TC-002 | 상태 "완료" 선택 후 조회 → "조회 결과 2건" 표시 | 미수행 |

## 7. 근거 증적
- 페이지 문서: .litecode/ui-auto/pages/orders-list.md
- 보고서: .litecode/ui-auto/reports/20261110-001.md
- system_map: .litecode/ui-auto/system_map.md
````

- One `### 4-N.` block per TC in the guide, in tc_id order. Take each step from the report's `## 캡처`: the step text is its `- 한 일:` line in the user's words, then its capture, then `→ 이렇게 보입니다:` with its `- 실제:` line. The last capture of the report (the verdict screen) is the `기대 화면`, with the report's `- 기대:` of that capture. An old report without these lines: use its `수행 절차`.
- `## 5. 주의할 점`: rows of `확인 사항` that apply to the guide's TCs, `불일치` lines of the used runs, and failed or blocked runs with their reasons. `없음` if none.
- `## 6. 가이드에서 뺀 것`: `없음` if every target TC is in the guide.
- No account, password, token or personal data. No snapshot `ref` values.

## Outputs

- The guide `.litecode/ui-auto/guides/<guide_id>.md` and the run log.

## Done when

- The guide file is saved and every image in it exists.
- The user got the path and the list of left-out TCs.

## Do not

- Do not open the browser or call any browser tool. If a TC has no passed run, the guide leaves it out; suggest `/ui-auto-run <tc_id>` instead.
- Do not take steps from a failed or blocked run.
- Do not fill gaps with general knowledge or guesses.
- Do not change evidence files other than the guide and the run log.
