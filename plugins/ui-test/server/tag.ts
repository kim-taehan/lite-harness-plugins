// 화면 태그 — "확인:" 단계를 실행한 순간의 주소를 라우트 패턴으로 바꾼다.
// 주소의 호스트 · 쿼리는 버리고(토큰이 실릴 수 있다), `#/경로` 해시 라우터면 그 경로를 쓴다. 숫자 · uuid · 긴 해시 한 마디는 `:id`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONG_HEX = /^[0-9a-f]{16,}$/i
/** 20자 이상이면서 숫자와 영문자가 섞인 마디 (base64 · nanoid 따위 토큰) */
const LONG_TOKEN = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,}$/

/** 주소 → 경로 (`/admin/menu/12`). 주소로 읽을 수 없으면 undefined */
export function pathOf(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url, 'http://local')
  } catch {
    return undefined
  }
  const hash = /^#!?(\/[^?]*)/.exec(parsed.hash)
  const raw = hash ? hash[1]! : parsed.pathname
  const path = raw.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
  return path || '/'
}

const isIdSegment = (segment: string): boolean => /^\d+$/.test(segment) || UUID.test(segment) || LONG_HEX.test(segment) || LONG_TOKEN.test(segment)

/** 경로 → 라우트 패턴 (`/admin/menu/12` → `/admin/menu/:id`) */
export function routePattern(path: string): string {
  const parts = path.split('/').map((segment) => (segment && isIdSegment(segment) ? ':id' : segment))
  return parts.join('/') || '/'
}

/** 확인 단계가 본 경로들 → 라우트 패턴 (처음 본 차례 · 겹침 없이) */
export function routesOf(urls: readonly string[]): string[] {
  const out: string[] = []
  for (const url of urls) {
    const path = pathOf(url)
    if (path === undefined) continue
    const route = routePattern(path)
    if (!out.includes(route)) out.push(route)
  }
  return out
}

/** AI 가 머리 `screens:` 에 쓴 값 — 앞 슬래시를 맞추고 id 마디는 패턴으로 */
export function normalizeRoute(value: string): string {
  const path = pathOf(value.startsWith('/') || /^[a-z]+:\/\//i.test(value) ? value : `/${value}`)
  return path === undefined ? value : routePattern(path)
}
