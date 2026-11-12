---
page_id: main
title: 대시보드
url_pattern: /ko
arrive_check: URL이 /ko 로 끝남 + Page Title "대시보드 \| Portal"
last_verified: 2026-11-10
related_pages: [process-management-analyze]
---
## 요약
로그인 후 처음 열리는 화면이다.
프로젝트 정보(남은 일수, 서브프로젝트 진척률), 내 작업, 공지사항, 캘린더 등 카드가 표시된다.
좌측 상단 메뉴(내 작업/일정 관리/공정상세 관리/품질 관리/위험 관리/의사소통 관리)로 각 관리 영역으로 이동한다.

## 진입 경로
진입점. https://portal.example.test/ko 로 이동 (로그인 상태 유지)

## 화면 요소
| 요소 | 역할 | locator | 비고 |
|---|---|---|---|
| 프로젝트 선택 | combobox | getByLabel('프로젝트를 선택하세요') | 현재 PIMS-BOX-0003 |
| 대시보드 | link | getByRole('link', { name: '대시보드' }) | /ko |
| 내 작업 | button | getByRole('button', { name: '내 작업' }) | 메뉴 확장 |
| 일정 관리 | button | getByRole('button', { name: '일정 관리' }) | 메뉴 확장 |
| 공정상세 관리 | button | getByRole('button', { name: '공정상세 관리' }) | 하위 메뉴(분석/설계/개발/테스트) 확장 |
| 분석 | button | getByRole('button', { name: '분석' }) | 공정상세 관리 하위, "요구사항 정의" 링크 확장 |
| 품질 관리 | button | getByRole('button', { name: '품질 관리' }) | 미확인 |
| 위험 관리 | button | getByRole('button', { name: '위험 관리' }) | 미확인 |
| 의사소통 관리 | button | getByRole('button', { name: '의사소통 관리' }) | 미확인 |

## 테스트 케이스
| tc_id | 내용 | 상태 | 최근 수행일 | 스크립트 | 스크립트 상태 |
|---|---|---|---|---|---|

## TC 상세
없음

## 확인 사항
| 날짜 | 질문 | 사용자 답변 | 적용 대상 |
|---|---|---|---|

## 수행 이력 (최근 10건)
없음
