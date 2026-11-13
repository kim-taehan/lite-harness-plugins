---
page_id: process-management-systemdesign
title: 프로그램 설계
url_pattern: /ko/process-management/systemdesign/*
arrive_check: URL이 /ko/process-management/systemdesign/ 로 시작 + heading "프로그램 설계" 표시
last_verified: 2026-11-10
related_pages: [main]
---
## 요약
관리 서브프로젝트의 프로그램 설계 목록을 등록·조회하는 화면이다.
"프로그램 설계 목록을 등록하고 요구사항 ID를 매핑해 추적 관리하거나 연계코드로 실적을 관리"한다.
설계 항목 목록 표(총 N건)를 보이며, "추가하기" 버튼으로 등록 다이얼로그를 열어 신규 설계 항목을 만든다.

## 진입 경로
main → process-management-systemdesign (edge: main__process-management-systemdesign)
- 메뉴: 공정상세 관리 → 설계 → "프로그램 설계" (/ko/process-management/systemdesign/41726)
- 분석 공정과 동일 계열이므로 메뉴 링크 클릭은 클라이언트 예외가 재현될 수 있어 직접 URL로 이동 권장

## 화면 요소
| 요소 | 역할 | locator | 비고 |
|---|---|---|---|
| 워크플로 보기 | button | getByRole('button', { name: '워크플로 보기' }) | 미확인 |
| 조회 | tab | getByRole('tab', { name: '조회' }) | 기본 선택 탭, 목록 표 표시 |
| 현황 차트 | tab | getByRole('tab', { name: '현황 차트' }) | 미확인 |
| 완료실적 | tab | getByRole('tab', { name: '완료실적' }) | 미확인 |
| 수행실적 | tab | getByRole('tab', { name: '수행실적' }) | 미확인 |
| 관리 | button | getByRole('button', { name: '관리' }) | 서브프로젝트 선택 드롭다운(기본 관리) |
| 필터 | button | getByRole('button', { name: '필터' }) | 미확인 |
| 검색명 | textbox | getByPlaceholder('검색명을 입력하세요') | 목록 검색 입력란 |
| 추가하기 | button | getByRole('button', { name: '추가하기' }) | "프로그램 설계 등록" 다이얼로그 열림 |
| 저장 | button | getByRole('button', { name: '저장' }) | 초기 disabled, 행 편집 시 활성 |
| 총 건수 | status | getByText('총', { exact: true }) | "총 N", 추가 시 1 증가 |
| 설계 항목 목록 | table | getByRole('table') | 칸: 서브프로젝트, 설계 ID, 설계 명, 대분류, 중분류, 등록 유형, 설계구분 |
| 서브프로젝트 (다이얼로그) | combobox | getByRole('dialog').getByLabel('서브프로젝트') | 필수(*), 기본값 "관리" |
| 설계 ID (다이얼로그) | textbox | getByRole('dialog').getByLabel('설계 ID') | 필수(*), 기본값 "SD-" (자동 부여) |
| 설계 명 (다이얼로그) | textbox | getByRole('dialog').getByPlaceholder('설계 명을 입력해주세요') | 필수(*), 다이얼로그 내 |
| 대분류 (다이얼로그) | textbox | getByRole('dialog').getByPlaceholder('대분류를 입력해주세요') | 선택 |
| 중분류 (다이얼로그) | textbox | getByRole('dialog').getByPlaceholder('중분류를 입력해주세요') | 선택 |
| 등록 유형 (다이얼로그) | combobox | getByRole('dialog').getByLabel('등록 유형') | 기본값 "신규" |
| 설계구분 (다이얼로그) | combobox | getByRole('dialog').getByPlaceholder('설계구분을 입력해주세요') | 선택 |
| 워크플로 (다이얼로그) | combobox | getByRole('dialog').getByLabel('워크플로') | 필수(*), 기본값 "프로그램 설계 표준" |
| 일정 연계 (다이얼로그) | combobox | getByRole('dialog').getByLabel('일정 연계') | 기본값 "설계연계" |
| 사용여부 (다이얼로그) | radio | getByRole('dialog').getByRole('radio', { name: 'Y' }) | 필수(*), 기본값 "Y" |
| 계획 시작일 (다이얼로그) | textbox | getByRole('dialog').getByLabel('계획 시작일') | 필수(*), 기본값 자동 |
| 계획 완료일 (다이얼로그) | textbox | getByRole('dialog').getByLabel('계획 완료일') | 필수(*), 기본값 자동 |
| 저장하기 (다이얼로그) | button | getByRole('dialog').getByRole('button', { name: '저장하기' }) | 설계 항목 등록 제출, 성공 시 다이얼로그 닫히고 목록에 추가 |
| 닫기 (다이얼로그) | button | getByRole('dialog').getByRole('button', { name: '닫기' }) | 다이얼로그 취소 |

## 테스트 케이스
| tc_id | 내용 | 상태 | 최근 수행일 | 스크립트 | 스크립트 상태 |
|---|---|---|---|---|---|
| process-management-systemdesign-TC-001 | 설계 명 "프로그램 설계 항목 추가" 입력 후 저장하기 → 목록에 "프로그램 설계 항목 추가" 항목(SD-000005) 추가 및 총 건수 1 증가 | 성공 | 2026-11-10 | scripts/process-management-systemdesign/process-management-systemdesign-TC-001.yaml | 미검증 |

## TC 상세
### process-management-systemdesign-TC-001
- 목적: 신규 프로그램 설계 항목이 목록에 추가되는지 확인
- 전제조건: 로그인 상태, 프로그램 설계 페이지 접근 가능
- 절차: 1) "추가하기" 클릭 (프로그램 설계 등록 다이얼로그 열림) 2) 설계 명에 "프로그램 설계 항목 추가" 입력 3) "저장하기" 클릭 4) 목록 최상단에 새 항목(SD-000005) 추가 및 총 건수 증가 확인
- 입력 데이터: designName=프로그램 설계 항목 추가
- 기대 결과: 목록에 "프로그램 설계 항목 추가" 항목 추가(총 건수 1 증가, 새 설계 ID 부여)
- 도출 근거: 화면 요소 "추가하기", "설계 명(다이얼로그)", "저장하기(다이얼로그)", "설계 항목 목록", "총 건수"

## 확인 사항
| 날짜 | 질문 | 사용자 답변 | 적용 대상 |
|---|---|---|---|
| 2026-11-10 | 프로그램 설계 항목 추가 시 사용할 설계 명 | "프로그램 설계 항목 추가" 사용 | process-management-systemdesign-TC-001 |

## 수행 이력 (최근 10건)
### 20261110-003 process-management-systemdesign-TC-001 (성공)
- 수행 방식: 탐색
- 입력 데이터: designName=프로그램 설계 항목 추가
- 기대 결과: 목록에 "프로그램 설계 항목 추가" 항목 추가(총 건수 1 증가, 새 설계 ID 부여)
- 실제 결과: "프로그램 설계 등록" 다이얼로그에서 설계 명 "프로그램 설계 항목 추가" 입력 후 저장 → 다이얼로그 닫힘, 총 4→5, 목록 최상단에 SD-000005 "프로그램 설계 항목 추가"(등록 유형 신규) 추가
- 캡처: evidence/captures/process-management-systemdesign/20261110-003-process-management-systemdesign-TC-001-step*.png (3장)
- 연관 페이지: main
- 로그: evidence/logs/20261110-003.md
- 보고서: evidence/reports/20261110-003.md
- 스크립트: scripts/process-management-systemdesign/process-management-systemdesign-TC-001.yaml 생성 (데이터 생성 TC라 사용자 확인 후 미검증 유지)
