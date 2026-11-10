import { describe, expect, it } from 'vitest'
import { browserEnv, driverFor, WebDriver, type BrowserLike, type Launch } from '../server/driver.ts'
import { compareFor, compareLine, compareWithLast } from '../server/history.ts'
import { renderReport } from '../server/report.ts'
import { parseScenario } from '../server/scenario.ts'
import { createExpect, runCase, type PageLike } from '../server/steps.ts'
import type { CaseResult, RunRecord } from '../server/types.ts'

// UI 테스트 (#1248) — 지난 실행과 비교 · 결과서 · 단계 API · 드라이버 고르기. 실행기(가짜 브라우저, 진짜 브라우저는 띄우지 않는다)는 workspace.test.ts

const SECRET = 'pa55-W0rd!'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

const caseOf = (id: string, status: CaseResult['status']): CaseResult => ({ id, title: id, status, durationMs: 10, steps: [] })
const runOf = (id: string, cases: CaseResult[]): RunRecord => ({ id, startedAt: 0, durationMs: 1, headed: true, browser: 'Chrome', baseUrl: 'http://a', cases, report: `/r/${id}/index.html` })

/** 시나리오마다 마지막으로 실제 실행한 결과(저장소의 scenarios.last)를 비교 기준으로 만든다 */
const beforeOf = (entries: Record<string, 'passed' | 'failed'>): Map<string, 'passed' | 'failed'> => new Map(Object.entries(entries))

describe('지난 실행과 비교', () => {
  it('새로 실패 · 고쳐짐 · 그대로 실패 — 지난번에 없던 시나리오의 실패는 새로 실패', () => {
    const before = beforeOf({ '01': 'passed', '02': 'failed', '03': 'failed', '04': 'passed' })
    const compare = compareWithLast(before, '20261105T162000_01', [caseOf('01', 'failed'), caseOf('02', 'passed'), caseOf('03', 'failed'), caseOf('04', 'passed'), caseOf('05', 'failed'), caseOf('06', 'no-code')])
    expect(compare).toEqual({ previousId: '20261105T162000_01', newFail: ['01', '05'], fixed: ['02'], stillFail: ['03'] })
    expect(compareLine(compare!)).toBe('새로 실패 2 · 고쳐짐 1 · 그대로 실패 1')
    expect(compareWithLast(new Map(), undefined, [caseOf('01', 'failed')])).toBeUndefined()
    expect(compareWithLast(new Map(), '20261105T162000_01', [caseOf('01', 'failed')])).toBeUndefined()
  })

  it('일부만 실행한 수행이 끼어도 — 기준은 시나리오마다 마지막으로 실제 실행한 결과(멈춤 · 코드 없음은 기준에 없다)', () => {
    // 01 은 어제 실패했고 그 뒤 일부만 실행한 수행에는 없었다 — 이번에도 실패면 "그대로 실패"
    expect(compareWithLast(beforeOf({ '01': 'failed' }), '20261105T110000_01', [caseOf('01', 'failed')])).toEqual({ previousId: '20261105T110000_01', newFail: [], fixed: [], stillFail: ['01'] })
    expect(compareWithLast(beforeOf({ '01': 'failed' }), '20261105T110000_01', [caseOf('01', 'passed')])?.fixed).toEqual(['01'])
    // 멈춤 · 코드 없음은 돈 게 아니라 비교에 끼지 않는다
    expect(compareWithLast(beforeOf({ '01': 'failed' }), 'x', [caseOf('01', 'stopped'), caseOf('02', 'no-code')])).toEqual({ previousId: 'x', newFail: [], fixed: [], stillFail: [] })
  })

  it('compareFor — 시나리오마다 따로 낸 결과서에는 그 시나리오 몫만(데이터 행 포함)', () => {
    const compare = { previousId: 'p', newFail: ['a', 'b#2'], fixed: ['b#1', 'c'], stillFail: ['a#3'] }
    expect(compareFor(compare, 'b')).toEqual({ previousId: 'p', newFail: ['b#2'], fixed: ['b#1'], stillFail: [] })
    expect(compareFor(compare, 'a')).toEqual({ previousId: 'p', newFail: ['a'], fixed: [], stillFail: ['a#3'] })
    expect(compareFor(undefined, 'a')).toBeUndefined()
  })
})

