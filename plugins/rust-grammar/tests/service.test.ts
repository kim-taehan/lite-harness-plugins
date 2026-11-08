// 문법 팩 서비스 — 앱 없이 SDK 가짜 host 로 본다. SDK 사본에 host.grammars · host.dir 가 아직 없어 가짜 host 에 덧붙인다.
// 앱이 서비스를 올려 실제 파일 개요에 새 언어가 보이는 것은 앱에서 확인한다(여기서 못 본다).
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const here = path.resolve(import.meta.dirname, '..')
const root = path.resolve(here, '..', '..')
const id = path.basename(here)
type Grammar = { id: string; label: string; extensions: string[]; wasm: string; definitions: Record<string, unknown> }
const grammars = JSON.parse(readFileSync(path.join(here, 'grammars.json'), 'utf8')) as Grammar[]
const manifest = JSON.parse(readFileSync(path.join(here, 'plugin.json'), 'utf8')) as Record<string, unknown>
let bundle: (host: unknown) => never

beforeAll(async () => {
  const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  bundle = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString('base64')}`)).default
})

/** 가짜 host 에 host.grammars 를 덧붙여 올린다 — 올린 문법과 걷힌 문법을 센다 */
function start() {
  const fake = createFakeHost({ id, scope: 'app' })
  const registered = new Map<string, Grammar>()
  const grammarsHost = {
    register(grammar: Grammar) {
      registered.set(grammar.id, grammar)
      return () => void registered.delete(grammar.id)
    },
  }
  fake.mount((host) => bundle({ ...host, dir: here, grammars: grammarsHost }))
  return { fake, registered }
}

describe(`${id} 서비스`, () => {
  it('manifest 는 앱 전체용 서비스 하나 — 문법 팩 선언(type · grammars · entry)이 없다', () => {
    expect(manifest).toMatchObject({ id, scope: 'app', permissions: ['service'], service: { main: 'service.mjs', api: 1 } })
    for (const field of ['type', 'grammars', 'entry', 'mcp']) expect(manifest[field]).toBeUndefined()
  })

  it('올라오면 선언한 문법을 모두 올린다', () => {
    const { registered } = start()
    expect([...registered.values()]).toEqual(grammars)
  })

  it('문법 선언은 앱 검사의 모양이다 — id · 확장자 · wasm 이름 · 정의 표', () => {
    for (const grammar of grammars) {
      expect(grammar.id).toMatch(/^[a-z0-9-]{1,40}$/)
      expect(grammar.label.trim()).not.toBe('')
      expect(grammar.label.length).toBeLessThanOrEqual(40)
      expect(grammar.extensions.length).toBeGreaterThan(0)
      for (const ext of grammar.extensions) expect(ext).toMatch(/^[a-z0-9_+-]{1,16}$/)
      expect(grammar.wasm).toMatch(/^[A-Za-z0-9_.-]+\.wasm$/)
      expect(Object.keys(grammar.definitions).length).toBeGreaterThan(0)
    }
    expect(new Set(grammars.flatMap((g) => g.extensions)).size).toBe(grammars.flatMap((g) => g.extensions).length)
  })

  it('문법마다 한 번씩만 올린다 — 걷는 일은 앱이 서비스를 내릴 때 한다', () => {
    const calls: string[] = []
    const fake = createFakeHost({ id, scope: 'app' })
    fake.mount((host) => bundle({ ...host, dir: here, grammars: { register: (grammar: Grammar) => (calls.push(grammar.id), () => undefined) } }))
    expect(calls).toEqual(grammars.map((g) => g.id))
  })

  it('묶은 서비스는 한 파일이고 설치 폴더 기준 경로나 직접 네트워크를 쓰지 않는다', async () => {
    const out = await build({ entryPoints: [path.join(here, 'service/index.mjs')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
    expect(out.outputFiles).toHaveLength(1)
    const text = out.outputFiles[0]!.text
    expect(text).not.toMatch(/import\.meta\.(url|dirname)|fetch\(|WebSocket|node:http|cordis/)
  })

  it('묶으면 plugin.json · service.mjs · LICENSE · wasm 이 일반 파일로 폴더에 있다', () => {
    execFileSync(process.execPath, [path.join(here, 'build.mjs'), '--dir'], { cwd: root, stdio: 'pipe' })
    const out = path.join(root, 'build', id)
    for (const name of ['plugin.json', 'service.mjs', 'LICENSE', ...grammars.map((g) => g.wasm)]) {
      const file = path.join(out, name)
      expect(existsSync(file), `${name} 가 없습니다`).toBe(true)
      const info = lstatSync(file)
      expect(info.isFile() && !info.isSymbolicLink()).toBe(true)
      expect(info.size).toBeGreaterThan(0)
    }
    expect(existsSync(path.join(out, 'extension.json'))).toBe(false)
    expect(lstatSync(path.join(out, grammars[0]!.wasm)).size).toBeLessThanOrEqual(50 * 1024 * 1024)
  })
})
