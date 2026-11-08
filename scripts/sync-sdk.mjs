// sdk/ 동기화 — desktop 의 docs/plugin-sdk/ 생성물을 sdk/ 로 복사한다. desktop 이 원본이고 plugins 가 복사해 쓴다(desktop 은 읽기만 한다).
//   node scripts/sync-sdk.mjs           옆 desktop 의 생성물을 sdk/ 로 복사
//   node scripts/sync-sdk.mjs --check   복사하지 않고 같은지만 본다(다르면 종료 코드 1)
// desktop 위치: 이 저장소 옆 ../desktop. 다른 곳이면 LITECODE_DESKTOP=<desktop 폴더>. 옆에 desktop 이 없으면 건너뛴다(종료 코드 0).
// 생성물이 최신이려면 desktop 이 dev 최신이어야 한다 — 다르면 desktop 쪽을 갱신(pull)한 뒤 다시 돌린다.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const SDK_FILES = ['README.md', 'litecode-service.d.ts', 'litecode-service-testing.mjs', 'litecode-service-testing.d.mts', 'plugin-service.schema.json']

const root = path.resolve(import.meta.dirname, '..')
const ownSdk = path.join(root, 'sdk')

/** 옆 desktop 의 plugin-sdk 폴더 — 없으면 undefined */
export function desktopSdk() {
  const desktop = process.env['LITECODE_DESKTOP'] ? path.resolve(process.env['LITECODE_DESKTOP']) : path.resolve(root, '..', 'desktop')
  const dir = path.join(desktop, 'docs', 'plugin-sdk')
  return existsSync(dir) ? dir : undefined
}

/** 파일마다 같은가 — { file, state: 'same' | 'differs' | 'missing-own' | 'missing-desktop' } */
export function compare(source) {
  return SDK_FILES.map((file) => {
    const from = path.join(source, file)
    const own = path.join(ownSdk, file)
    if (!existsSync(from)) return { file, state: 'missing-desktop' }
    if (!existsSync(own)) return { file, state: 'missing-own' }
    return { file, state: readFileSync(from).equals(readFileSync(own)) ? 'same' : 'differs' }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = desktopSdk()
  if (!source) {
    console.log('옆 desktop 없음 (../desktop/docs/plugin-sdk) — 건너뜁니다. 다른 위치면 LITECODE_DESKTOP=<desktop 폴더>')
    process.exit(0)
  }
  const result = compare(source)
  if (process.argv.includes('--check')) {
    const bad = result.filter((entry) => entry.state !== 'same')
    for (const entry of result) console.log(`${entry.state === 'same' ? '같음  ' : '다름  '} ${entry.file}${entry.state === 'same' ? '' : ` (${entry.state})`}`)
    if (bad.length > 0) {
      console.error('sdk/ 가 desktop docs/plugin-sdk/ 와 다릅니다 — npm run sync:sdk 로 복사하세요.')
      process.exit(1)
    }
    process.exit(0)
  }
  mkdirSync(ownSdk, { recursive: true })
  for (const entry of result) {
    if (entry.state === 'missing-desktop') {
      console.error(`desktop 에 ${entry.file} 가 없습니다 — 건너뜁니다.`)
      continue
    }
    if (entry.state === 'same') continue
    copyFileSync(path.join(source, entry.file), path.join(ownSdk, entry.file))
    console.log(`복사 ${entry.file}`)
  }
  console.log('sdk/ 동기화 끝')
}
