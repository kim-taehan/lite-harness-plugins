import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../server/index.ts'
import { cliCommand } from '../server/tools.ts'

// CI 명령 — node ui-test.mjs run [<시나리오>…] [--failed] [--screen <라우트>] [--request <요청 id>] [--each] [--headed|--headless]

describe('CLI 인자', () => {
  it('시나리오 이름 · 선택 옵션 · 결과서 방식 · 브라우저 창', () => {
    expect(parseCliArgs(['a-01', '로그인', '--failed', '--screen', '/admin/menu', '--request', 'q1', '--each', '--headed'])).toEqual({ scenarios: ['a-01', '로그인'], screen: '/admin/menu', request: 'q1', failed: true, each: true, headed: true })
    expect(parseCliArgs(['--headless'])).toEqual({ scenarios: [], failed: false, each: false, headed: false })
  })

  it('list 의 "AI 없이" 명령은 이 옵션들을 안내한다', () => {
    const command = cliCommand('/p/ui-test.mjs')
    for (const option of ['--failed', '--screen', '--request', '--each', '--headless']) expect(command).toContain(option)
  })
})
