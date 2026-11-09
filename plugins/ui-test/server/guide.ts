// 가이드형 결과물 — 수행 결과를 화면 흐름 순서로 풀어 쓴 한 파일 HTML(guide.html). 결과서(index.html)가 합격 · 실패를 표로 모아 보이는 문서라면,
// 이쪽은 "이 화면을 이렇게 쓰고, 이 단계에서 이렇게 된다"를 단계마다 화면 사진과 함께 이어 읽게 한다. 실패한 단계도 빼지 않고 원인과 같이 적는다.
// 결과서와 같은 입력(ReportInput)과 같은 스크린샷 예산을 쓰고, 비밀 값은 모든 글에서 scrub 으로 한 번 더 거른다.

import { scrub } from './config.ts'
import { FAIL_LABEL } from './failure.ts'
import { compareLine } from './history.ts'
import { budgetShots, esc, seconds, when } from './report.ts'
import type { ReportInput } from './report.ts'
import type { CaseResult, RunRecord, StepResult } from './types.ts'

const STYLE = `
:root{--bg:#f3f4f7;--paper:#fff;--soft:#f6f7f9;--text:#171b22;--sub:#5b6270;--line:#e1e5eb;--ok:#17803d;--ok-bg:#e5f5eb;--bad:#b3261e;--bad-bg:#fdecea;--db:#5b43b8;--db-bg:#efeafb;--accent:#2f4fd8}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--paper:#1b1f26;--soft:#20252d;--text:#e7eaf0;--sub:#a3abb8;--line:#2a303a;--ok:#5fd08a;--ok-bg:#16301f;--bad:#f2928b;--bad-bg:#3a1e1c;--db:#b29cf3;--db-bg:#2a2540;--accent:#8ea2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif}
article{max-width:780px;margin:28px auto;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:36px 40px;display:flex;flex-direction:column;gap:28px}
h1{margin:0;font-size:25px;letter-spacing:-.01em;line-height:1.3}
h2{margin:0;font-size:19px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h3{margin:14px 0 2px;font-size:15px;color:var(--sub)}
.lead{margin:6px 0 0;color:var(--sub)}
.meta{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:13px;color:var(--sub)}
.chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 10px;border-radius:99px;white-space:nowrap;line-height:1.7}
.ok{background:var(--ok-bg);color:var(--ok)}.bad{background:var(--bad-bg);color:var(--bad)}.db{background:var(--db-bg);color:var(--db)}.off{background:var(--soft);color:var(--sub)}
nav ol{margin:6px 0 0;padding-left:22px}
nav li{padding:2px 0}
nav a{color:var(--accent);text-decoration:none}
section{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:24px}
.prep{background:var(--soft);border-radius:8px;padding:10px 14px;font-size:13.5px;color:var(--sub)}
.prep ul{margin:4px 0 0;padding-left:18px}
ol.flow{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px;counter-reset:step}
ol.flow>li{counter-increment:step;display:grid;grid-template-columns:34px minmax(0,1fr);gap:12px}
ol.flow>li::before{content:counter(step);width:28px;height:28px;border-radius:50%;background:var(--soft);color:var(--sub);font-size:13px;font-weight:700;display:grid;place-items:center;margin-top:2px}
ol.flow>li.s-ok::before{background:var(--ok-bg);color:var(--ok)}
ol.flow>li.s-bad::before{background:var(--bad);color:#fff}
ol.flow>li.s-db::before{background:var(--db-bg);color:var(--db)}
.body{display:flex;flex-direction:column;gap:8px;min-width:0}
.line{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
figure{margin:0}
figure img{display:block;max-width:100%;width:520px;border:1px solid var(--line);border-radius:8px}
figure.fail img{border:2px solid var(--bad)}
figcaption{font-size:12.5px;color:var(--sub);margin-top:4px}
.err{background:var(--bad-bg);border-radius:8px;padding:10px 14px;font-size:14px;display:flex;flex-direction:column;gap:4px}
.err b{color:var(--bad)}
.err code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.note{font-size:13px;color:var(--sub)}
.s-skip .line{color:var(--sub)}
.issues{background:var(--bad-bg);border-radius:10px;padding:14px 18px}
.issues h2{font-size:17px;margin-bottom:6px}
.issues ul{margin:0;padding-left:20px}
footer{border-top:1px solid var(--line);padding-top:16px;font-size:12.5px;color:var(--sub);display:flex;flex-direction:column;gap:4px}
@media print{body{background:#fff}article{margin:0;border:0;padding:0;max-width:none}figure img{width:420px}}
@media (max-width:560px){article{padding:22px 18px}}
`