describe('브라우저에 넘기는 환경변수', () => {
  it('기록 저장소 번호표(LITECODE_DB_*)는 넘기지 않는다', () => {
    expect(browserEnv({ PATH: '/bin', LITECODE_DB_URL: 'http://127.0.0.1:1', LITECODE_DB_TOKEN: 'tok', HOME: '/h' })).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})

describe('결과서 HTML', () => {
  const scenario = parseScenario('01-정상', `---\nname: 정상 로그인\nkind: 정상\n---\n1. 로그인한다\n2. 확인: 환영 글\n3. 확인(DB): 이력 행\n\n## 테스트 방법\n- 사전 조건: 계정 user\n- 입력 데이터: 아이디 tester\n- 마지막 성공: 2026-11-06 · 1.0초\n`)
  const run: RunRecord = {
    ...runOf('20261106T114200_01', []),
    cases: [
      {
        id: '01-정상',
        title: '정상 로그인',
        status: 'failed',
        durationMs: 4100,
        error: `expect failed for ${SECRET}`,
        steps: [
          { title: '1. 로그인한다', status: 'passed', durationMs: 900, shot: 'c1-s1.jpg', used: ['getByLabel("아이디")', 'getByLabel("비밀번호")'] },
          { title: '2. 확인: 환영 글', status: 'failed', durationMs: 3000, shot: undefined, failShot: 'c1-s2-fail.jpg', error: `not visible ${SECRET}`, used: ['expect.toBeVisible()'] },
          { title: '3. 확인(DB): 이력 행', status: 'db', durationMs: 0, used: [] },
        ],
      },
    ],
    compare: { previousId: '20261105T162000_01', newFail: ['01-정상'], fixed: [], stillFail: [] },
  }
  const html = renderReport({ run, project: 'ins-sales', title: '로그인 화면', user: 'tester', scenarios: new Map([[scenario.id, scenario]]), files: [{ scenario: 'ui-tests/login/01-정상.md', spec: 'ui-tests/login/01-정상.spec.mjs' }], image: () => JPEG, secrets: [SECRET] })

  it('한 파일 — 머리 · 비교 줄 · 단계 표 · 스크린샷이 파일 안에 · 인쇄용 스타일', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('UI 테스트 수행 결과서 — 로그인 화면')
    expect(html).toContain('ins-sales')
    expect(html).toContain('새로 실패 1 · 고쳐짐 0 · 그대로 실패 0')
    expect(html).toContain('<p class="t">로그인한다</p>')
    expect(html).not.toMatch(/<p class="t">\d+\./)
    expect(html).toContain('<p class="t">확인: 환영 글</p>')
    expect(html).toContain('getByLabel(&quot;아이디&quot;)')
    expect(html.match(/src="data:image\/jpeg;base64,/g)).toHaveLength(2)
    expect(html).toContain(Buffer.from(JPEG).toString('base64'))
    expect(html).toContain('대화에서만 확인')
    expect(html).toContain('@media print')
    expect(html).not.toMatch(/<script|src="(?!data:)/)
  })

  it('케이스마다 테스트 방법 · 끝에 시나리오 원문과 코드 위치', () => {
    expect(html).toContain('테스트 방법</h3>')
    expect(html).toContain('<li><b>사전 조건</b><span>계정 user</span></li>')
    expect(html).toContain('ui-tests/login/01-정상.spec.mjs')
    expect(html).toContain('<summary>01-정상.md</summary>')
  })

  it('비밀 값은 넣지 않는다', () => {
    expect(html).not.toContain(SECRET)
    expect(html).toContain('not visible ****')
  })

  it('실패 N개 링크 · 시나리오 앵커 · 하나뿐이면 요약 목록 없음', () => {
    expect(html).toContain('실패 1개')
    expect(html).toContain('<a href="#s-01-정상">')
    expect(html).toContain('id="s-01-정상"')
    expect(html).not.toContain('id="sum"')
    expect(html).toContain('실패 순간')
  })

  it('실패가 없으면 링크 줄이 없고, 여럿이면 요약 목록 행이 링크 · 앵커 id 는 공백과 따옴표를 거른다', () => {
    const ok = (id: string, status: 'passed' | 'failed'): CaseResult => ({ id, title: id, status, durationMs: 1, steps: [] })
    const input = { project: 'p', title: 's', user: 'u', scenarios: new Map(), files: [], image: () => undefined, secrets: [] }
    const clean = renderReport({ ...input, run: { ...run, compare: undefined, cases: [ok('a', 'passed'), ok('b', 'passed')] } })
    expect(clean).not.toContain('class="fails"')
    expect(clean).toContain('id="sum"')
    expect(clean).toContain('<a href="#s-b">')
    const odd = renderReport({ ...input, run: { ...run, compare: undefined, cases: [ok('가 나"<x>', 'failed'), ok('b', 'passed')] } })
    expect(odd).toContain('id="s-가-나&quot;&lt;x&gt;"')
    expect(odd).not.toContain('"<x>')
  })
})

/** 가짜 페이지 — screenshot 은 JPEG, getByText 등은 기록만 */
function fakePage(visible = true): PageLike {
  const locator = (label: string) => ({ isVisible: async () => visible, innerText: async () => label, inputValue: async () => '', count: async () => 1, isEnabled: async () => true, isChecked: async () => false, fill: async () => undefined, click: async () => undefined, toString: () => `getByText('${label}')` })
  return {
    screenshot: async () => JPEG,
    url: () => 'http://a/main',
    title: async () => '데모',
    goto: async () => null,
    getByText: (label: string) => locator(label),
    getByLabel: (label: string) => locator(label),
    getByRole: (_role: string, options?: { name?: string }) => locator(options?.name ?? ''),
  }
}

describe('단계 API', () => {
  const saved: string[] = []
  const options = (page = fakePage()) => ({ page, account: { name: 'default', user: 'tester', password: SECRET }, baseUrl: 'http://a', save: async (name: string) => (saved.push(name), name), secrets: [SECRET], expectTimeoutMs: 50 })
  const steps = parseScenario('01', '1. 연다\n2. 넣는다\n3. 확인: 보인다\n4. 확인(DB): 행\n5. 남은 단계\n').steps

  it('단계마다 스크린샷 · 쓴 셀렉터 · 기다림을 적고(값은 적지 않는다), DB 확인은 돌리지 않고, 부르지 않은 단계는 수행 안 함', async () => {
    saved.length = 0
    const result = await runCase(
      {
        id: '01',
        title: 'x',
        steps,
        spec: async ({ step, page, expect, account }) => {
          await step('1. 연다', async () => (page['goto'] as (u: string) => Promise<unknown>)('/'))
          await step('2. 넣는다', async () => (page['getByLabel'] as (l: string) => { fill(v: string): Promise<void> })('비밀번호').fill(account.password))
          await step('3. 확인: 보인다', async () => expect((page['getByText'] as (l: string) => unknown)('환영')).toBeVisible())
          await step('4. 확인(DB): 행')
        },
      },
      options(),
      0,
    )
    expect(result.status).toBe('passed')
    expect(result.steps.map((step) => [step.title, step.status])).toEqual([
      ['1. 연다', 'passed'],
      ['2. 넣는다', 'passed'],
      ['3. 확인: 보인다', 'passed'],
      ['4. 확인(DB): 행', 'db'],
      ['5. 남은 단계', 'not-run'],
    ])
    expect(result.steps[0]!.used).toEqual(['goto("/")'])
    expect(result.steps[1]!.used).toEqual(['getByLabel("비밀번호")'])
    expect(result.steps[2]!.used).toEqual(['getByText("환영")', 'expect.toBeVisible()'])
    // 화면 태그 재료 — "확인:" 단계를 실행한 순간의 주소(경로만)
    expect(result.steps.map((step) => step.url)).toEqual([undefined, undefined, '/main', undefined, undefined])
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(saved).toEqual(['c1-s1.jpg', 'c1-s2.jpg', 'c1-s3.jpg'])
  })

  it('실패하면 그 순간 한 장 더 찍고 케이스를 멈춘다 — 오류 글의 비밀 값은 지운다', async () => {
    saved.length = 0
    const result = await runCase(
      {
        id: '02',
        title: 'y',
        steps,
        spec: async ({ step, expect }) => {
          await step('1. 연다', async () => {
            throw new Error(`login failed with ${SECRET}`)
          })
          await step('2. 넣는다', async () => expect(1).toBe(1))
        },
      },
      options(),
      1,
    )
    expect(result.status).toBe('failed')
    expect(result.steps[0]).toMatchObject({ status: 'failed', failShot: 'c2-s1-fail.jpg', error: 'login failed with ****' })
    expect(result.steps[1]!.status).toBe('not-run')
    expect(result.error).toBe('login failed with ****')
    expect(saved).toEqual(['c2-s1-fail.jpg'])
  })

  it('expect — 위치는 기한까지 다시 보고, .not · 값 비교', async () => {
    const record: string[] = []
    const expect_ = createExpect((entry) => record.push(entry), 30)
    const page = fakePage(false)
    await expect_((page['getByText'] as (l: string) => unknown)('x')).not.toBeVisible()
    await expect(expect_((page['getByText'] as (l: string) => unknown)('x')).toBeVisible()).rejects.toThrow(/toBeVisible\(\) — 0초 안에 맞지 않음|0\.03초/)
    await expect_(page).toHaveURL('/main')
    expect(() => expect_([1, 2]).toContain(3)).toThrow(/toContain/)
    expect(record).toContain('expect.not.toBeVisible()')
  })
})

describe('드라이버 — 기다리지 않고 걸어 둔 Promise', () => {
  // 생성 코드가 `const r = page.waitForResponse(…)` 를 걸어 두고 단계가 실패하면, 창이 닫힐 때 그 Promise 가 reject 된다.
  // 지켜 주지 않으면 unhandledRejection 으로 프로세스 전체가 죽는다(vitest 도 처리 안 된 오류로 실패시킨다).
  const input = { id: '02-a', title: '에이', steps: ['1. 연다'] }
  const options = (extra: Partial<Parameters<WebDriver['run']>[1]> = {}) => ({ headed: false, baseUrl: 'http://a', account: { name: 'default', user: 'u', password: 'p' }, secrets: [], stopped: () => false, save: async (name: string) => name, ...extra })

  /** 가짜 브라우저 — page.waitForResponse 가 걸어 둔 Promise 를 context.close 때 reject 한다 */
  function dangling(message: string): BrowserLike {
    return {
      newContext: async () => {
        const pending: ((error: Error) => void)[] = []
        return {
          newPage: async () => ({ ...fakePage(true), waitForResponse: () => new Promise((_resolve, reject) => pending.push(reject)) }) as never,
          close: async () => {
            for (const reject of pending) reject(new Error(message))
          },
        }
      },
      close: async () => undefined,
    }
  }
  const spec = (body: string) => async () => (new Function(`return ${body}`)() as never)

  it('걸어 둔 기다리기가 창을 닫을 때 reject 돼도 수행이 끝까지 돌고, 실패한 케이스는 그대로 실패로 돌려준다', async () => {
    const driver = new WebDriver('chrome', async () => dangling('page.waitForResponse: Target page, context or browser has been closed'), spec(`async ({ step, page }) => {
      const access = page.waitForResponse('/api')
      await step('1. 연다', async () => { throw new Error('안 열림') })
      await access
    }`))
    const results = await driver.run([{ ...input, specFile: 'x' }, { ...input, id: '03-b', title: '비', specFile: 'x' }], options())
    expect(results.map((item) => [item.id, item.status])).toEqual([['02-a', 'failed'], ['03-b', 'failed']])
    expect(results[0]!.error ?? results[0]!.steps[0]?.error).toContain('안 열림')
  })

  it('단계는 다 성공했는데 따로 뜬 Promise 가 닫힘이 아닌 이유로 실패하면 그 케이스를 실패로 기록한다', async () => {
    const driver = new WebDriver('chrome', async () => dangling('응답 형식이 틀립니다'), spec(`async ({ step, page }) => {
      page.waitForResponse('/api')
      await step('1. 연다', async () => undefined)
    }`))
    const [result] = await driver.run([{ ...input, specFile: 'x' }], options())
    expect(result).toMatchObject({ status: 'failed', failKind: 'script' })
    expect(result!.error).toContain('처리되지 않은 Promise 실패: 응답 형식이 틀립니다')
    expect(result!.error).toContain('Promise.all')
  })

  it('닫힘 오류만 난 성공 케이스는 성공 그대로 두고, 다음 케이스도 돈다', async () => {
    const driver = new WebDriver('chrome', async () => dangling('Target page, context or browser has been closed'), spec(`async ({ step, page }) => {
      page.waitForResponse('/api')
      await step('1. 연다', async () => undefined)
    }`))
    const results = await driver.run([{ ...input, specFile: 'x' }, { ...input, id: '03-b', title: '비', specFile: 'x' }], options())
    expect(results.map((item) => item.status)).toEqual(['passed', 'passed'])
  })
})

describe('드라이버', () => {
  it('web 만 있고, 다른 대상은 아직 없다고 말한다', () => {
    expect(driverFor('web', { channel: 'chrome' })).toBeInstanceOf(WebDriver)
    expect(() => driverFor('mobile', { channel: 'chrome' })).toThrow(/아직 없는 대상입니다: mobile/)
  })

  it('고른 브라우저가 안 뜨면 다른 것(Chrome ↔ Edge) — 브라우저를 내려받지 않는다', async () => {
    const tried: string[] = []
    const launch: Launch = async ({ channel }) => {
      tried.push(channel)
      if (channel === 'msedge') throw new Error('Edge 없음')
      return fakeBrowser()
    }
    const driver = new WebDriver('msedge', launch)
    expect((await driver.check('http://a')).ok).toBe(true)
    expect(tried).toEqual(['msedge', 'chrome'])
    expect(driver.browserName()).toBe('Chrome (PC 설치본)')
    const none = new WebDriver('chrome', async () => Promise.reject(new Error('none')))
    await expect(none.check('http://a')).rejects.toThrow(/Chrome · Edge 를 띄우지 못했습니다/)
  })
})

function fakeBrowser(visible = true): BrowserLike {
  return { newContext: async () => ({ newPage: async () => fakePage(visible), close: async () => undefined }), close: async () => undefined }
}
