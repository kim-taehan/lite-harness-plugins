// 증적 md 다루기 — 절(## 제목) 찾기, 표 읽기 · 한 줄 고치기, 그리고 보고서 · 가이드를 한 파일 HTML 로 그리기.
// 증적 형식은 ui-auto-evidence 스킬의 "File formats" 가 글자 그대로 정한다. 여기서는 그 제목과 표 머리로 찾고, 고칠 때는 그 줄만 바꾼다(다른 줄은 한 글자도 건드리지 않는다).

/** 머리말(--- … ---)을 떼어 키: 값 으로. 값이 [a, b] 면 배열 */
export function frontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Record<string, string | string[]> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const value = line.slice(at + 1).trim()
    meta[line.slice(0, at).trim()] = /^\[.*\]$/.test(value) ? value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean) : value
  }
  return { meta, body: text.slice(match[0].length) }
}

/** `## <제목>` 절의 [시작 줄, 끝 줄) — 제목은 앞부분만 맞으면 된다(`## 수행 이력 (최근 10건)`) */
export function sectionRange(lines: readonly string[], title: string): [number, number] | undefined {
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`))
  if (start < 0) return undefined
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (/^## /.test(lines[index]!)) {
      end = index
      break
    }
  }
  return [start, end]
}

export function section(text: string, title: string): string | undefined {
  const lines = text.split('\n')
  const range = sectionRange(lines, title)
  return range && lines.slice(range[0] + 1, range[1]).join('\n').trim()
}

/** 표 한 줄 → 칸. `\|` 는 칸 안의 글자 */
export function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'))
}

const isRow = (line: string) => /^\s*\|/.test(line)
const isRule = (line: string) => /^\s*\|?\s*:?-{3,}/.test(line)

/** 절 안의 첫 표 — 머리 칸 이름 → 값 */
export function table(text: string, title: string): Record<string, string>[] {
  const lines = text.split('\n')
  const range = sectionRange(lines, title)
  if (!range) return []
  const rows: Record<string, string>[] = []
  let head: string[] | undefined
  for (let index = range[0] + 1; index < range[1]; index++) {
    const line = lines[index]!
    if (!isRow(line)) {
      if (head) break
      continue
    }
    if (!head) head = cells(line)
    else if (!isRule(line)) {
      const values = cells(line)
      rows.push(Object.fromEntries(head.map((name, at) => [name, values[at] ?? ''])))
    }
  }
  return rows
}

/** 표 칸에 넣을 글자 — 줄바꿈과 | 를 막는다 */
export const cellText = (value: string): string => value.replace(/\r?\n/g, ' ').replaceAll('|', '\\|')

/** 절 안의 표에서 첫 칸이 key 인 줄의 칸들을 바꾼다 — 없으면 undefined (파일을 건드리지 않는다) */
export function updateRow(text: string, title: string, key: string, change: Record<string, string>): string | undefined {
  const lines = text.split('\n')
  const range = sectionRange(lines, title)
  if (!range) return undefined
  let head: string[] | undefined
  for (let index = range[0] + 1; index < range[1]; index++) {
    const line = lines[index]!
    if (!isRow(line)) {
      if (head) break
      continue
    }
    if (!head) {
      head = cells(line)
      continue
    }
    if (isRule(line)) continue
    const values = cells(line)
    if (values[0] !== key) continue
    const next = head.map((name, at) => (name in change ? change[name]! : values[at] ?? ''))
    lines[index] = `| ${next.map(cellText).join(' | ')} |`
    return lines.join('\n')
  }
  return undefined
}

/** `### ` 로 시작하는 덩어리들 — 절 본문에서 */
export function blocks(body: string): { heading: string; lines: string[] }[] {
  const out: { heading: string; lines: string[] }[] = []
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) out.push({ heading: line.slice(4).trim(), lines: [] })
    else out.at(-1)?.lines.push(line)
  }
  return out
}

/** `- 이름: 값` 줄들 → 이름 → 값. 들여 쓴 다음 줄들(`  1. …`)은 앞 값에 줄바꿈으로 이어 붙인다 */
export function fields(lines: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  let last: string | undefined
  for (const line of lines) {
    if (last !== undefined && /^\s+\S/.test(line)) {
      out[last] = out[last] ? `${out[last]}\n${line.trim()}` : line.trim()
      continue
    }
    const match = /^-\s+([^:]+):\s*(.*)$/.exec(line.trim())
    last = match ? match[1]!.trim() : undefined
    if (match) out[last!] = match[2]!.trim()
  }
  return out
}

// ── 그리기 ──

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** 글 안의 짧은 꾸밈 — 이미지 · 굵게 · 코드만. 나머지는 모두 글자로(AI 가 쓴 md 의 태그를 HTML 로 살리지 않는다) */
function inline(text: string, image: (src: string) => string | undefined): string {
  const parts = text.split(/(`[^`]+`|!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*)/)
  return parts
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part)
      if (img) {
        const src = image(img[2]!.trim())
        return src ? `<img alt="${escapeHtml(img[1]!)}" src="${src}">` : `<span class="missing">캡처 없음: ${escapeHtml(img[2]!)}</span>`
      }
      if (/^\*\*[^*]+\*\*$/.test(part)) return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`
      return escapeHtml(part)
    })
    .join('')
}