const CASE_CHIP: Record<CaseResult['status'], [string, string]> = { passed: ['성공', 'ok'], failed: ['실패', 'bad'], 'no-code': ['코드 없음', 'off'], stopped: ['멈춤', 'off'] }
const CHECK = /^확인(\(DB\))?\s*:\s*/

export function renderGuide(input: ReportInput): string {
  const { run } = input
  const clean = (text: string): string => esc(scrub(text, input.secrets))
  const allSteps = run.cases.flatMap((item) => [...item.steps, ...(item.rows ?? []).flatMap((row) => row.steps)])
  const cache = new Map<string, Uint8Array | undefined>()
  const bytesOf = (shot: string): Uint8Array | undefined => {
    if (!cache.has(shot)) cache.set(shot, input.image(shot))
    return cache.get(shot)
  }
  const { keep, dropped } = budgetShots(
    allSteps.flatMap((step) => [...(step.shot ? [{ name: step.shot, fail: false }] : []), ...(step.failShot ? [{ name: step.failShot, fail: true }] : [])]),
    (shot) => bytesOf(shot)?.length ?? 0,
    input.imageBudget,
  )
  const picture = (shot: string | undefined, fail: boolean, caption: string): string => {
    const bytes = shot && keep.has(shot) ? bytesOf(shot) : undefined
    return bytes ? `<figure class="${fail ? 'fail' : ''}"><img alt="${esc(caption)}" src="data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}"><figcaption>${esc(caption)}</figcaption></figure>` : ''
  }

  /** 단계 하나 — "1. 로그인한다" 의 번호는 목록 번호가 대신하고, "확인:" 은 말머리 칩으로 */
  const stepItem = (step: StepResult): string => {
    const raw = scrub(step.title, input.secrets).replace(/^\s*\d+\.\s*/, '')
    const check = CHECK.exec(raw)
    const text = esc(check ? raw.slice(check[0].length) : raw)
    const tone = step.status === 'passed' ? 's-ok' : step.status === 'failed' ? 's-bad' : step.status === 'db' ? 's-db' : 's-skip'
    const head = check ? `<span class="chip ${check[1] ? 'db' : 'off'}">${check[1] ? '확인(DB)' : '확인'}</span>` : ''
    const status =
      step.status === 'failed' ? '<span class="chip bad">실패</span>' : step.status === 'db' ? '<span class="chip db">대화에서만 확인</span>' : step.status === 'not-run' ? '<span class="chip off">수행하지 못함</span>' : ''
    const error = step.status === 'failed' ? `<div class="err"><b>${step.failKind ? FAIL_LABEL[step.failKind] : '실패'}</b>${step.error ? `<code>${clean(step.error)}</code>` : ''}</div>` : ''
    const shot = step.status === 'failed' ? picture(step.failShot ?? step.shot, true, '실패한 순간의 화면') : picture(step.shot, false, '이 단계를 마친 화면')
    return `<li class="${tone}"><div class="body"><div class="line">${head}<span>${text}</span>${status}</div>${shot}${error}</div></li>`
  }
  const flow = (steps: StepResult[]): string => (steps.length ? `<ol class="flow">${steps.map(stepItem).join('')}</ol>` : '<p class="note">이 케이스는 단계를 수행하지 못했습니다.</p>')

  const prepOf = (id: string): string => {
    const lines = (input.scenarios.get(id)?.method ?? []).map((line) => line.replace(/^\s*[-*]\s*/, '')).filter((line) => /^(사전 조건|입력 데이터)/.test(line))
    return lines.length ? `<div class="prep"><b>준비할 것</b><ul>${lines.map((line) => `<li>${clean(line)}</li>`).join('')}</ul></div>` : ''
  }

  const sections = run.cases
    .map((item, index) => {
      const [label, tone] = CASE_CHIP[item.status]
      const kind = input.scenarios.get(item.id)?.kind
      const body = item.rows
        ? item.rows
            .map((row) => {
              const [rowLabel, rowTone] = CASE_CHIP[row.status]
              return `<h3>${row.row}행 — ${clean(row.label)} <span class="chip ${rowTone}">${rowLabel}</span></h3>${flow(row.steps)}${row.error && !row.steps.some((step) => step.error) ? `<div class="err"><b>${row.failKind ? FAIL_LABEL[row.failKind] : '실패'}</b><code>${clean(row.error)}</code></div>` : ''}`
            })
            .join('\n')
        : flow(item.steps)
      const caseError = item.error && !item.rows && !item.steps.some((step) => step.error) ? `<div class="err"><b>${item.failKind ? FAIL_LABEL[item.failKind] : '실패'}</b><code>${clean(item.error)}</code></div>` : ''
      return `<section id="c${index}" aria-labelledby="h${index}"><h2 id="h${index}">${index + 1}. ${clean(item.title)} <span class="chip ${tone}">${label}</span></h2>
<div class="meta">${kind ? `<span>종류 ${clean(kind)}</span>` : ''}<span>${seconds(item.durationMs)}</span></div>
${prepOf(item.id)}
${body}
${caseError}</section>`
    })
    .join('\n')

  const issues = run.cases.flatMap((item) => {
    const failedStep = (steps: StepResult[], where: string): string[] =>
      steps.filter((step) => step.status === 'failed').map((step) => `${clean(where)} — ${clean(step.title.replace(/^\s*\d+\.\s*/, '').replace(CHECK, ''))} (${step.failKind ? FAIL_LABEL[step.failKind] : '실패'})`)
    return item.rows ? item.rows.flatMap((row) => failedStep(row.steps, `${item.title} ${row.row}행`)) : failedStep(item.steps, item.title)
  })

  const passed = run.cases.filter((item) => item.status === 'passed').length
  const failed = run.cases.filter((item) => item.status === 'failed').length
  const other = run.cases.length - passed - failed
  const toc = run.cases.map((item, index) => `<li><a href="#c${index}">${clean(item.title)}</a> <span class="chip ${CASE_CHIP[item.status][1]}">${CASE_CHIP[item.status][0]}</span></li>`).join('')
  const cmp = run.compare ? `<p class="note">지난 수행(${esc(run.compare.previousId)})과 비교: ${compareLine(run.compare)}</p>` : ''

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>화면 사용 가이드 — ${clean(input.suiteName)}</title>
<style>${STYLE}</style>
</head>
<body>
<article>
<header>
<h1>${clean(input.suiteName)} — 화면 사용 가이드</h1>
<p class="lead">이 화면을 실제로 따라 해 보며 단계마다 화면과 결과를 적은 문서입니다. 잘 된 단계는 초록, 실패한 단계는 붉게 표시하고 원인을 함께 적었습니다.</p>
<div class="meta"><span>${when(run.startedAt)} 수행 (${seconds(run.durationMs)})</span><span>${clean(run.baseUrl || '-')}</span><span>${clean(run.browser)}</span><span>수행자 ${clean(input.user)}</span></div>
<div class="meta" style="margin-top:6px"><span class="chip ok">성공 ${passed}</span><span class="chip bad">실패 ${failed}</span>${other ? `<span class="chip off">그 밖 ${other}</span>` : ''}</div>
${run.interrupted ? `<p class="note"><span class="chip bad">중단됨</span> ${clean(run.interrupted)} — 돈 데까지만 적었습니다.</p>` : ''}
${cmp}
</header>
<nav aria-label="목차"><b>이 문서의 순서</b><ol>${toc}</ol></nav>
${issues.length ? `<div class="issues" role="note"><h2>확인이 필요한 곳 ${issues.length}건</h2><ul>${issues.map((line) => `<li>${line}</li>`).join('')}</ul></div>` : ''}
${sections}
<footer>
<span>"대화에서만 확인" 단계(확인(DB):)는 수행기가 돌리지 않습니다 — 대화에서 DB 조회 도구로 확인합니다.</span>
<span>비밀번호 등 비밀 값은 이 문서에 넣지 않습니다. ${dropped ? `스크린샷 ${dropped} 장은 문서 크기(앱 미리보기 20MB) 때문에 뺐습니다 — 실패한 순간은 먼저 남깁니다.` : '스크린샷이 이 파일 하나에 모두 들어 있습니다'}</span>
<span>합격 · 불합격을 표로 모아 본 결과서는 같은 폴더의 <code>index.html</code> 입니다.</span>
</footer>
</article>
</body>
</html>
`
}

export type { RunRecord }
