// 증적 읽기 — 실제 증적(fixtures)으로 패널이 받는 모양을 본다
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Evidence, evidencePath, failReason, judgeable, trendOf } from '../server/evidence.ts'
import { writeGuide } from '../server/guide.ts'
import { project } from './helper.ts'

const NOW = () => new Date('2026-11-11T10:00:00')

describe('Evidence', () => {
  const config = project()
  const evidence = new Evidence(config.evidenceDir, NOW)

  it('system_map 의 페이지와 페이지 문서의 TC 표를 읽는다', async () => {
    const pages = await evidence.pages()
    expect(pages.map((page) => page.id)).toEqual(['main', 'process-management-analyze', 'process-management-systemdesign'])
    const analyze = pages[1]!
    expect(analyze).toMatchObject({ title: '요구사항 정의', urlPattern: '/ko/process-management/analyze/*', stale: false, hasCapture: true, entry: false, runCount: 2, counts: { 성공: 2 } })
    expect(pages[0]!.entry).toBe(true)
    expect(analyze.tcs.map((tc) => [tc.id, tc.status, tc.scriptState, tc.runCount, tc.script])).toEqual([
      ['process-management-analyze-TC-001', '성공', '검증됨', 1, 'scripts/process-management-analyze/process-management-analyze-TC-001.yaml'],
      ['process-management-analyze-TC-002', '성공', '미검증', 1, 'scripts/process-management-analyze/process-management-analyze-TC-002.yaml'],
    ])
  })

  it('30일이 지난 확인일은 오래된 정보', async () => {
    const later = new Evidence(config.evidenceDir, () => new Date('2027-01-05T00:00:00'))
    expect((await later.pages()).every((page) => page.stale)).toBe(true)
  })

  it('TC 상세 · 확인 사항 · 수행 이력 · 스크립트 단계', async () => {
    const tc = await evidence.tc('process-management-analyze-TC-002')
    expect(tc?.detail['기대 결과']).toContain('요구사항 수정 테스트')
    expect(tc?.notes.map((note) => note.target)).toEqual(['process-management-analyze', 'process-management-analyze-TC-002'])
    expect(tc?.runs).toEqual([expect.objectContaining({ run: '20261110-002', verdict: '성공', report: '20261110-002' })])
    expect(tc?.steps[0]).toEqual({ kind: 'route', tool: 'route', label: 'process-management-analyze 로 이동', target: 'scripts/routes/main__process-management-analyze.yaml' })
    expect(tc?.steps.filter((step) => step.kind === 'step')).toHaveLength(6)
    expect(tc?.steps.at(-1)).toMatchObject({ kind: 'verify', target: 'browser_find · found ≥ 1' })
    expect(tc?.steps[1]?.label).toBe('"요구사항 추가 테스트 요구사항 행의 요구사항명 셀" 클릭')
  })

  it('옛 스크립트(expect 없음)도 browser_find 는 1건 이상으로 판정할 수 있어 패널에서 수행된다', async () => {
    const tc = (await evidence.pages())[2]!.tcs[0]!
    expect(await evidence.runnable(tc)).toEqual({ ok: true })
    expect(judgeable({ tool: 'browser_evaluate', args: {} })).toBe(false)
    expect(judgeable({ tool: 'browser_evaluate', args: {}, expect: { equals: '1' } })).toBe(true)
  })

  it('스크립트가 없거나 깨졌으면 이유를 돌려준다', async () => {
    expect(await evidence.runnable({ id: 'x', page: 'p', content: '', status: '미수행', scriptState: '없음', runCount: 0 })).toEqual({ ok: false, why: '스크립트 없음' })
    expect(await evidence.runnable({ id: 'x', page: 'p', content: '', status: '미수행', scriptState: '미검증', script: 'scripts/none.yaml', runCount: 0 })).toMatchObject({ ok: false })
  })

  it('흐름 지도 — 노드(캡처 · 최악 판정) 와 이동', async () => {
    const flow = await evidence.flow(await evidence.pages())
    expect(flow.nodes.map((node) => [node.id, node.entry, node.capture, node.worst])).toEqual([
      ['main', true, undefined, ''],
      ['process-management-analyze', false, 'captures/process-management-analyze/page.png', '성공'],
      ['process-management-systemdesign', false, 'captures/process-management-systemdesign/page.png', '성공'],
    ])
    expect(flow.edges.map((edge) => [edge.from, edge.to, edge.action, edge.state])).toEqual([
      ['main', 'process-management-analyze', 'URL 이동', '유효'],
      ['main', 'process-management-systemdesign', 'URL 이동', '유효'],
    ])
  })

  it('보고서 — 머리 표 · 절 · 캡처마다 제목과 이미지(옛 형식은 한 일 · 기대 · 실제가 비어 있다)', async () => {
    const report = await evidence.report('20261110-002')
    expect(report?.head).toMatchObject({ 판정: '성공', '수행 방식': '이동 스크립트+MCP' })
    expect(report?.route).toContain('main → process-management-analyze')
    expect(report?.steps).toHaveLength(7)
    expect(report?.steps[0]).toEqual({ title: '대상 페이지 (수행 전)', capture: 'captures/process-management-analyze/page.png', action: '', expected: '', actual: '', verdict: '' })
    expect(await evidence.report('../system_map')).toBeUndefined()
    expect((await evidence.reports()).map((item) => [item.id, item.tc, item.verdict])).toEqual([
      ['20261110-003', 'process-management-systemdesign-TC-001', '성공'],
      ['20261110-002', 'process-management-analyze-TC-002', '성공'],
      ['20261110-001', 'process-management-analyze-TC-001', '성공'],
    ])
  })

  it('기록의 경로 앞머리를 떼고, 증적 폴더 밖은 거절한다', () => {
    expect(evidencePath('evidence/reports/1.md')).toBe('reports/1.md')
    expect(evidencePath('.litecode/ui-auto/reports/1.md')).toBe('reports/1.md')
    expect(() => evidence.file('../x')).toThrow()
  })
})

