// 수행 결과서 (#1248, 계획 §2-4 · 시안 ③) — index.html 한 파일, 스크린샷은 파일 안에(data: URL), 인쇄하면 PDF 결과서.
// 머리(프로젝트 · 대상 주소 · 브라우저 · 시각 · 수행자 · 성공/실패 · 실패 시나리오 링크 · 지난 수행과 비교) → 요약 목록 → 시나리오마다 단계 줄 · 오류 · 테스트 방법 → 무엇을 돌렸나. 시안 v3: 카드 · 라이트/다크 · 좁은 폭은 표 없이 줄로.
// 비밀 값은 넣지 않는다 — 모든 글을 scrub 으로 한 번 더 거른다.
// 2 단계: 데이터 표 시나리오는 행마다 결과 하나 · 실패 갈래 · 스크린샷 예산(앱의 HTML 미리보기 한도 20MB 안에 들게 — 넘치면 실패 순간을 먼저 남기고 단계 끝 사진을 뺀다)

import { scrub } from './config.ts'
import { FAIL_LABEL } from './failure.ts'
import { compareLine } from './history.ts'
import type { CaseResult, FailKind, RunRecord, Scenario, StepResult, StepStatus } from './types.ts'

/** 결과서에 넣는 스크린샷 바이트의 합 상한 — base64 로 1.33배가 되어 약 17MB, 앱 파일 미리보기의 HTML 한도(HTML_PREVIEW_LIMIT 20MB) 안 */
export const REPORT_IMAGE_BUDGET = 13 * 1024 * 1024

/** 넣을 스크린샷 고르기 — 실패 순간을 먼저, 그다음 단계 끝 사진을 차례로, 합이 예산을 넘는 것은 뺀다 */
export function budgetShots(shots: { name: string; fail: boolean }[], size: (name: string) => number, budget = REPORT_IMAGE_BUDGET): { keep: Set<string>; dropped: number } {
  const keep = new Set<string>()
  let used = 0
  let dropped = 0
  for (const shot of [...shots.filter((item) => item.fail), ...shots.filter((item) => !item.fail)]) {
    const bytes = size(shot.name)
    if (bytes === 0 || keep.has(shot.name)) continue
    if (used + bytes > budget) {
      dropped++
      continue
    }
    used += bytes
    keep.add(shot.name)
  }
  return { keep, dropped }
}

export interface ReportInput {
  run: RunRecord
  project: string
  suiteName: string
  user: string
  /** 시나리오 id → 시나리오 (원문 · 테스트 방법 · 종류) */
  scenarios: Map<string, Scenario>
  /** 시나리오 · 생성 코드 위치 (프로젝트 기준) */
  files: { scenario: string; spec: string }[]
  /** 수행 폴더 기준 스크린샷 경로 → jpeg 바이트 (없으면 빈 칸) */
  image: (shot: string) => Uint8Array | undefined
  secrets: string[]
  /** 스크린샷 예산 (시험용) */
  imageBudget?: number
}

