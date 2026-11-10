// 가이드형 결과물 — 수행 기록을 화면 흐름 순서로 풀어 쓴 한 파일 HTML. 결과서와 같은 입력 · 같은 스크린샷 예산을 쓴다.
import { describe, expect, it } from 'vitest'
import { renderGuide } from '../server/guide.ts'
import { parseScenario } from '../server/scenario.ts'
import type { CaseResult, RunRecord } from '../server/types.ts'

const SECRET = 's3cr3t-pw'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

const scenario = parseScenario('01-정상', `---\nname: 정상 로그인\nkind: 정상\n---\n1. 로그인 화면을 연다\n2. 확인: 환영 글이 보인다\n3. 확인(DB): 이력 행이 생긴다\n\n## 테스트 방법\n- 사전 조건: 계정 user, 시작 주소 /login\n- 입력 데이터: 아이디 test01\n- 화면 요소 찾는 법: 라벨\n`)

const cases: CaseResult[] = [
  {
    id: '01-정상',
    title: '정상 로그인',
    status: 'failed',
    durationMs: 4100,
    steps: [
      { title: '1. 로그인 화면을 연다', status: 'passed', durationMs: 900, shot: 'c1-s1.jpg', used: [] },
      { title: '2. 확인: 환영 글이 보인다', status: 'failed', durationMs: 3000, failShot: 'c1-s2-fail.jpg', error: `not visible ${SECRET}`, failKind: 'assertion', used: [] },
      { title: '3. 확인(DB): 이력 행이 생긴다', status: 'db', durationMs: 0, used: [] },
    ],
  },
  {
    id: '04-나이',
    title: '가입 나이 경계',
    status: 'failed',
    durationMs: 1800,
    steps: [],
    rows: [
      { row: 1, label: '69 · 계산됨', status: 'passed', durationMs: 900, steps: [{ title: '1. 연다', status: 'passed', durationMs: 900, shot: 'c2-r1-s1.jpg', used: [] }] },
      { row: 2, label: '71 · 불가', status: 'failed', durationMs: 900, error: 'timeout 5000ms exceeded', failKind: 'timeout', steps: [{ title: '1. 연다', status: 'failed', durationMs: 900, error: 'timeout 5000ms exceeded', failKind: 'timeout', failShot: 'c2-r2-s1-fail.jpg', used: [] }] },
    ],
  },
]
const run: RunRecord = {
  id: '20261109T120000_01',
  startedAt: new Date(2026, 10, 9, 12, 0, 0).getTime(),
  durationMs: 6000,
  headed: false,
  browser: 'Chrome',
  baseUrl: 'http://a',
  cases,
  report: '/r/index.html',
  compare: { previousId: '20261108T100000_01', newFail: ['01-정상'], fixed: [], stillFail: [] },
}
const render = (extra: Partial<Parameters<typeof renderGuide>[0]> = {}) =>
  renderGuide({ run, project: 'p', title: '로그인 화면', user: 'tester', scenarios: new Map([[scenario.id, scenario]]), files: [], image: () => JPEG, secrets: [SECRET], ...extra })

describe('가이드', () => {
  const html = render()

  it('한 파일 — 제목 · 목차 · 시나리오마다 절 · 스크립트 · 바깥 주소 없음', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('로그인 화면 — 화면 사용 가이드')
    expect(html).toContain('<a href="#c0">정상 로그인</a>')
    expect(html).toContain('id="c1"')
    expect(html).toContain('종류 정상')
    expect(html).not.toMatch(/<script|src="(?!data:)/)
  })

  it('단계는 번호 대신 목록 번호로, 확인 · 확인(DB) 는 말머리 칩으로', () => {
    expect(html).toContain('<span>로그인 화면을 연다</span>')
    expect(html).not.toContain('1. 로그인 화면을 연다')
    expect(html).toContain('<span class="chip off">확인</span><span>환영 글이 보인다</span>')
    expect(html).toContain('<span class="chip db">확인(DB)</span><span>이력 행이 생긴다</span>')
    expect(html).toContain('대화에서만 확인')
  })

  it('실패도 빼지 않는다 — 실패 단계 · 갈래 · 오류 · 실패 순간 화면 · 확인이 필요한 곳 모음', () => {
    expect(html).toContain('<b>확인 값 다름</b>')
    expect(html).toContain('<b>기다림 시간 초과</b>')
    expect(html).toContain('확인이 필요한 곳 2건')
    expect(html).toContain('정상 로그인 — 환영 글이 보인다 (확인 값 다름)')
    expect(html).toContain('가입 나이 경계 2행 — 연다 (기다림 시간 초과)')
    expect(html).toContain('alt="실패한 순간의 화면"')
    expect(html).toContain('새로 실패 1')
  })

  it('데이터 표 시나리오는 행마다 한 절 · 준비할 것은 테스트 방법의 사전 조건 · 입력 데이터만', () => {
    expect(html).toContain('1행 — 69 · 계산됨')
    expect(html).toContain('2행 — 71 · 불가')
    expect(html).toContain('<b>준비할 것</b>')
    expect(html).toContain('사전 조건: 계정 user')
    expect(html).toContain('입력 데이터: 아이디 test01')
    expect(html).not.toContain('화면 요소 찾는 법')
  })

  it('비밀 값은 어디에도 없다', () => {
    expect(html).not.toContain(SECRET)
    expect(html).toContain('not visible ****')
  })

  it('스크린샷은 파일 안에(data: URL) — 예산을 넘으면 실패 순간을 먼저 남기고 몇 장 뺐는지 적는다', () => {
    expect(html.match(/data:image\/jpeg;base64,/g)).toHaveLength(4)
    const big = new Uint8Array(1000)
    const small = render({ image: () => big, imageBudget: 1500 })
    expect(small.match(/data:image\/jpeg;base64,/g)).toHaveLength(1)
    expect(small).toContain('alt="실패한 순간의 화면"')
    expect(small).toContain('스크린샷 3 장은 문서 크기')
  })

  it('중단된 수행은 까닭을 적는다', () => {
    expect(render({ run: { ...run, interrupted: '서버가 내려감' } })).toContain('서버가 내려감')
  })
})
