---
page_id: process-management-analyze
title: 요구사항 정의
url_pattern: /ko/process-management/analyze/*
arrive_check: URL이 /ko/process-management/analyze/ 로 시작 + heading "요구사항 정의" 표시
last_verified: 2026-11-10
related_pages: [main]
---
## 요약
관리 서브프로젝트의 요구사항을 정의·조회·등록하는 화면이다.
요구사항 목록 표(총 N건)를 보이며, "추가하기" 버튼으로 등록 다이얼로그를 열어 신규 요구사항을 만든다.
등록 성공 시 목록에 항목이 추가되고 성공 토스트가 표시된다.

## 진입 경로
main → process-management-analyze (edge: main__process-management-analyze)
- 메뉴 경로(공정상세 관리 → 분석 → 요구사항 정의)는 클라이언트 예외("Application error: a client-side exception")로 일관되게 실패한다.
- 정상 이동은 직접 URL(https://portal.example.test/ko/process-management/analyze/41715)로.

## 화면 요소
| 요소 | 역할 | locator | 비고 |
|---|---|---|---|
| 워크플로 보기 | button | getByRole('button', { name: '워크플로 보기' }) | 미확인 |
| 페이지 설정 | button | getByRole('button', { name: '페이지 설정' }) | 미확인 |
| 조회 | tab | getByRole('tab', { name: '조회' }) | 기본 선택 탭, 목록 표 표시 |
| 현황 차트 | tab | getByRole('tab', { name: '현황 차트' }) | 미확인 |
| 관리 | button | getByRole('button', { name: '관리' }) | 목록 보기 모드로 |
| 필터 | button | getByRole('button', { name: '필터' }) | 미확인 |
| 검색명 | textbox | getByPlaceholder('검색명을 입력하세요') | 목록 검색 입력란 |
| 추가하기 | button | getByRole('button', { name: '추가하기' }) | "요구사항 정의 등록" 다이얼로그 열림 |
| 저장 | button | getByRole('button', { name: '저장' }) | 초기 disabled, 행 편집 시 활성 |
| 총 건수 | status | getByText('총', { exact: true }) | "총 N", 추가 시 1 증가 |
| 요구사항 목록 | table | getByRole('table') | 칸: 서브프로젝트, ID, 요구사항명, 등록유형, 요구사항 유형, 진행상태, 도출단계, 난이도, 중요도, 담당자, 작업상태, 현재 단계, 수행, 승인 상태, 진척률, 일정연계, 워크플로, 사용여부 |
| 요구사항명 (다이얼로그) | textbox | getByRole('dialog').getByPlaceholder('요구사항명을 입력해주세요') | 필수(*), 다이얼로그 내 |
| 서브프로젝트 (다이얼로그) | combobox | getByRole('dialog').getByRole('combobox') | 필수(*), 기본값 "관리" |
| ID (다이얼로그) | textbox | getByRole('dialog').getByRole('textbox', { name: 'ID' }) | 필수(*), 기본값 "REQ-" |
| 난이도 (다이얼로그) | combobox | getByRole('dialog').getByLabel('난이도') | 필수(*), 기본값 "하" |
| 워크플로 (다이얼로그) | combobox | getByRole('dialog').getByLabel('워크플로') | 필수(*), 기본값 "요구사항 정의 표준" |
| 사용여부 (다이얼로그) | radio | getByRole('dialog').getByRole('radio', { name: 'Y' }) | 필수(*), 기본값 "Y" |
| 저장하기 (다이얼로그) | button | getByRole('dialog').getByRole('button', { name: '저장하기' }) | 요구사항 등록 제출, 성공 시 다이얼로그 닫히고 목록에 추가 |
| 닫기 (다이얼로그) | button | getByRole('dialog').getByRole('button', { name: '닫기' }) | 다이얼로그 취소 |
| 성공 메시지 | alert | getByRole('alert') | "«요구사항명» 를 신규 등록했습니다." 토스트 |
| 요구사항 행(요구사항명 셀) | cell | getByRole('cell', { name: '«요구사항명»', exact: true }) | 클릭 시 URL ?uid= 붙고 상세 뷰 다이얼로그 열림 |
| 상세 뷰 다이얼로그 | dialog | (제목: 요구사항명, level 2 heading) | 탭: 기본 정보/변경 이력/워크플로 이력. 헤더 우측에 like·comment·복사·연필 아이콘 |
| 연필(수정) 아이콘 | button | getByRole('dialog').getByRole('button').nth(5) | 상세 뷰 헤더의 6번째 버튼(무명). 클릭 시 "요구사항 정의 수정" 편집 다이얼로그 열림 |
| 수정 다이얼로그 | dialog | getByRole('dialog', { name: '요구사항 정의 수정' }) | 제목 "요구사항 정의 수정". 필드들이 입력 가능한 textbox/combobox로 전환 |
| 요구사항명 (수정 다이얼로그) | textbox | getByRole('dialog', { name: '요구사항 정의 수정' }).getByPlaceholder('요구사항명을 입력해주세요') | 기존 값 prefilled. 필수(*) |
| 저장하기 (수정 다이얼로그, 메인) | button | getByRole('dialog', { name: '요구사항 정의 수정' }).getByRole('button', { name: '저장하기' }).first() | 요구사항 저장(PUT 204). 저장 후에도 편집 다이얼로그 유지. 뒤의 저장하기는 워크플로·댓글용(disabled) |
| 닫기 (수정/상세 다이얼로그) | button | getByRole('dialog').getByRole('button', { name: '닫기' }) | 편집 다이얼로그 닫기 → 상세 뷰, 다시 닫기 → 목록 |

## 테스트 케이스
| tc_id | 내용 | 상태 | 최근 수행일 | 스크립트 | 스크립트 상태 |
|---|---|---|---|---|---|
| process-management-analyze-TC-001 | 요구사항명 "요구사항 추가 테스트" 입력 후 저장하기 → 목록에 "요구사항 추가 테스트" 항목 추가 및 성공 토스트 "'요구사항 추가 테스트' 를 신규 등록했습니다." 표시 | 성공 | 2026-11-10 | scripts/process-management-analyze/process-management-analyze-TC-001.yaml | 검증됨 |
| process-management-analyze-TC-002 | "요구사항 추가 테스트" 행을 열어 연필(수정)→요구사항명 "요구사항 수정 테스트"로 변경 후 저장 → 목록/상세에서 해당 요구사항(REQ-000319)명이 "요구사항 수정 테스트"로 변경 | 성공 | 2026-11-10 | scripts/process-management-analyze/process-management-analyze-TC-002.yaml | 미검증 |

## TC 상세
### process-management-analyze-TC-001
- 목적: 신규 요구사항 추가 시 요구사항 목록에 항목이 추가되는지 확인
- 전제조건: 로그인 상태, 요구사항 정의 페이지 접근 가능
- 절차: 1) "추가하기" 클릭 (등록 다이얼로그 열림) 2) 요구사항명에 "요구사항 추가 테스트" 입력 3) "저장하기" 클릭 4) 목록 최상단에 새 항목(REQ-000318) 추가 및 성공 토스트 확인
- 입력 데이터: requirementName=요구사항 추가 테스트
- 기대 결과: 목록에 "요구사항 추가 테스트" 항목 추가(총 건수 1 증가) 및 성공 메시지 "'요구사항 추가 테스트' 를 신규 등록했습니다." 표시
- 도출 근거: 화면 요소 "추가하기", "요구사항명(다이얼로그)", "저장하기(다이얼로그)", "요구사항 목록", "성공 메시지"

### process-management-analyze-TC-002
- 목적: 기존 요구사항의 요구사항명을 수정할 수 있는지 확인
- 전제조건: 로그인 상태, 목록에 "요구사항 추가 테스트" 요구사항 존재
- 절차: 1) "요구사항 추가 테스트" 행의 요구사항명 셀 클릭 (상세 뷰 열림, ?uid= 추가) 2) 헤더 연필(수정) 아이콘 클릭 ("요구사항 정의 수정" 편집 다이얼로그 열림) 3) 요구사항명을 "요구사항 수정 테스트"로 변경 4) 메인 "저장하기" 클릭 (PUT 204, 저장 후 편집 다이얼로그 유지) 5) 편집 다이얼로그 닫기 → 상세 뷰(새 이름) 6) 상세 뷰 닫기 → 목록에서 변경 확인
- 입력 데이터: oldName=요구사항 추가 테스트, newName=요구사항 수정 테스트
- 기대 결과: 저장 후 목록과 상세 뷰에서 해당 요구사항(REQ-000319)의 요구사항명이 "요구사항 수정 테스트"로 변경됨
- 도출 근거: 화면 요소 "요구사항 행(요구사항명 셀)", "연필(수정) 아이콘", "수정 다이얼로그", "요구사항명(수정 다이얼로그)", "저장하기(수정 다이얼로그, 메인)", "요구사항 목록"

## 확인 사항
| 날짜 | 질문 | 사용자 답변 | 적용 대상 |
|---|---|---|---|
| 2026-11-10 | 대상 페이지 URL을 직접 알려줄까요, 아니면 메인에서 탐색할까요 | 메인에서 직접 탐색해 주세요 | process-management-analyze |
| 2026-11-10 | 신규 요구사항 추가 성공 시 기대 결과는? | 목록에 항목 추가 확인 | process-management-analyze-TC-001 |
| 2026-11-10 | 요구사항명 수정 TC 스크립트를 검증 재실행할까요 (나머지 1건 데이터가 수정됨)? | 검증 없이 미검증 상태로 기록 | process-management-analyze-TC-002 |

## 수행 이력 (최근 10건)
### 20261110-002 process-management-analyze-TC-002 (성공)
- 수행 방식: 이동 스크립트+MCP
- 입력 데이터: oldName=요구사항 추가 테스트, newName=요구사항 수정 테스트
- 기대 결과: 저장 후 목록과 상세 뷰에서 해당 요구사항(REQ-000319)의 요구사항명이 "요구사항 수정 테스트"로 변경됨
- 실제 결과: "요구사항 추가 테스트"(REQ-000319) 행 클릭 → 상세 뷰 → 연필(수정) → "요구사항 정의 수정" 편집 다이얼로그에서 요구사항명을 "요구사항 수정 테스트"로 변경 → 저장(PUT /api/pms/analysis-progressing/41715/detail 204). 저장 후 편집 다이얼로그 유지, 닫기 시 상세 뷰가 "요구사항 수정 테스트" 표시, 목록에서 REQ-000319 = "요구사항 수정 테스트" 확인(총 133 유지, REQ-000318은 "요구사항 추가 테스트"로 유지)
- 캡처: evidence/captures/process-management-analyze/20261110-002-process-management-analyze-TC-002-step*.png (6장)
- 연관 페이지: main
- 로그: evidence/logs/20261110-002.md
- 보고서: evidence/reports/20261110-002.md
- 스크립트: scripts/process-management-analyze/process-management-analyze-TC-002.yaml 생성 (데이터 수정 TC라 사용자 확인 후 미검증 유지)
### 20261110-001 process-management-analyze-TC-001 (성공)
- 수행 방식: 탐색
- 입력 데이터: requirementName=요구사항 추가 테스트
- 기대 결과: 목록에 "요구사항 추가 테스트" 항목 추가(총 건수 1 증가) 및 성공 메시지 "'요구사항 추가 테스트' 를 신규 등록했습니다." 표시
- 실제 결과: (수행) 성공 토스트 "'요구사항 추가 테스트' 를 신규 등록했습니다." 표시, 총 131→132, REQ-000318 추가. (스크립트 검증 재실행) 다이얼로그 닫힘 확인, 총 132→133, REQ-000319 추가, 목록에 "요구사항 추가 테스트" 행 존재. 본 run에서 총 2건(수행 1 + 검증 1) 추가됨
- 캡처: evidence/captures/process-management-analyze/20261110-001-process-management-analyze-TC-001-step*.png (3장)
- 연관 페이지: main
- 로그: evidence/logs/20261110-001.md
- 보고서: evidence/reports/20261110-001.md
- 스크립트 검증: scripts/process-management-analyze/process-management-analyze-TC-001.yaml 재실행 통과 → 검증됨