export const esc = (text: string): string => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}초`
const pad = (value: number): string => String(value).padStart(2, '0')
export const when = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const CASE_LABEL: Record<CaseResult['status'], [string, string]> = { passed: ['성공', 'ok'], failed: ['실패', 'bad'], 'no-code': ['코드 없음', 'off'], stopped: ['멈춤', 'off'] }
const STEP_LABEL: Record<StepStatus, [string, string]> = { passed: ['✓', 'ok'], failed: ['✕', 'bad'], db: ['대화에서만 확인', 'db'], 'not-run': ['수행 안 함', 'off'] }

// 토큰은 .rp(감싸는 요소)에만 둔다 — :root · body 에 기대지 않아 패널의 Shadow DOM 에서도 같은 모양으로 열린다
const LIGHT = `--paper:#eef0f4;--sheet:#fff;--well:#f5f6f9;--rule:rgba(20,28,46,.10);--rule-strong:rgba(20,28,46,.18);--ink:#141a29;--ink-2:#566077;--ink-3:#6b7489;--probe:#2d4fd6;--probe-wash:#eef1fd;--pass:#167a3f;--pass-wash:#e4f5ea;--bad:#c0332b;--bad-wash:#fdecea;--bad-ring:rgba(192,51,43,.34)`
const DARK = `--paper:#0e1118;--sheet:#161b26;--well:#1b2130;--rule:rgba(255,255,255,.08);--rule-strong:rgba(255,255,255,.16);--ink:#e9ecf4;--ink-2:#a2abc0;--ink-3:#8791a8;--probe:#8fa4ff;--probe-wash:#1f2745;--pass:#63d28f;--pass-wash:#15301f;--bad:#f2928b;--bad-wash:#3a1e1c;--bad-ring:rgba(242,146,139,.38)`
const STYLE = `
.rp{${LIGHT}}
@media (prefers-color-scheme:dark){.rp:not([data-theme=light]){${DARK}}}
.rp[data-theme=dark]{${DARK}}
.rp{container-type:inline-size;background:var(--paper);color:var(--ink);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:24px 16px 40px}
.rp *{box-sizing:border-box}
.rp [hidden]{display:none!important}
.doc{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.card{background:var(--sheet);border-radius:12px;box-shadow:0 0 0 1px var(--rule);padding:20px 22px}
.card.bad{box-shadow:0 0 0 1.5px var(--bad-ring)}
h1{margin:0;font-size:19px;line-height:1.3;font-weight:700;letter-spacing:-.018em;text-wrap:balance}
h2{margin:0;font-size:14.5px;line-height:1.35;font-weight:650;text-wrap:balance}
.lbl{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3)}
code,pre,.mono{font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.num{font-variant-numeric:tabular-nums}
/* 칩 */
.st{display:inline-block;font-size:11.5px;line-height:18px;padding:0 9px;border-radius:99px;font-weight:600;white-space:nowrap;background:var(--well);color:var(--ink-2);box-shadow:inset 0 0 0 1px var(--rule)}
.st.ok{background:var(--pass-wash);color:var(--pass);box-shadow:none}.st.bad{background:var(--bad-wash);color:var(--bad);box-shadow:none}.st.db{background:var(--probe-wash);color:var(--probe);box-shadow:none}
.st.lg{font-size:12.5px;line-height:22px;padding:0 11px}
/* 머리 */
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 24px;margin:18px 0 0;padding:18px 0 0;border-top:1px solid var(--rule)}
.info div{min-width:0}
.info dt{font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink-3);margin-bottom:2px}
.info dd{margin:0;overflow-wrap:anywhere;text-wrap:pretty}
.info dd small{color:var(--ink-3);font-size:12px}
.info .tally{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.info .tally span.all{color:var(--ink-2);font-size:12.5px;margin-left:2px}
.fails{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 14px;margin-top:18px;padding:10px 14px;border-radius:8px;background:var(--bad-wash)}
.fails b{color:var(--bad);font-weight:650;white-space:nowrap}
.fails ul{display:flex;flex-wrap:wrap;gap:0 16px;margin:0;padding:0;list-style:none}
.fails a{display:inline-block;padding:5px 0;color:var(--ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--bad-ring);text-underline-offset:3px;border-radius:4px}
.fails a:hover{text-decoration-color:var(--bad)}
.fails a .no{color:var(--ink-3);font-weight:500;margin-right:5px}
.cmp{margin:16px 0 0;padding-top:14px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink-2);text-wrap:pretty}
.cmp b{color:var(--ink);font-weight:600}
.stop{margin:16px 0 0;font-size:12.5px;color:var(--ink-2)}
/* 요약 */
.sum{display:flex;flex-direction:column;margin:10px -8px 0;padding:0;list-style:none}
.sum a{display:grid;grid-template-columns:28px minmax(0,1fr) 150px 56px;align-items:center;gap:0 12px;min-height:40px;padding:6px 8px;border-radius:8px;color:inherit;text-decoration:none;transition:background-color 120ms cubic-bezier(.23,1,.32,1)}
.sum a:hover{background:var(--well)}
.sum li+li a{box-shadow:0 -1px 0 var(--rule)}
.sum a:hover,.sum li:has(+li a:hover) a{box-shadow:none}
.sum .no{color:var(--ink-3);text-align:right}
.sum .t{overflow-wrap:anywhere;font-weight:550}
.sum .m{color:var(--ink-3);font-size:12px;text-align:right;white-space:nowrap}
.sum .st{justify-self:end}
.sum .a{display:contents}
/* 시나리오 */
.sc{scroll-margin-top:14px}
.sc:target{outline:none}
.sc-h{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;gap:2px 10px}
.sc-h .no{color:var(--ink-3);font-weight:600;font-size:14.5px;min-width:16px}
.sc-h h2{font-size:15px}
.sc.one .sc-h{grid-template-columns:minmax(0,1fr) auto}
.sc.one h2{font-size:19px;font-weight:700;letter-spacing:-.018em}
.sc-h .meta{grid-column:2/-1;color:var(--ink-3);font-size:12px}
.sc.one .sc-h .meta{grid-column:1/-1}
.sc-h .st{align-self:center;grid-row:1;grid-column:-2/-1}
.steps{list-style:none;margin:14px 0 0;padding:0}
.step{display:grid;grid-template-columns:24px minmax(0,1fr) 264px 76px;gap:0 14px;padding:12px 0;border-top:1px solid var(--rule)}
.step.bad{background:var(--bad-wash);margin:0 -12px;padding:12px 12px;border-radius:8px;border-top-color:transparent}
.step.bad+.step{border-top-color:transparent}
.step .n{color:var(--ink-3);font-size:12px;line-height:20px;text-align:right}
.step .t{margin:0;overflow-wrap:anywhere;text-wrap:pretty;line-height:20px}
.step.bad .t{font-weight:650}
.step .used{display:block;margin-top:3px;color:var(--ink-3);overflow-wrap:anywhere}
.step .shot{margin:0;min-width:0}
.step .shot+.shot{margin-top:8px}
.shot img{display:block;width:100%;height:auto;border-radius:8px;box-shadow:0 0 0 1px var(--rule);background:var(--well)}
.shot.fail img{box-shadow:0 0 0 1.5px var(--bad)}
.shot figcaption{margin:0 0 4px;font-size:11.5px;font-weight:600;color:var(--bad)}
.res{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11.5px;color:var(--ink-3);text-align:right}
.mk{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:99px;font-size:12px;font-weight:700;line-height:1}
.mk.ok{background:var(--pass-wash);color:var(--pass)}.mk.bad{background:var(--bad);color:var(--sheet)}
.err{margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--bad-wash)}
.step .err{background:var(--sheet);box-shadow:0 0 0 1px var(--bad-ring)}
.err b{display:block;color:var(--bad);font-size:12px;font-weight:650;margin-bottom:2px}
.err code{display:block;max-height:9.5em;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--ink)}
.err code:focus-visible{outline:2px solid var(--probe);outline-offset:2px;border-radius:4px}
.sc>.err{margin-top:12px}
.method{margin-top:16px;padding:12px 14px;border-radius:8px;background:var(--well)}
.method ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.method li{display:grid;grid-template-columns:112px minmax(0,1fr);gap:0 12px;color:var(--ink-2);font-size:12.5px;text-wrap:pretty;overflow-wrap:anywhere}
.method li b{color:var(--ink);font-weight:600}
.method li.plain{display:block}
/* 바닥 */
.foot{display:flex;flex-direction:column;gap:6px;padding:4px 4px 0;font-size:12px;color:var(--ink-2)}
.foot .f{display:grid;grid-template-columns:48px minmax(0,1fr);gap:2px 8px}
.foot code{color:var(--ink);overflow-wrap:anywhere}
.foot .f span{color:var(--ink-3)}
.foot details{margin-top:2px}
.foot summary{cursor:pointer;min-height:28px;display:flex;align-items:center;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-2);border-radius:6px}
.foot summary:focus-visible,.fails a:focus-visible,.sum a:focus-visible{outline:2px solid var(--probe);outline-offset:2px}
.foot pre{margin:4px 0 8px;padding:10px 12px;border-radius:8px;background:var(--well);color:var(--ink-2);white-space:pre-wrap;overflow-wrap:anywhere}
.foot p{margin:0;text-wrap:pretty}
.step .shot{grid-column:3}.step .res{grid-column:4}
.row{margin-top:18px}.row h3{margin:0;font-size:13px;font-weight:650;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.row .meta{color:var(--ink-3);font-size:12px;font-weight:400}.row .steps{margin-top:8px}.row>.err{margin-top:8px}
/* 좁은 폭 — 표를 쓰지 않고 줄로 쌓는다 */
@container (max-width:640px){
  .step{grid-template-columns:24px minmax(0,1fr) auto}
  .step .shot{grid-column:2/-1;grid-row:2;max-width:360px;margin-top:10px}
  .step .shot+.shot{grid-row:3}
  .step .res{grid-column:3;grid-row:1}
  .step .body{grid-column:2}
  .method li{grid-template-columns:minmax(0,1fr);gap:0}
}
@container (max-width:480px){
  .info{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}.info .wide{grid-column:1/-1}
  .card{padding:16px 14px}
  .sum{margin-inline:-6px}
  .sum a{grid-template-columns:22px minmax(0,1fr) auto;gap:0 8px}
  .sum .m{grid-column:2;grid-row:2;text-align:left;font-size:11.5px}
  .sum .st{grid-column:3;grid-row:1/3}
  .step.bad{margin:0 -8px;padding:12px 8px}
  .step .shot{max-width:none}
  .sc.one h2{font-size:17px}
}
body{margin:0;background:#eef0f4}@media (prefers-color-scheme:dark){body{background:#0e1118}}
@media (prefers-reduced-motion:reduce){.sum a{transition:none}}
@media print{body{background:#fff}details{display:block}details>summary{display:none}.rp{background:#fff;padding:0}.card{box-shadow:none;border:1px solid var(--rule);break-inside:avoid-page}.step{break-inside:avoid}.shot img{max-width:240px}.err code{max-height:none}}
`

