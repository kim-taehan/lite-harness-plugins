import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFromEnv, guardPluginPath, insideProject, PLUGIN_DIR, scrub } from '../server/config.ts'
import { fingerprint, parseScenario, specHeader, splitFrontMatter } from '../server/scenario.ts'

// UI 테스트 (#1248) — 시나리오 · 묶음 md 읽기, 지문, 생성 코드 머리말, 폴더 설정 검사

const SCENARIO = `---
name: 정상 가입설계
kind: 정상
targets: [web]
tags: [가입설계, 스모크]   # 주석
account: user
---
1. 로그인한다
2. 고객 40세 · 상품 "든든종신" 선택
3. 확인: 월 보험료가 보인다
4) 확인(DB): 설계 행이 생긴다

## 테스트 방법
- 사전 조건: 계정 user, 시작 주소 /join
- 마지막 성공: 2026-11-06 · 8.2초
`

describe('parseScenario', () => {
  it('머리 · 번호 단계 · 단계 종류(확인 · 확인(DB)) · 테스트 방법', () => {
    const scenario = parseScenario('01-정상-가입설계', SCENARIO)
    expect(scenario).toMatchObject({ id: '01-정상-가입설계', name: '정상 가입설계', kind: '정상', targets: ['web'], tags: ['가입설계', '스모크'], account: 'user' })
    expect(scenario.steps).toEqual([
      { no: 1, text: '로그인한다', kind: 'action' },
      { no: 2, text: '고객 40세 · 상품 "든든종신" 선택', kind: 'action' },
      { no: 3, text: '확인: 월 보험료가 보인다', kind: 'check' },
      { no: 4, text: '확인(DB): 설계 행이 생긴다', kind: 'db' },
    ])
    expect(scenario.method).toEqual(['- 사전 조건: 계정 user, 시작 주소 /join', '- 마지막 성공: 2026-11-06 · 8.2초'])
  })

  it('머리가 없으면 이름은 id, 대상은 web, 테스트 방법 없음 · CRLF 도 읽는다', () => {
    const scenario = parseScenario('02-x', '1. 연다\r\n2. 확인: 보인다\r\n')
    expect(scenario).toMatchObject({ name: '02-x', targets: ['web'], tags: [], method: [] })
    expect(scenario.steps.map((step) => step.kind)).toEqual(['action', 'check'])
  })

  it('테스트 방법 아래 번호 줄은 단계가 아니다', () => {
    const scenario = parseScenario('x', '1. 연다\n\n## 테스트 방법\n1. 이건 방법\n')
    expect(scenario.steps).toHaveLength(1)
    expect(scenario.method).toEqual(['1. 이건 방법'])
  })

  it('지문은 테스트 방법 · 빈 줄 · 끝 공백과 상관없고, 단계가 바뀌면 바뀐다', () => {
    const base = fingerprint(SCENARIO)
    expect(base).toMatch(/^[0-9a-f]{12}$/)
    expect(fingerprint(SCENARIO.replace('8.2초', '9.9초'))).toBe(base)
    expect(fingerprint(SCENARIO.replace('1. 로그인한다', '1. 로그인한다   \n'))).toBe(base)
    expect(fingerprint(SCENARIO.replace('40세', '41세'))).not.toBe(base)
    // `## 시행착오` 는 `## 테스트 방법` 뒤에 두므로 고쳐도 코드가 낡지 않는다
    expect(fingerprint(`${SCENARIO}\n## 시행착오\n- 1단계 · 11-09 · 증상: 대기 시간 초과 → 원인: SPA → 해결: 제목을 기다림\n`)).toBe(base)
  })
})

