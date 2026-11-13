// 패널 수행 — 가짜 브라우저(도구 결과를 정해 둔 것)로 재생 순서 · 판정 · 증적 기록을 본다. 진짜 Playwright MCP + Chrome 은 e2e.test.ts
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Browser, ToolResult } from '../server/browser.ts'
import type { Config } from '../server/config.ts'
import { Evidence } from '../server/evidence.ts'
import { section, table } from '../server/markdown.ts'
import { entryUrl, explain, fill, judge, marksOf, resolveData, Replayer, screenOf } from '../server/replay.ts'
import { project } from './helper.ts'

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const err = (text: string): ToolResult => ({ content: [{ type: 'text', text: `### Error\nError: ${text}` }], isError: true })
const PAGE = '### Page\n- Page URL: https://portal.example.test/ko/process-management/analyze/41715\n- Page Title: 요구사항 정의 | Portal'

/** 도구 이름 → 결과. calls 에 부른 순서 */
function fakeBrowser(answer: (name: string, args: Record<string, unknown>) => ToolResult) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  let held = false
  const browser = {
    take: () => (held ? false : (held = true)),
    release: () => void (held = false),
    closeWindow: async () => void calls.push({ name: 'browser_close', args: {} }),
    call: async (name: string, args: Record<string, unknown>) => (calls.push({ name, args }), answer(name, args)),
  }
  return { browser: browser as unknown as Browser, calls }
}
const happy = (name: string): ToolResult => (name === 'browser_find' ? ok('### Result\nFound 2 matches for "x"') : name === 'browser_take_screenshot' ? ok('### Result\n- [Screenshot]') : name === 'browser_evaluate' ? ok('### Result\ntrue') : ok(PAGE))

async function run(config: Config, browser: Browser, tcs: string[]) {
  let n = 0
  const replayer = new Replayer(config, new Evidence(config.evidenceDir), browser, async () => `20261111-${String(++n).padStart(3, '0')}`, async () => '로그인했습니다')
  const started = replayer.start(tcs)
  if (!started.started) throw new Error(started.reason)
  await started.done
  return replayer.progress()
}
const read = (config: Config, file: string) => readFileSync(path.join(config.evidenceDir, file), 'utf8')

