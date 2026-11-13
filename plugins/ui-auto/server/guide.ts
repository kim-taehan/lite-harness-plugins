// 테스트 가이드 — TC 하나를 사람이 따라 하는 문서. 보고서(보고용 증적)와 다른 형식이고, 내용 · 캡처는 그 TC 의 가장 새 「성공」 보고서에서 가져온다(LLM 없이).
// 구성은 ISO/IEC/IEEE 29119-3 의 테스트 절차 명세(목적 · 사전 조건 · 절차 단계(동작 · 입력 · 기대 결과) · 통과 기준 · 참조)를 사용자 안내 순서로 옮긴 것:
// 개요 → 1 목적 → 2 사전 준비 → 3 화면 들어가기 → 4 따라 하기(단계마다 할 일 · 확인할 것 · 화면) → 5 결과 확인(통과 기준) → 6 주의할 점 → 7 참고.
// 파일: guides/guide-<tc_id>.md — TC 마다 하나, 새 성공 수행이 있으면 다시 쓴다.

import path from 'node:path'
import { EVIDENCE_DIR, stamp, type Config } from './config.ts'
import type { Evidence } from './evidence.ts'
import { cellText, table } from './markdown.ts'
import { writeAtomic } from './render.ts'

export const guideId = (tc: string): string => `guide-${tc}`

/** 가이드 md — 쓰지 않고 글만 */
export async function guideMarkdown(config: Pick<Config, 'baseUrl'>, evidence: Evidence, tcId: string): Promise<{ id: string; text: string; run: string }> {
  const tc = await evidence.tc(tcId)
  if (!tc) throw new Error(`TC 를 찾지 못했습니다: ${tcId}`)
  const run = tc.runs.find((item) => item.verdict === '성공' && item.report)
  if (!run?.report) throw new Error(`${tcId} 는 성공한 수행 보고서가 없어 가이드를 만들 수 없습니다 — 먼저 수행하세요`)
  const report = await evidence.report(run.report)
  if (!report) throw new Error(`보고서를 읽지 못했습니다: ${run.report}`)
  const page = (await evidence.pages()).find((item) => item.id === tc.page)
  const lessons = table((await evidence.read('lessons-learned.md')) ?? '', '색인').filter((row) => row['id'] && (row['관련 page_id'] ?? '').includes(tc.page))
  const toGuide = (capture: string) => `../${capture}`
  const steps = report.steps.filter((step) => !/대상 페이지/.test(step.title))
  const verdictStep = steps.at(-1)
  const doing = steps.length > 1 ? steps.slice(0, -1) : steps
  const id = guideId(tcId)
  const title = `${tc.title} 테스트 가이드`
  const input = report.input.split('\n').map((line) => line.replace(/^-\s*/, '').trim()).filter((line) => line && line !== '없음')
  const lines = [
    '---',
    `guide_id: ${id}`,
    `title: ${title}`,
    `pages: [${tc.page}]`,
    `tcs: [${tcId}]`,
    `created: ${stamp().minute}`,
    `based_on: [${run.report}]`,
    '---',
    `# ${title}`,
    '',
    '| 항목 | 내용 |',
    '|---|---|',
    `| 대상 화면 | ${cellText(`${tc.pageTitle} (${tc.page})`)} |`,
    `| 테스트 케이스 | ${cellText(`${tcId} ${tc.title}`)} |`,
    `| 대상 시스템 | ${cellText(config.baseUrl || '-')} |`,
    `| 근거 수행 | ${run.report} (${report.head['일시'] ?? '-'}, ${report.head['판정'] ?? '성공'}) |`,
    `| 작성 | UI-AUTO 가 보고서 ${run.report} 로 작성 |`,
    '',
    '## 1. 목적',
    tc.detail['목적'] || tc.content,
    '',
    '## 2. 사전 준비',
    `- 접속 주소: ${config.baseUrl || '-'}`,
    '- 계정: 테스트 계정으로 로그인한 상태 (계정 값은 적지 않음)',
    `- 전제조건: ${tc.detail['전제조건'] || '없음'}`,
    `- 입력값: ${input.length ? input.join(', ') : '없음'}`,
    '',
    '## 3. 화면 들어가기',
    report.route || '-',
    '',
    ...(page?.hasCapture ? [`![${tc.pageTitle}](../captures/${tc.page}/page.png)`, ''] : []),
    '## 4. 따라 하기',
    ...doing.flatMap((step, index) => [
      `### ${index + 1}단계. ${step.action || step.title.replace(/^\d+\.\s*/, '')}`,
      ...(step.description ? [`- 이렇게 합니다: ${step.description}`] : []),
      `- 확인할 것: ${step.expected || '-'}`,
      `- 이렇게 보입니다: ${step.actual || '-'}`,
      ...(step.capture ? [`![${index + 1}단계](${toGuide(step.capture)})`] : []),
      '',
    ]),
    '## 5. 결과 확인',
    `- 기대 결과: ${report.expected || tc.detail['기대 결과'] || '-'}`,
    `- 통과 기준: ${verdictStep?.expected || report.basis || '-'}`,
    ...(verdictStep?.capture && doing !== steps ? [`![판정 화면](${toGuide(verdictStep.capture)})`] : []),
    '',
    '## 6. 주의할 점',
    ...(tc.notes.length || lessons.length
      ? [...tc.notes.map((note) => `- 확인 사항: ${note.question} → ${note.answer} (${note.date})`), ...lessons.map((row) => `- 교훈 ${row['id']}: ${row['한 줄 요약']}`)]
      : ['없음']),
    '',
    '## 7. 참고',
    `- 보고서: ${EVIDENCE_DIR}/reports/${run.report}.md`,
    `- 페이지 문서: ${EVIDENCE_DIR}/pages/${tc.page}.md`,
    ...(tc.script ? [`- 스크립트: ${EVIDENCE_DIR}/${tc.script} (${tc.scriptState})`] : []),
    '',
  ]
  return { id, text: lines.join('\n'), run: run.report }
}

export async function writeGuide(config: Config, evidence: Evidence, tcId: string): Promise<{ id: string; path: string; run: string }> {
  const { id, text, run } = await guideMarkdown(config, evidence, tcId)
  const relative = `guides/${id}.md`
  await writeAtomic(config, evidence.file(relative), text)
  return { id, path: path.posix.join(EVIDENCE_DIR, relative), run }
}