describe('머리말', () => {
  it('머리 없는 파일은 머리가 비어 있다', () => {
    expect(splitFrontMatter('no head').head).toEqual({})
  })

  it('시나리오 머리 — request · requested · screens · screen-names (태그의 재료)', () => {
    const scenario = parseScenario('q-01', `---\nname: 로그인\nrequest: "메뉴 관리 화면에 대해서 진행해줘 #12 (급해요)"\nrequested: 2026-11-10T01:05:00.000Z\nscreens: [/admin/menu/12, login/]\nscreen-names: {/admin/menu/12: 메뉴 관리, /login: "로그인: 화면"}\n---\n1. 연다\n`)
    expect(scenario).toMatchObject({ request: '메뉴 관리 화면에 대해서 진행해줘 #12 (급해요)', requested: '2026-11-10T01:05:00.000Z', screens: ['/admin/menu/:id', '/login'], screenNames: { '/admin/menu/:id': '메뉴 관리', '/login': '로그인: 화면' } })
    expect(parseScenario('x', '---\nname: a\n---\n1. 연다\n')).toMatchObject({ screens: [], screenNames: {} })
    expect(parseScenario('x', '1. 연다\n').request).toBeUndefined()
  })

  it('요청 · 화면 줄을 고쳐도 지문(코드 낡음)은 그대로', () => {
    const base = fingerprint('---\nname: a\n---\n1. 연다\n')
    expect(fingerprint('---\nname: a\nrequest: "x"\nrequested: 2026-11-10T00:00:00Z\nscreens: [/a]\nscreen-names: {/a: 에이}\n---\n1. 연다\n')).toBe(base)
    expect(fingerprint('---\nname: b\n---\n1. 연다\n')).not.toBe(base)
  })

  it('생성 코드 머리말에서 출처 · 지문', () => {
    expect(specHeader('// ui-test source: .litecode/plugins/ui-test/scenarios/a/01-x.md · fingerprint: 3f2a9c1b7d04\nexport default async () => {}')).toEqual({ source: '.litecode/plugins/ui-test/scenarios/a/01-x.md', fingerprint: '3f2a9c1b7d04' })
    expect(specHeader('export default 1')).toEqual({})
  })
})

describe('폴더 설정', () => {
  const project = '/work/proj'
  it('시나리오 · 결과서는 프로젝트 .litecode/plugins/ui-test/ 아래로 정해져 있다, 이력은 앱이 준 데이터 폴더', () => {
    const config = configFromEnv({ UI_TEST_BASE_URL: ' http://a ', UI_TEST_BROWSER: 'Edge', UI_TEST_DATA_DIR: '/data/ui-test' }, project)
    expect(config).toMatchObject({
      baseUrl: 'http://a',
      channel: 'msedge',
      pluginDir: '/work/proj/.litecode/plugins/ui-test',
      scenarioDir: '/work/proj/.litecode/plugins/ui-test/scenarios',
      reportDir: '/work/proj/.litecode/plugins/ui-test/reports',
      scenarioDirRel: '.litecode/plugins/ui-test/scenarios',
      reportDirRel: '.litecode/plugins/ui-test/reports',
      dataDir: '/data/ui-test',
    })
    expect(PLUGIN_DIR).toBe('.litecode/plugins/ui-test')
    expect(configFromEnv({ UI_TEST_BROWSER: '' }, project).channel).toBe('chrome')
  })

  it('옛 설정(testDir → UI_TEST_DIR · UI_TEST_REPORT_DIR)이 env 로 와도 무시한다', () => {
    const config = configFromEnv({ UI_TEST_DIR: 'qa/ui', UI_TEST_REPORT_DIR: '/share/reports' }, project)
    expect(config).toMatchObject({ scenarioDir: '/work/proj/.litecode/plugins/ui-test/scenarios', reportDir: '/work/proj/.litecode/plugins/ui-test/reports' })
  })

  it('코드 파일 경로는 프로젝트 안만 — .. · 절대 경로 거절', () => {
    expect(insideProject(project, 'qa/ui', '코드 파일')).toBe('/work/proj/qa/ui')
    expect(() => insideProject(project, '../other', '코드 파일')).toThrow(/밖/)
    expect(() => insideProject(project, '/tmp/x', '코드 파일')).toThrow(/상대 경로/)
  })

  it('쓰기 전 실제 경로 확인 — 없는 경로는 가까운 윗 폴더로, 심볼릭 링크가 밖을 가리키면 거절', async () => {
    const real = mkdtempSync(path.join(tmpdir(), 'ui-test-guard-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'ui-test-guard-out-'))
    try {
      expect(await guardPluginPath(real, path.join(real, PLUGIN_DIR, 'reports', 'r1', 'index.html'))).toContain('reports')
      await expect(guardPluginPath(real, path.join(real, 'ui-tests', 'a.md'))).rejects.toThrow('플러그인 폴더')
      await expect(guardPluginPath(real, path.join(real, PLUGIN_DIR, '..', 'x'))).rejects.toThrow('플러그인 폴더')
      mkdirSync(path.join(real, PLUGIN_DIR), { recursive: true })
      symlinkSync(outside, path.join(real, PLUGIN_DIR, 'reports'))
      await expect(guardPluginPath(real, path.join(real, PLUGIN_DIR, 'reports', 'r1', 'index.html'))).rejects.toThrow('플러그인 폴더')
      expect(await guardPluginPath(real, path.join(real, PLUGIN_DIR, 'scenarios', 'a.md'))).toContain('scenarios')
    } finally {
      rmSync(real, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('비밀 값 지우기', () => {
    expect(scrub('pw=s3cret! again s3cret!', ['s3cret!', ''])).toBe('pw=**** again ****')
  })
})