describe('Replayer', () => {
  it('성공 — 진입점 · 이동 스크립트 · 단계마다 그 단계 바로 전 표시 캡처 · 판정 뒤 증적을 AI 와 같은 형식으로 남긴다', async () => {
    const config = project()
    const { browser, calls } = fakeBrowser(happy)
    const progress = await run(config, browser, ['process-management-analyze-TC-001'])
    expect(progress.cases).toEqual([expect.objectContaining({ tc: 'process-management-analyze-TC-001', run: '20261111-001', state: '성공' })])
    // TC 마다의 작업 기록 — 패널이 TC 별로 접어 보인다
    expect(progress.cases[0]!.lines?.[0]).toMatch(/^\[skill\] 패널 수행 로드/)
    expect(progress.cases[0]!.lines?.at(-1)).toMatch(/^\[tool\] browser_close|^\[판정\]/)
    expect(calls.map((call) => call.name)).toEqual([
      'browser_navigate', // 진입점
      'browser_navigate', 'browser_find', // 이동 스크립트 + 도착 확인
      // 단계마다 — 표시 그리기 · 캡처 · 표시 지우기 · 동작
      'browser_evaluate', 'browser_take_screenshot', 'browser_evaluate', 'browser_click',
      'browser_evaluate', 'browser_take_screenshot', 'browser_evaluate', 'browser_type',
      'browser_evaluate', 'browser_take_screenshot', 'browser_evaluate', 'browser_click',
      'browser_wait_for', 'browser_find', 'browser_take_screenshot', // 판정 두 줄 + 판정 화면(표시 없음)
      'browser_close', 'browser_close',
    ])
    expect(calls[0]!.args).toEqual({ url: 'https://portal.example.test/ko' })
    expect(calls[10]!.args['text']).toBe('요구사항 추가 테스트')
    expect(calls[3]!.args).toMatchObject({ target: "getByRole('button', { name: '추가하기' })", element: '추가하기 버튼' })
    expect(calls[3]!.args['function']).toContain('"1"')
    expect(calls[5]!.args['function']).toContain('data-ui-auto-mark')
    expect(calls[4]!.args['filename']).toBe('.litecode/ui-auto/captures/process-management-analyze/20261111-001-process-management-analyze-TC-001-step01.png')

    const doc = read(config, 'pages/process-management-analyze.md')
    expect(table(doc, '테스트 케이스')[0]).toMatchObject({ 상태: '성공', '최근 수행일': expect.stringMatching(/^\d{4}-\d\d-\d\d$/), '스크립트 상태': '검증됨' })
    expect(section(doc, '수행 이력')!.split('\n')[0]).toBe('### 20261111-001 process-management-analyze-TC-001 (성공)')
    expect(doc).toContain('- 수행: UI-AUTO 패널 (LLM 없이 스크립트 재생)')

    const report = read(config, 'reports/20261111-001.md')
    expect(report).toMatch(/^# 테스트 수행 보고서 20261111-001\n/)
    expect(report).toContain('| 판정 | 성공 |')
    expect(report).toContain('### 1. "추가하기 버튼" 클릭\n- 설명: ① 「추가하기 버튼」을 누릅니다.\n![step01](../captures/process-management-analyze/20261111-001-process-management-analyze-TC-001-step01.png)\n- 한 일: "추가하기 버튼" 클릭\n- 기대: 오류 없이 수행\n- 실제: 오류 없이 끝남 · 화면 "요구사항 정의 | Portal" /ko/process-management/analyze/41715\n- 판정: 수행됨')
    expect(report).toMatch(/### 판정 화면\n- 설명: 모든 단계를 마친 뒤의 화면입니다\. 확인: .*\n.*\n- 한 일: 판정 — browser_wait_for\(요구사항명을 입력해주세요\), browser_find\(요구사항 추가 테스트\)\n- 기대: 오류 없이 끝남 \(다이얼로그 닫힘 = 저장 성공\) \/ 요구사항 목록 .*\n- 실제: 오류 없이 끝남 \/ 2건 일치 \(기대 >=1\)\n- 판정: 일치/)

    const log = read(config, 'logs/20261111-001.md')
    for (const tag of ['[skill]', '[증적 조회]', '[경로]', '[활용 단계]', '[증적 활용]', '[tool] browser_click', '[스크립트]', '[증적 갱신]', '[판정] process-management-analyze-TC-001 — 성공']) expect(log).toContain(tag)
    expect(log).toContain('## 요약\n| 참고한 증적 | 새로 만든 증적 | 갱신한 증적 | 증적 덕분에 생략한 작업 |')
    expect(read(config, 'scripts/process-management-analyze/process-management-analyze-TC-001.yaml')).toMatch(/^최근 통과일: \d{4}-\d\d-\d\d$/m)
  })

  it('판정이 안 맞으면 실패 — 스크립트 상태는 그대로', async () => {
    const config = project()
    let finds = 0
    const { browser } = fakeBrowser((name) => (name === 'browser_find' ? (++finds === 1 ? ok('Found 1 match') : ok('### Result\nNo matches found for "x".')) : ok(PAGE)))
    const progress = await run(config, browser, ['process-management-analyze-TC-002'])
    expect(progress.cases[0]).toMatchObject({ state: '실패' })
    const doc = read(config, 'pages/process-management-analyze.md')
    expect(table(doc, '테스트 케이스')[1]).toMatchObject({ 상태: '실패', '스크립트 상태': '미검증' })
    expect(read(config, 'reports/20261111-001.md')).toContain('- 판정: 다름')
  })

  it('단계 오류는 차단(스크립트 불일치) — 멈춘 화면을 찍고 이후 단계는 부르지 않는다', async () => {
    const config = project()
    const { browser, calls } = fakeBrowser((name, args) => (name === 'browser_click' && String(args['target']).includes('추가하기') ? err(`"getByRole('button', { name: '추가하기' })" does not match any elements.`) : happy(name)))
    const progress = await run(config, browser, ['process-management-analyze-TC-001'])
    expect(progress.cases[0]).toMatchObject({ state: '차단', reason: '1단계 수행 오류 (스크립트 불일치)' })
    expect(calls.filter((call) => call.name === 'browser_type')).toEqual([])
    const report = read(config, 'reports/20261111-001.md')
    expect(report).toContain('- 판정: 멈춤')
    expect(report).toContain('### 멈춘 뒤 화면\n- 설명: 1단계에서 오류가 난 뒤의 화면입니다.\n![step02]')
    expect(report).toContain('- 불일치: 스크립트 1단계')
    expect(read(config, 'logs/20261111-001.md')).toContain('[불일치]')
  })

  it('수행할 수 없는 TC 는 건너뛰고 기록하지 않는다', async () => {
    const config = project()
    const { browser, calls } = fakeBrowser(happy)
    const progress = await run(config, browser, ['nope-TC-001'])
    expect(progress.cases[0]).toMatchObject({ state: '건너뜀', reason: '페이지 문서에 없는 TC' })
    expect(progress.cases[0]!.lines).toEqual(['[건너뜀] 페이지 문서에 없는 TC'])
    expect(calls.filter((call) => call.name !== 'browser_close')).toEqual([])
    expect(existsSync(path.join(config.evidenceDir, 'reports/20261111-001.md'))).toBe(false)
  })

  it('브라우저를 AI 가 쥐고 있으면 시작하지 않는다', () => {
    const config = project()
    const { browser } = fakeBrowser(happy)
    browser.take()
    const replayer = new Replayer(config, new Evidence(config.evidenceDir), browser, async () => 'x')
    expect(replayer.start(['a'])).toEqual({ started: false, reason: 'browser-busy' })
  })
})

describe('순수', () => {
  it('치환 · testdata · 판정 · 진입 주소', () => {
    expect(fill({ a: '{x} {y}', b: ["getByRole('button', { name: '{x}' })"] }, { x: '1' })).toEqual({ a: '1 {y}', b: ["getByRole('button', { name: '1' })"] })
    expect(resolveData({ c: '$NAME', d: '{c}!' }, { NAME: '홍길동' })).toEqual({ vars: { c: '홍길동', d: '홍길동!' }, shown: ['c=홍길동 (testdata: NAME)', 'd=홍길동!'] })
    expect(() => resolveData({ c: '$NOPE' }, {})).toThrow('testdata.md')
    expect(judge({ tool: 'browser_find', args: {} }, ok('No matches found'), {}).pass).toBe(false)
    expect(judge({ tool: 'browser_find', args: {}, expect: { found: '0' } }, ok('No matches found'), {}).pass).toBe(true)
    expect(judge({ tool: 'browser_evaluate', args: {}, expect: { equals: '{n}' } }, ok('### Result\n"3"\n### Ran'), { n: '3' }).pass).toBe(true)
    expect(judge({ tool: 'browser_wait_for', args: {} }, err('timeout'), {}).pass).toBe(false)
    expect(entryUrl('https://a.test/ko 로 이동 (로그인)', 'https://b.test')).toBe('https://a.test/ko')
    expect(entryUrl('/ko 로 이동', 'https://b.test')).toBe('https://b.test/ko')
    expect(screenOf(PAGE)).toBe('오류 없이 끝남 · 화면 "요구사항 정의 | Portal" /ko/process-management/analyze/41715')
  })

  it('표시할 요소 · 설명 문장', () => {
    expect(marksOf({ tool: 'browser_click', args: { element: '저장', target: "getByRole('button')" } })).toEqual([{ target: "getByRole('button')", element: '저장' }])
    expect(marksOf({ tool: 'browser_fill_form', args: { fields: [{ name: '이름', target: 'a' }, { name: '메일', target: 'b' }] } })).toEqual([{ target: 'a', element: '이름' }, { target: 'b', element: '메일' }])
    expect(marksOf({ tool: 'browser_press_key', args: { key: 'Enter' } })).toEqual([])
    expect(explain({ tool: 'browser_type', args: { element: '프로그램명 입력란', text: '{n}' }, expected: '입력란에 "{n}" 표시' }, { n: '테스트' }, 2, true)).toBe('② 「프로그램명 입력란」에 "테스트"를 입력합니다. 확인: 입력란에 "테스트" 표시')
    expect(explain({ tool: 'browser_click', args: { element: '저장하기' } }, {}, 3, false)).toBe('「저장하기」를 누릅니다.')
  })
})