/** 증적 md(머리말 뗀 것) → HTML 본문. 제목 · 표 · 목록 · 이미지 · 문단 · 코드 블록.
 *  `### ` 덩어리(보고서의 단계 캡처 · 가이드의 따라 하기)는 <section class="step"> 로 묶는다 — PDF 에서 캡처가 있는 단계마다 한 쪽 */
export function renderBody(markdown: string, image: (src: string) => string | undefined): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let open = false
  const close = () => {
    if (open) out.push('</section>')
    open = false
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (/^```/.test(line)) {
      const body: string[] = []
      index++
      while (index < lines.length && !/^```/.test(lines[index]!)) body.push(lines[index++]!)
      index++
      out.push(`<pre>${escapeHtml(body.join('\n'))}</pre>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      if (level <= 3) close()
      if (level === 3) {
        out.push('<section class="step">')
        open = true
      }
      out.push(`<h${level}>${inline(heading[2]!, image)}</h${level}>`)
      index++
      continue
    }
    if (isRow(line)) {
      const rows: string[] = []
      while (index < lines.length && isRow(lines[index]!)) rows.push(lines[index++]!)
      const [head, ...rest] = rows
      const body = rest.filter((row) => !isRule(row))
      out.push(`<table><thead><tr>${cells(head!).map((cell) => `<th>${inline(cell, image)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell, image)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const item = /^\s*(-|\d+\.)\s+(.*)$/.exec(line)
    if (item) {
      const ordered = item[1] !== '-'
      const items: string[] = []
      while (index < lines.length) {
        const match = /^\s*(-|\d+\.)\s+(.*)$/.exec(lines[index]!)
        if (!match || (match[1] !== '-') === !ordered) break
        items.push(`<li>${inline(match[2]!, image)}</li>`)
        index++
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    if (!line.trim()) {
      index++
      continue
    }
    const para: string[] = []
    while (index < lines.length && lines[index]!.trim() && !/^(#{1,4}\s|```|\s*\||\s*(-|\d+\.)\s)/.test(lines[index]!)) para.push(lines[index++]!)
    out.push(`<p>${para.map((text) => inline(text, image)).join('<br>')}</p>`)
  }
  close()
  return out.join('\n')
}

const STYLE = `
:root { color-scheme: light; --ink: #1b2433; --ink-2: #4a5568; --ink-3: #6b7686; --rule: #e3e7ed; --well: #f4f6f9; --probe: #2b4c7e; --pass: #1a2f4f; --bad: #b42318; --warn: #3a4555; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--ink); font: 14px/1.6 "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 24px 48px; }
header.doc { border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 20px; }
header.doc .kind { color: var(--probe); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
header.doc .meta { color: var(--ink-3); font-size: 12px; margin-top: 4px; }
h1 { font-size: 22px; margin: 4px 0 0; }
h2 { font-size: 16px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--rule); break-after: avoid; }
h3 { font-size: 14px; margin: 18px 0 6px; break-after: avoid; }
h4 { font-size: 13px; margin: 14px 0 4px; color: var(--ink-2); }
p, ul, ol { margin: 6px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; break-inside: auto; }
th, td { border: 1px solid var(--rule); padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: var(--well); font-weight: 600; white-space: nowrap; }
tr { break-inside: avoid; }
code { background: var(--well); border-radius: 4px; padding: 1px 4px; font-size: 12px; }
pre { background: var(--well); border-radius: 4px; padding: 10px 12px; font-size: 12px; white-space: pre-wrap; }
img { display: block; max-width: 100%; border: 1px solid var(--rule); border-radius: 4px; margin: 6px 0 10px; break-inside: avoid; }
.missing { color: var(--warn); font-size: 12px; }
.verdict-성공 { color: var(--pass); font-weight: 700; }
.verdict-실패 { color: var(--bad); font-weight: 700; }
.verdict-차단 { color: var(--warn); font-weight: 700; }
footer { margin-top: 36px; color: var(--ink-3); font-size: 11px; border-top: 1px solid var(--rule); padding-top: 8px; }
section.step { break-inside: avoid; margin: 0 0 8px; }
@media print { main { padding: 0; max-width: none; } h2 { break-after: avoid; } section.step:has(img) ~ section.step:has(img) { break-before: page; } section.step img { max-height: 200mm; width: auto; } }
`

/** 한 파일 HTML — 스크립트 없음, 이미지는 data: 로 들어 있다 */
export function page(input: { kind: string; title: string; meta: string; body: string; footer: string; fontCss?: string }): string {
  // 판정 칸 글자에 색 — 보고서 머리 표의 "판정" 줄
  const body = input.body.replace(/<td>판정<\/td><td>(성공|실패|차단)<\/td>/, '<td>판정</td><td class="verdict-$1">$1</td>')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><style>${input.fontCss ?? ''}${STYLE}</style></head>
<body><main>
<header class="doc"><div class="kind">${escapeHtml(input.kind)}</div><div class="meta">${escapeHtml(input.meta)}</div></header>
${body}
<footer>${escapeHtml(input.footer)}</footer>
</main></body></html>
`
}
