// 증적 고치기 — AI 가 쓴 md 에서 고칠 줄만 바뀌는지 실제 페이지 문서로 본다
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cells, renderBody, section, table, updateRow } from '../server/markdown.ts'
import { appendHistory, applyRun, countsLine, historyCount, KEEP_HISTORY, touchMap, touchScript } from '../server/record.ts'
import { FIXTURE } from './helper.ts'

const doc = readFileSync(path.join(FIXTURE, 'pages/process-management-analyze.md'), 'utf8')
const map = readFileSync(path.join(FIXTURE, 'system_map.md'), 'utf8')
const entry = (run: string) => `### ${run} process-management-analyze-TC-001 (실패)\n- 수행 방식: 스크립트\n- 실제 결과: 다름`

describe('applyRun', () => {
  it('TC 줄의 세 칸과 수행 이력 맨 위 한 건만 바뀌고 나머지 줄은 그대로', () => {
    const out = applyRun(doc, { tc: 'process-management-analyze-TC-001', status: '실패', date: '2026-11-11', scriptState: '검증됨', entry: entry('20261111-001'), arrived: true })!
    const before = doc.split('\n')
    const after = out.text.split('\n')
    const changed = after.filter((line) => !before.includes(line))
    expect(changed).toEqual([
      'last_verified: 2026-11-11',
      expect.stringMatching(/^\| process-management-analyze-TC-001 \| .* \| 실패 \| 2026-11-11 \| scripts\/.* \| 검증됨 \|$/),
      '### 20261111-001 process-management-analyze-TC-001 (실패)',
      '- 수행 방식: 스크립트',
      '- 실제 결과: 다름',
    ])
    expect(before.filter((line) => !after.includes(line))).toEqual([expect.stringMatching(/^last_verified/), expect.stringMatching(/^\| process-management-analyze-TC-001/)])
    expect(section(out.text, '수행 이력')!.split('\n')[0]).toBe('### 20261111-001 process-management-analyze-TC-001 (실패)')
    expect(out.moved).toBe('')
  })

  it('표의 칸 안 \\| 는 칸을 나누지 않는다', () => {
    expect(cells('| main | 대시보드 | /ko | Title "대시보드 \\| Portal" |')).toEqual(['main', '대시보드', '/ko', 'Title "대시보드 | Portal"'])
    expect(table(map, '페이지 목록')[0]!['도착 확인 방법']).toContain('대시보드 | Portal')
    // 고친 줄은 다시 \| 로 적는다
    expect(updateRow(map, '페이지 목록', 'main', { '최근 확인일': '2026-11-11' })).toContain('"대시보드 \\| Portal"')
  })

  it('없는 TC 면 undefined — 파일을 건드리지 않는다', () => {
    expect(applyRun(doc, { tc: 'nope', status: '성공', date: '2026-11-11', scriptState: '검증됨', entry: entry('x'), arrived: true })).toBeUndefined()
  })

  it(`수행 이력이 ${KEEP_HISTORY}건을 넘으면 가장 옛 항목을 history 로 옮긴다`, () => {
    let text = doc
    let history: string | undefined
    for (let index = 1; index <= 10; index++) {
      const out = applyRun(text, { tc: 'process-management-analyze-TC-001', status: '성공', date: '2026-11-11', scriptState: '검증됨', entry: entry(`20261111-${String(index).padStart(3, '0')}`), arrived: false })!
      text = out.text
      if (out.moved) history = appendHistory(history, 'p', out.moved)
    }
    expect(historyCount(text)).toBe(KEEP_HISTORY)
    // 가장 옛 것부터 차례로 붙는다 — 항목 사이는 줄바꿈
    expect(history).toMatch(/^# p 수행 이력 \(옛 항목\)\n### 20261110-001 [\s\S]*검증됨\n### 20261110-002 /)
  })
})

describe('touch', () => {
  it('스크립트의 최근 통과일 줄만', () => {
    expect(touchScript('a: 1\n최근 통과일: 2026-11-10\nb: 2', '2026-11-11')).toBe('a: 1\n최근 통과일: 2026-11-11\nb: 2')
  })

  it('system_map — 페이지 · 이동의 확인일, 페이지 설명의 TC 건수 줄', () => {
    const out = touchMap(map, { page: 'process-management-analyze', edges: ['main__process-management-analyze'], date: '2026-11-11', statuses: ['성공', '실패'], arrived: true })
    expect(table(out, '페이지 목록')[1]!['최근 확인일']).toBe('2026-11-11')
    expect(table(out, '이동 관계')[0]).toMatchObject({ '최근 확인일': '2026-11-11', 상태: '유효' })
    expect(table(out, '이동 관계')[1]!['최근 확인일']).toBe('2026-11-10')
    expect(out).toContain('- 테스트 케이스: 2건 (성공 1, 실패 1)')
    expect(out.split('\n').length).toBe(map.split('\n').length)
    expect(countsLine(['미수행', '성공', '성공'])).toBe('3건 (성공 2, 미수행 1)')
  })
})

describe('renderBody', () => {
  it('### 덩어리는 section.step 으로 묶는다 — PDF 에서 캡처 단계마다 한 쪽', () => {
    const html = renderBody('## 캡처\n### 1. 클릭\n- 설명: 누릅니다\n![s](a.png)\n### 판정 화면\n![s](a.png)\n## 끝\n문단', () => 'data:image/png;base64,AA')
    expect(html.match(/<section class="step">/g)).toHaveLength(2)
    expect(html).toMatch(/<\/section>\n<h2>끝<\/h2>/)
    expect(html.indexOf('<section')).toBeGreaterThan(html.indexOf('<h2>캡처'))
  })

  it('AI 가 쓴 태그는 글자로, 이미지는 허락한 것만', () => {
    const html = renderBody('# 제목 <script>x</script>\n\n| a | b |\n|---|---|\n| <b>1</b> | 2 |\n\n![s](ok.png)\n![t](no.png)', (src) => (src === 'ok.png' ? 'data:image/png;base64,AA' : undefined))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&#60;script&#62;')
    expect(html).toContain('<td>&#60;b&#62;1&#60;/b&#62;</td>')
    expect(html).toContain('<img alt="s" src="data:image/png;base64,AA">')
    expect(html).toContain('캡처 없음: no.png')
  })
})