/** 시나리오 절의 앵커 id — 파일 이름 stem 의 공백은 `-` 로, 따옴표 · `<>&` 는 이스케이프 */
const anchorOf = (id: string): string => esc(`s-${id.trim().replace(/\s+/g, '-')}`)
/** 단계 제목 앞의 "1. " 는 번호 칸과 겹쳐 뗀다 (데이터는 그대로) */
const bareTitle = (title: string): string => title.replace(/^\d+\.\s*/, '')

export function renderReport(input: ReportInput): string {
  const { run } = input
  const clean = (text: string): string => esc(scrub(text, input.secrets))
  const passed = run.cases.filter((item) => item.status === 'passed').length
  const failedCases = run.cases.filter((item) => item.status === 'failed')
  const failed = failedCases.length
  const other = run.cases.length - passed - failed
  const one = run.cases.length === 1
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
  const img = (shot: string | undefined, fail: boolean): string => {
    const bytes = shot && keep.has(shot) ? bytesOf(shot) : undefined
    if (!bytes) return ''
    const src = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
    return fail
      ? `<figure class="shot fail"><figcaption>실패 순간</figcaption><img alt="실패 순간 화면" src="${src}"></figure>`
      : `<figure class="shot"><img alt="단계 끝 화면" src="${src}"></figure>`
  }
  const titleOf = (key: string): string => {
    const [id, row] = key.split('#')
    const title = run.cases.find((item) => item.id === id)?.title ?? id!
    return row ? `${title} ${row}행` : title
  }
  const errorBox = (error: string, failKind: FailKind | undefined): string => `<div class="err"><b>오류${failKind ? ` · ${FAIL_LABEL[failKind]}` : ''}</b><code tabindex="0">${clean(error)}</code></div>`
  const stepList = (steps: StepResult[]): string => {
    const items = steps
      .map((step, at) => {
        const [mark, tone] = STEP_LABEL[step.status]
        const markBox = tone === 'ok' || tone === 'bad' ? `<span class="mk ${tone}" role="img" aria-label="${tone === 'ok' ? '성공' : '실패'}">${mark}</span>` : `<span class="st ${tone}">${mark}</span>`
        const used = step.used.length ? `<code class="used">${clean(step.used.join(' · '))}</code>` : ''
        const error = step.error ? `<div class="err"><b>오류</b><code tabindex="0">${clean(step.error)}</code></div>` : ''
        const kind = step.failKind ? `<span class="st">${FAIL_LABEL[step.failKind]}</span>` : ''
        const time = step.durationMs ? `<span class="num">${seconds(step.durationMs)}</span>` : ''
        return `<li class="step${step.status === 'failed' ? ' bad' : ''}"><span class="n num">${at + 1}</span><div class="body"><p class="t">${clean(bareTitle(step.title))}</p>${used}${error}</div>${img(step.shot, false)}${img(step.failShot, true)}<div class="res">${markBox}${kind}${time}</div></li>`
      })
      .join('')
    return items ? `<ol class="steps">${items}</ol>` : ''
  }
  const compare = run.compare
    ? `<p class="cmp"><b>지난 수행(${esc(run.compare.previousId)})과 비교</b> — ${compareLine(run.compare)}${run.compare.newFail.length ? `<br>새로 실패: ${run.compare.newFail.map((id) => clean(titleOf(id))).join(' · ')}` : ''}${run.compare.fixed.length ? `<br>고쳐짐: ${run.compare.fixed.map((id) => clean(titleOf(id))).join(' · ')}` : ''}</p>`
    : '<p class="cmp">처음 수행 — 비교할 지난 수행이 없습니다</p>'
  const interrupted = run.interrupted ? `<p class="stop"><span class="st bad">중단됨</span> ${clean(run.interrupted)} — 돈 데까지만 적었습니다. 남은 케이스는 멈춤입니다.</p>` : ''

  const info = [
    ['프로젝트', clean(input.project), ''],
    ['대상 주소', `<code>${clean(run.baseUrl || '-')}</code>`, ''],
    ['수행 시각', `${when(run.startedAt)} <small>(${seconds(run.durationMs)})</small>`, ' class="wide"'],
    ['브라우저', `${clean(run.browser)} · ${run.headed ? '보이게' : '화면 없이'}`, ''],
    ['수행자', clean(input.user), ''],
    ['결과', `<div class="tally num"><span class="st lg ok">성공 ${passed}</span><span class="st lg bad">실패 ${failed}</span>${other ? `<span class="st lg">그 밖 ${other}</span>` : ''}<span class="all">/ ${run.cases.length} 건</span></div>`, ' class="wide"'],
  ]
    .map(([name, value, attr]) => `<div${attr}><dt>${name}</dt><dd>${value}</dd></div>`)
    .join('')
  const failBar = failed
    ? `<nav class="fails" aria-label="실패한 시나리오"><b class="num">실패 ${failed}개</b><ul>${failedCases.map((item) => `<li><a href="#${anchorOf(item.id)}">${one ? '' : `<span class="no num">${run.cases.indexOf(item) + 1}</span>`}${clean(item.title)}</a></li>`).join('')}</ul></nav>`
    : ''

  const summary = one
    ? ''
    : `<section class="card" aria-labelledby="sum"><h2 class="lbl" id="sum">요약</h2><ol class="sum">${run.cases
        .map((item, index) => {
          const [label, tone] = CASE_LABEL[item.status]
          const meta = [input.scenarios.get(item.id)?.kind, item.rows ? `${item.rows.filter((row) => row.status === 'passed').length}/${item.rows.length} 행 성공` : '', seconds(item.durationMs)].filter(Boolean).map((text) => clean(text!)).join(' · ')
          return `<li><a href="#${anchorOf(item.id)}"><span class="no num">${index + 1}</span><span class="t">${clean(item.title)}</span><span class="m num">${meta}</span><span class="st ${tone}">${label}</span></a></li>`
        })
        .join('')}</ol></section>`

  const cases = run.cases
    .map((item, index) => {
      const [label, tone] = CASE_LABEL[item.status]
      const scenario = input.scenarios.get(item.id)
      const error = item.error && !item.rows ? errorBox(item.error, item.failKind) : ''
      const body = item.rows
        ? item.rows
            .map((row) => {
              const [rowText, rowTone] = CASE_LABEL[row.status]
              return `<div class="row"><h3>${row.row}행 — ${clean(row.label)} <span class="st ${rowTone}">${rowText}</span> <span class="meta num">${seconds(row.durationMs)}</span></h3>${stepList(row.steps)}${row.error ? errorBox(row.error, row.failKind) : ''}</div>`
            })
            .join('\n')
        : stepList(item.steps)
      const method = scenario?.method.length
        ? `<div class="method"><h3 class="lbl">테스트 방법</h3><ul>${scenario.method
            .map((line) => {
              const text = line.replace(/^\s*[-*]\s*/, '')
              const split = text.match(/^([^:：]{1,12}):\s*([\s\S]*)$/)
              return split ? `<li><b>${clean(split[1]!)}</b><span>${clean(split[2]!)}</span></li>` : `<li class="plain">${clean(text)}</li>`
            })
            .join('')}</ul></div>`
        : ''
      const meta = [scenario?.kind, item.rows ? `${item.rows.filter((row) => row.status === 'passed').length}/${item.rows.length} 행 성공` : '', seconds(item.durationMs)].filter(Boolean).map((text) => clean(text!)).join(' · ')
      return `<section class="card sc${one ? ' one' : ''}${item.status === 'failed' ? ' bad' : ''}" id="${anchorOf(item.id)}" tabindex="-1" aria-labelledby="c${index}"><div class="sc-h">${one ? '' : `<span class="no num">${index + 1}</span>`}<h2 id="c${index}">${clean(item.title)}</h2><span class="st ${tone}">${label}</span><span class="meta num">${meta}</span></div>
${body}
${error}${method}</section>`
    })
    .join('\n')

  const sources = [...input.scenarios.values()]
    .filter((scenario) => run.cases.some((item) => item.id === scenario.id))
    .map((scenario) => `<details><summary>${clean(scenario.id)}.md</summary><pre>${clean(scenario.source)}</pre></details>`)
    .join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UI 테스트 결과서 — ${clean(input.suiteName)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="rp">
<article class="doc">
<header class="card">
<h1>UI 테스트 수행 결과서 — ${clean(input.suiteName)}</h1>
<dl class="info">${info}</dl>
${failBar}
${interrupted}
${compare}
</header>
${summary}
${cases}
<footer class="foot">
<h2 class="lbl">무엇을 돌렸나</h2>
${input.files.map((file) => `<div class="f"><span>시나리오</span><code>${clean(file.scenario)}</code><span>코드</span><code>${clean(file.spec)}</code></div>`).join('\n')}
<p>"대화에서만 확인" 단계(확인(DB):)는 실행기가 돌리지 않습니다 — 대화에서 DB 조회 도구로 확인합니다.</p>
<p>비밀번호 등 비밀 값은 이 결과서에 넣지 않습니다. ${dropped ? `스크린샷 ${dropped} 장은 결과서 크기(앱 미리보기 20MB) 때문에 뺐습니다 — 실패 순간은 먼저 남깁니다.` : '이 파일 하나에 스크린샷이 모두 들어 있습니다'}(인쇄하면 PDF).</p>
${sources}
</footer>
</article>
</div>
</body>
</html>
`
}
