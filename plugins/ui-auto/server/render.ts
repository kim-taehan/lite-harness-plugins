// 보고서(reports/<run_id>.md) · 가이드(guides/<guide_id>.md) → 한 파일 HTML · PDF. 패널이 열거나 저장할 때마다 원본 md 에서 다시 만든다(원본이 늘 최신).
// 캡처는 증적 폴더 안 파일만 data: 로 넣는다 — 밖을 가리키는 경로 · 없는 파일은 "캡처 없음" 으로.

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pdf as printPdf } from './auth.ts'
import { guardWrite, PLUGIN_DIR, type Config } from './config.ts'
import type { Evidence } from './evidence.ts'
import { frontmatter, page, renderBody } from './markdown.ts'

export type DocKind = 'report' | 'guide'

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/** 임시 파일에 쓰고 이름을 바꾼다 — 쓰는 도중 읽는 쪽(AI · 사람)이 반쪽 파일을 보지 않게 */
export async function writeAtomic(config: Pick<Config, 'project'>, file: string, content: string | Uint8Array): Promise<void> {
  await guardWrite(config, file)
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, content)
  await rename(temp, file)
}

const folder = (kind: DocKind) => (kind === 'report' ? 'reports' : 'guides')

/** md → HTML 파일. 돌려주는 path 는 프로젝트 기준 */
export async function renderDoc(config: Config, evidence: Evidence, kind: DocKind, id: string, fontCss?: string): Promise<{ path: string; file: string; html: string; title: string }> {
  if (!ID.test(id)) throw new Error(`id 가 틀렸습니다: ${id}`)
  const source = `${folder(kind)}/${id}.md`
  const text = await evidence.read(source)
  if (text === undefined) throw new Error(`${kind === 'report' ? '보고서' : '가이드'} 원본이 없습니다: ${source}`)
  const { meta, body } = frontmatter(text)
  const base = path.dirname(evidence.file(source))
  const image = (src: string): string | undefined => {
    if (/^[a-z]+:/i.test(src)) return undefined
    const full = path.resolve(base, src)
    const type = IMAGE_TYPES[path.extname(full).toLowerCase()]
    if (!type || !full.startsWith(evidence.root + path.sep)) return undefined
    try {
      return `data:${type};base64,${readFileSync(full).toString('base64')}`
    } catch {
      return undefined
    }
  }
  const title = String(meta['title'] ?? '') || /^#\s+(.*)$/m.exec(body)?.[1] || id
  const html = page({
    kind: kind === 'report' ? 'UI-AUTO · 테스트 수행 보고서' : 'UI-AUTO · 테스트 가이드',
    title,
    meta: `원본 ${path.posix.join('.litecode/ui-auto', source)}`,
    body: renderBody(body, image),
    footer: `UI-AUTO 가 증적(.litecode/ui-auto/)에서 만든 문서입니다. 계정 · 비밀번호는 들어 있지 않습니다.`,
    ...(fontCss && { fontCss }),
  })
  const relative = path.posix.join(PLUGIN_DIR, 'out', folder(kind), `${id}.html`)
  const file = path.join(config.project, relative)
  await writeAtomic(config, file, html)
  return { path: relative, file, html, title }
}

/** HTML 을 다시 만들고 PDF 로 — 서비스가 project.exportFile 로 사용자에게 저장하게 한다 */
export async function renderPdf(config: Config, evidence: Evidence, kind: DocKind, id: string): Promise<{ path: string; name: string }> {
  const { html, file, path: relative } = await renderDoc(config, evidence, kind, id, fontFace(config))
  const output = file.replace(/\.html$/, '.pdf')
  await guardWrite(config, output)
  await printPdf(config.channel, html, output)
  return { path: relative.replace(/\.html$/, '.pdf'), name: `${kind === 'report' ? '테스트보고서' : '테스트가이드'}-${id}.pdf` }
}

/** PDF 에만 Pretendard 를 싣는다(2MB) — 앱 미리보기용 HTML 은 가볍게 시스템 글꼴. 글꼴 파일이 없으면(개발 중) 시스템 글꼴 */
function fontFace(config: Pick<Config, 'extensionDir'>): string | undefined {
  try {
    const font = readFileSync(path.join(config.extensionDir, 'assets', 'fonts', 'PretendardVariable.woff2')).toString('base64')
    return `@font-face{font-family:"Pretendard Variable";font-weight:45 920;font-style:normal;src:url(data:font/woff2;base64,${font}) format("woff2")}`
  } catch {
    return undefined
  }
}