describe('지난 수행과 비교 · 원인 · 지난 성공 · 가이드', () => {
  const TC = 'process-management-analyze-TC-001'
  /** 성공(20261110-001) 다음에 실패 · 차단이 한 번씩 — 보고서와 페이지 문서의 수행 이력에 */
  function failing() {
    const config = project()
    const dir = config.evidenceDir
    const base = readFileSync(path.join(dir, 'reports/20261110-001.md'), 'utf8')
    const head = (id: string, verdict: string) => base.replace('20261110-001', id).replace('| 판정 | 성공 |', `| 판정 | ${verdict} |`).replace('| 일시 | 2026-11-10 15:42 |', `| 일시 | 2026-11-11 ${id.endsWith('1') ? '10:00' : '11:00'} |`)
    const captures = (steps: string) => `## 캡처\n### 대상 페이지 (수행 전)\n![p](../captures/process-management-analyze/page.png)\n\n${steps}\n## 불일치·확인 사항`
    const swap = (text: string, steps: string) => text.replace(/## 캡처[\s\S]*?## 불일치·확인 사항/, captures(steps))
    writeFileSync(path.join(dir, 'reports/20261111-001.md'), swap(head('20261111-001', '실패'), '### 1. "추가하기" 클릭\n- 한 일: "추가하기" 클릭\n- 판정: 수행됨\n\n### 판정 화면 (기대와 다름)\n![s](../captures/process-management-analyze/20261110-001-process-management-analyze-TC-001-step03.png)\n- 한 일: 판정\n- 기대: 목록에 1건 이상\n- 실제: 0건 일치 (기대 >=1)\n- 판정: 다름\n'))
    writeFileSync(path.join(dir, 'reports/20261111-002.md'), swap(head('20261111-002', '차단'), '### 1. "추가하기" 클릭\n- 판정: 수행됨\n\n### 2. 요구사항명 입력 — 멈춘 화면\n- 한 일: 요구사항명 입력\n- 기대: 입력됨\n- 실제: 오류: 요소 없음\n- 판정: 멈춤\n'))
    const doc = path.join(dir, 'pages/process-management-analyze.md')
    writeFileSync(doc, readFileSync(doc, 'utf8').replace('## 수행 이력 (최근 10건)\n', `## 수행 이력 (최근 10건)\n### 20261111-002 ${TC} (차단)\n- 수행 방식: 스크립트\n### 20261111-001 ${TC} (실패)\n- 수행 방식: 스크립트\n`))
    return { config, evidence: new Evidence(dir, NOW) }
  }

  it('trendOf — 새로 실패 · 계속(연달아 몇 번) · 고쳐짐', () => {
    expect(trendOf([])).toBeUndefined()
    expect(trendOf(['실패'])).toEqual({ kind: 'new' })
    expect(trendOf(['차단', '성공'])).toEqual({ kind: 'new' })
    expect(trendOf(['차단', '실패', '실패', '성공'])).toEqual({ kind: 'still', count: 3 })
    expect(trendOf(['성공', '차단'])).toEqual({ kind: 'fixed' })
    expect(trendOf(['성공', '성공'])).toBeUndefined()
  })

  it('보고서 목록 — 원인 한 줄과 같은 TC 의 바로 전 판정과 비교, TC 줄에도 흐름', async () => {
    const { evidence } = failing()
    const reports = await evidence.reports()
    expect(reports.slice(0, 2).map((item) => [item.id, item.verdict, item.reason, item.trend])).toEqual([
      ['20261111-002', '차단', '2단계 요구사항명 입력에서 멈춤', { kind: 'still', count: 2 }],
      ['20261111-001', '실패', '판정 다름 — 0건 일치 (기대 >=1)', { kind: 'new' }],
    ])
    expect(reports.find((item) => item.id === '20261110-001')).not.toHaveProperty('trend')
    const tc = (await evidence.pages())[1]!.tcs.find((item) => item.id === TC)
    expect(tc?.trend).toEqual({ kind: 'still', count: 2 })
    expect(failReason((await evidence.report('20261110-001'))!)).toBeUndefined()
  })

  it('지난 성공 — 같은 TC 의 앞선 가장 새 성공 보고서', async () => {
    const { evidence } = failing()
    expect((await evidence.previousPass('20261111-002'))?.id).toBe('20261110-001')
    expect(await evidence.previousPass('20261110-001')).toBeUndefined()
  })

  it('가이드 — 개요 표 · 절 · 따라 하기 단계와 캡처(증적 폴더 기준)', async () => {
    const config = project()
    const evidence = new Evidence(config.evidenceDir, NOW)
    const made = await writeGuide(config, evidence, TC)
    const view = await evidence.guide(made.id)
    expect(view?.head['대상 화면']).toContain('process-management-analyze')
    expect(view?.sections.map((part) => part.title)).toEqual(['1. 목적', '2. 사전 준비', '3. 화면 들어가기', '4. 따라 하기', '5. 결과 확인', '6. 주의할 점', '7. 참고'])
    const follow = view!.sections[3]!.items
    expect(follow[0]).toMatchObject({ kind: 'step', title: '1단계. "추가하기" 클릭', capture: 'captures/process-management-analyze/20261110-001-process-management-analyze-TC-001-step01.png' })
    expect(view!.sections[2]!.items.some((item) => item.kind === 'image' && item.capture === 'captures/process-management-analyze/page.png')).toBe(true)
    expect(await evidence.guide('../x')).toBeUndefined()
  })
})

describe('lenientYaml', () => {
  it('따옴표로 시작해 글이 더 붙은 값 줄을 고쳐 읽는다', async () => {
    const { lenientYaml } = await import('../server/evidence.ts')
    const text = 'steps:\n  - tool: browser_click\n    args:\n      target: "getByRole(\'button\', { name: \'추가하기\' })"\n    expected: "요구사항 정의 등록" 대화상자 표시\n'
    expect(lenientYaml(text)).toEqual({ steps: [{ tool: 'browser_click', args: { target: "getByRole('button', { name: '추가하기' })" }, expected: '"요구사항 정의 등록" 대화상자 표시' }] })
    expect(() => lenientYaml('a: [1, 2')).toThrow()
    // 값이 `-` 하나뿐인 줄은 목록 시작으로 읽혀 깨진다 — 글자 '-' 로
    expect(lenientYaml('tc_id: x\n최근 통과일: -\nsteps: []\n')).toEqual({ tc_id: 'x', '최근 통과일': '-', steps: [] })
    // 같은 키를 끝에 한 번 더 쓴 것 — 뒤의 값
    expect(lenientYaml('최근 통과일: -\nsteps: []\n최근 통과일: 2026-11-12\n')).toEqual({ '최근 통과일': '2026-11-12', steps: [] })
  })

  it('TC 상세 — 들여 쓴 절차 줄은 한 값으로, 스크립트 칸 「없음」 은 스크립트 없음', async () => {
    const { fields } = await import('../server/markdown.ts')
    const { tcRows } = await import('../server/evidence.ts')
    expect(fields(['- 제목: 신규 등록', '- 절차:', '  1. "추가하기" 클릭', '  2. 이름 입력', '- 기대 결과: 목록에 1건'])).toEqual({ 제목: '신규 등록', 절차: '1. "추가하기" 클릭\n2. 이름 입력', '기대 결과': '목록에 1건' })
    const doc = '## 테스트 케이스\n| tc_id | 내용 | 상태 | 최근 수행일 | 스크립트 | 스크립트 상태 |\n|---|---|---|---|---|---|\n| p-TC-002 | 비우고 저장 | 미수행 | - | 없음 | 없음 |\n'
    expect(tcRows(doc, 'p')[0]).not.toHaveProperty('script')
  })
})
