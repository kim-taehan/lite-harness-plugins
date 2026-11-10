import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffLines, hiddenValues, maskBinds, maskLabel, parseReport, renderReport, scrub, writeReport } from '../server/report.ts'
import type { ReportInput } from '../server/report.ts'
import { createTools } from '../server/tools.ts'
import type { Adapter } from '../server/types.ts'
import { hold, win } from './report.fixtures.ts'

// 튜닝 결과서 — 렌더러(두 시나리오 · 이스케이프 · 비밀 지우기 · 바인드 가리기) · 파일 쓰기(폴더 밖 거절) · report 도구(임시 폴더, 가짜 어댑터)

const at = new Date(2026, 10, 9, 14, 32, 5)
const render = (input: ReportInput, hide: string[] = []): string => renderReport(input, { at, hide })
const dirs: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sql-report-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('결과서 렌더러', () => {
  it('개선 성공 — 판정 · 비용 · 결과 일치 · 인덱스 제안 · 표준 근거가 들어간다', () => {
    const html = render(win)
    expect(html).toContain('개선 성공')
    expect(html).toContain('결과 동일 확인')
    expect(html).toContain('비용 4,210')
    expect(html).toContain('3 / 3')
    expect(html).toContain('제안만 · 실행하지 않음')
    expect(html).toContain('확인 못 함') // 예상 효과 — 수치를 지어내지 않는다
    expect(html).toContain('SQL-03')
    expect(html).toContain('2026-11-09 14:32')
    expect(html).toContain('<mark class="d">')
    expect(html).toContain('데이터 행은 이 결과서에 담지 않습니다')
    expect(html).not.toMatch(/<script|https?:\/\/|<link|<img/)
    expect(html).toContain('prefers-color-scheme:dark')
    expect(html).toContain('@media print')
  })

  it('적용 보류 — 판정 · 참고 표시 · 원인 · 인덱스 없음, 실패를 숨기지 않는다', () => {
    const html = render(hold)
    expect(html).toContain('적용 보류')
    expect(html).toContain('결과가 달라졌습니다')
    expect(html).toContain('1 / 2')
    expect(html).toContain('참고 — 개선으로 세지 않음')
    expect(html).toContain('✕ 다름')
    expect(html).toContain('원래에만 있는 6행')
    expect(html).toContain('이번에는 제안이 없습니다')
    expect(html).toContain('적용했으나 결과가 달라짐')
    expect(html).not.toContain('개선 성공')
  })

  it('표준이 없으면 "표준 판정 없음" 으로 그린다', () => {
    const { standard: _s, rules: _r, ...rest } = win
    expect(render(rest as ReportInput)).toContain('표준 판정 없음')
    expect(render(rest as ReportInput)).not.toContain('SQL-03')
  })

  it('인덱스 효과를 확인했다고 한 때만 "확인함"', () => {
    const html = render({ ...win, index: { ...win.index!, effect_verified: true, effect_note: '개발 DB 에 만들어 explain 비용 380 → 90' } })
    expect(html).toContain('확인함')
    expect(html).toContain('비용 380 → 90')
  })

  it('모든 글을 HTML 이스케이프한다 — 스크립트가 든 SQL · 이름 · 설명', () => {
    const evil = '<script>alert(1)</script>'
    const html = render({ ...win, target: `T ${evil}`, original_sql: `SELECT '${evil}' FROM t`, candidate_sql: `SELECT "${evil}" FROM t`, diff_note: evil, cause: undefined, plan_full: { before: evil, after: evil }, project: evil, rules: [{ id: 'X', text: evil, status: 'applied' }], compare: [{ ...win.compare[0]!, label: evil }] })
    expect(html).not.toContain('<script')
    expect(html).not.toContain(evil)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('비밀번호 · 접속 주소 · 호스트 · 계정은 어느 칸에 들어 있어도 지운다', () => {
    const url = 'oracle://tuner:S3cret%21pw@db.corp.example:1521/FREEPDB1'
    const hide = hiddenValues(url, 'SHOP')
    const leak = 'oracle://tuner:S3cret!pw@db.corp.example:1521/FREEPDB1'
    const html = render(
      { ...win, source: { file: `a/${leak}.xml` }, diff_note: 'user tuner on db.corp.example with S3cret!pw', original_sql: `SELECT 1 FROM dual -- ${leak}`, plan_full: { before: 'ORA-12541 db.corp.example:1521', after: 'jdbc:oracle:thin:@db.corp.example:1521/FREEPDB1' }, unknown: ['tuner 계정으로 접속'] },
      hide,
    )
    for (const secret of ['S3cret', 'db.corp.example', 'tuner', 'oracle://', 'jdbc:']) expect(html).not.toContain(secret)
    expect(html).toContain('‹숨김›')
  })

  it('계정이 스키마와 같으면(객체 소유자 이름) 지우지 않는다', () => {
    expect(hiddenValues('oracle://shop:pw1234@h.example/XE', 'SHOP')).toEqual(['pw1234', 'h.example'])
    expect(hiddenValues('oracle://shop:pw1234@h.example/XE')).toContain('shop')
  })

  it('바인드 묶음 이름(compare 가 실제 값을 넣어 준다)에서도 문자열 값은 가린다 — 짧은 값은 따옴표로 감싼 것만', () => {
    expect(maskLabel('{"d":"2026-10-15"}', { d: '2026-10-15' })).toBe('{"d":"‹문자열 10자›"}')
    expect(maskLabel('email=kim@example.com status=Y', { email: 'kim@example.com', status: 'Y' })).toBe('email=‹문자열 15자› status=Y')
    expect(maskLabel('{"s":"Y","note":"YES"}', { s: 'Y', note: 'YES' })).toBe('{"s":"‹문자열 1자›","note":"‹문자열 3자›"}')
    expect(maskLabel('최근 7일 · 결제 완료', { days: 7 })).toBe('최근 7일 · 결제 완료')
    const html = render({ ...win, compare: [{ ...win.compare[0]!, label: '{"email":"kim@example.com"}', binds: { email: 'kim@example.com' } }] })
    expect(html).not.toContain('kim@example.com')
  })

  it('개요 — 맨 앞에 요약 · 절 · 코드 블록으로 나오고, 문단 · `코드` 를 살리되 이스케이프한다', () => {
    const html = render({
      ...win,
      overview: {
        summary: '주소록 건수 조회가 OR 조건 때문에 전체 스캔이었습니다. UNION 으로 나눠 같은 결과를 확인했습니다.',
        sections: [
          { title: '원인', text: '최대 비용 단계는 `TABLE ACCESS FULL` 입니다.\n\n조건이 서로 다른 열을 OR 로 묶어 인덱스를 못 씁니다. <script>alert(1)</script>', code: '2. TABLE ACCESS FULL COMTNADBKMANAGE  cost=2' },
          { title: '① SQL 리라이트 — 등가성 확인됨', text: '중복 제거가 필요해 UNION ALL 이 아니라 UNION 입니다.' },
        ],
      },
    })
    expect(html.indexOf('id="s0"')).toBeGreaterThan(0)
    expect(html.indexOf('id="s0"')).toBeLessThan(html.indexOf('class="verdict"'))
    expect(html).toContain('<h3>원인</h3>')
    expect(html).toContain('<code>TABLE ACCESS FULL</code>')
    expect(html).toContain('<p>조건이 서로 다른 열을')
    expect(html).toContain('<pre class="raw">2. TABLE ACCESS FULL COMTNADBKMANAGE  cost=2</pre>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('개요가 없으면 절을 그리지 않고, 틀린 모양은 알아듣게 거절한다', () => {
    expect(render(win)).not.toContain('id="s0"')
    const bad = parseReport({ ...win, overview: { sections: [{ title: '원인' }] } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('overview.summary')
  })

  it('바인드 값 — 문자열은 길이만, 숫자 · 불리언 · NULL 은 그대로', () => {
    expect(maskBinds({ days: 7, email: 'kim@example.com', ok: true, n: null })).toBe('days=7 email=‹문자열 15자› ok=true n=NULL')
    expect(maskBinds([30, '홍길동'])).toBe('#1=30 #2=‹문자열 3자›')
    const html = render({ ...win, compare: [{ ...win.compare[0]!, binds: { email: 'kim@example.com' } }] })
    expect(html).toContain('email=‹문자열 15자›')
    expect(html).not.toContain('kim@example.com')
    expect(html).not.toContain('PAID')
  })

  it('scrub — 짧은 값 · 낱말 일부는 건드리지 않는다', () => {
    expect(scrub('host.example.com / myhost.example.com', ['host.example.com'])).toBe('‹숨김› / myhost.example.com')
  })

  it('SQL 줄 비교 — 바뀐 줄 · 더한 줄 · 같은 줄', () => {
    const rows = diffLines('a\nb\nc', 'a\nB\nc\nd')
    expect(rows.map((row) => row.kind)).toEqual(['same', 'chg', 'same', 'add'])
    expect(diffLines('x', 'x').every((row) => row.kind === 'same')).toBe(true)
  })

  it('SQL 이 200KB 를 넘으면 잘라서 알린다', () => {
    const parsed = parseReport({ ...win, original_sql: 'SELECT 1 FROM t\n'.repeat(20_000) })
    expect(parsed.ok && parsed.notices.join(' ')).toContain('original_sql was cut')
  })
})

describe('입력 검사', () => {
  it('필수 칸이 빠지면 빠진 것을 한꺼번에 알려 준다', () => {
    const parsed = parseReport({ target: 'X' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) for (const name of ['verdict is required', 'db is required', 'original_sql is required', 'candidate_sql is required', 'compare is required']) expect(parsed.error).toContain(name)
  })

  it('compare 안쪽 칸 이름까지 짚는다', () => {
    const parsed = parseReport({ ...win, compare: [{ label: 'a', original: { rows: 1, ms: 2 }, candidate: { rows: 1, checksum: 'x', ms: 2 } }] })
    expect(!parsed.ok && parsed.error).toContain('compare[0].original.checksum is required')
  })

  it("verdict 'ok' 인데 결과가 다르면 거절하고, hold 는 cause 가 있어야 한다", () => {
    expect(parseReport({ ...hold, verdict: 'ok' })).toMatchObject({ ok: false, error: expect.stringContaining("use 'hold'") })
    expect(parseReport({ ...hold, cause: undefined })).toMatchObject({ ok: false, error: expect.stringContaining('cause is required') })
  })

  it('hold 에 인덱스 제안이 오면 빼고 알린다', () => {
    const parsed = parseReport({ ...hold, index: win.index })
    expect(parsed.ok && parsed.input.index).toBeUndefined()
    expect(parsed.ok && parsed.notices.join(' ')).toContain('index was left out')
  })
})

describe('파일 쓰기', () => {
  it('프로젝트 폴더 아래 sql-tuning-reports/<시각>/index.html 로 쓰고 같은 초면 번호를 붙인다', async () => {
    const cwd = temp()
    expect(await writeReport(cwd, 'a', at)).toBe('sql-tuning-reports/20261109-143205/index.html')
    expect(await writeReport(cwd, 'b', at)).toBe('sql-tuning-reports/20261109-143205-2/index.html')
    expect(readFileSync(path.join(cwd, 'sql-tuning-reports/20261109-143205/index.html'), 'utf8')).toBe('a')
  })

  it('결과서 폴더가 프로젝트 밖을 가리키면(심볼릭 링크) 쓰지 않는다', async () => {
    const cwd = temp()
    const outside = temp()
    symlinkSync(outside, path.join(cwd, 'sql-tuning-reports'))
    await expect(writeReport(cwd, 'x', at)).rejects.toThrow('outside the project folder')
    expect(readdirSync(outside)).toEqual([])
  })
})

const fakeAdapter = (): Adapter => ({}) as Adapter
const reportTool = (cwd: string, extra: { databaseUrl?: string } = {}) => createTools(async () => fakeAdapter(), { rowLimit: 3, timeoutMs: 1000, report: { cwd, now: () => at, ...extra } }).find((tool) => tool.name === 'report')!

describe('report 도구', () => {
  it('파일을 쓰고 경로를 돌려준다 — DB 에는 닿지 않는다', async () => {
    const cwd = temp()
    const result = await reportTool(cwd).run(win as unknown as Record<string, unknown>)
    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('Report written: sql-tuning-reports/20261109-143205/index.html')
    expect(readFileSync(path.join(cwd, 'sql-tuning-reports/20261109-143205/index.html'), 'utf8')).toContain('SQL 튜닝 최종 결과서')
  })

  it('.gitignore 에 폴더가 없으면 제안만 한 번 하고 파일은 고치지 않는다', async () => {
    const cwd = temp()
    const tool = reportTool(cwd)
    const first = await tool.run(win as unknown as Record<string, unknown>)
    expect(first.text).toContain('not in .gitignore')
    expect(readdirSync(cwd)).not.toContain('.gitignore')
    expect((await tool.run(win as unknown as Record<string, unknown>)).text).not.toContain('not in .gitignore')
  })

  it('.gitignore 에 이미 있으면 제안하지 않는다', async () => {
    const cwd = temp()
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n/sql-tuning-reports/\n')
    expect((await reportTool(cwd).run(win as unknown as Record<string, unknown>)).text).not.toContain('.gitignore')
  })

  it('접속 주소의 비밀번호 · 호스트가 결과서 파일에 없다', async () => {
    const cwd = temp()
    await reportTool(cwd, { databaseUrl: 'postgres://dev_ro:Pw0rd-xyz@pg.internal.example:5432/shop' }).run({ ...win, source: { file: 'pg.internal.example/Pw0rd-xyz' } } as unknown as Record<string, unknown>)
    const html = readFileSync(path.join(cwd, 'sql-tuning-reports/20261109-143205/index.html'), 'utf8')
    for (const secret of ['Pw0rd-xyz', 'pg.internal.example', 'dev_ro']) expect(html).not.toContain(secret)
  })

  it('필수 필드가 빠지면 알아듣게 오류를 내고 파일을 만들지 않는다', async () => {
    const cwd = temp()
    const result = await reportTool(cwd).run({ verdict: 'ok', target: 'X' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('report input is not valid')
    expect(result.text).toContain('original_sql is required')
    expect(readdirSync(cwd)).toEqual([])
  })
})
