import { describe, expect, it } from 'vitest'
import { normalizeRoute, pathOf, routePattern, routesOf } from '../server/tag.ts'

// 화면 태그 — "확인:" 단계를 실행한 순간의 주소 → 라우트 패턴

describe('화면 태그 라우트 패턴', () => {
  it('호스트 · 쿼리를 버리고 경로만, 끝 슬래시는 뗀다', () => {
    expect(pathOf('http://a.local:8080/admin/menu?token=abc#top')).toBe('/admin/menu')
    expect(pathOf('http://a/')).toBe('/')
    expect(pathOf('/orders/')).toBe('/orders')
    expect(pathOf('http://a/x//y')).toBe('/x/y')
    expect(pathOf('http://[bad')).toBeUndefined()
  })

  it('해시 라우터면 # 뒤 경로를 쓴다', () => {
    expect(pathOf('http://a/app/#/admin/menu/7?x=1')).toBe('/admin/menu/7')
    expect(pathOf('http://a/page#section')).toBe('/page')
  })

  it('숫자 · uuid · 긴 해시 마디는 :id, 이름 같은 마디는 그대로', () => {
    expect(routePattern('/admin/menu/12')).toBe('/admin/menu/:id')
    expect(routePattern('/u/3f2a9c1b-7d04-4e11-9a0b-1c2d3e4f5a6b/edit')).toBe('/u/:id/edit')
    expect(routePattern('/f/0123456789abcdef0123')).toBe('/f/:id')
    expect(routePattern('/t/Ab12Cd34Ef56Gh78Ij90Kl')).toBe('/t/:id')
    expect(routePattern('/device-activity')).toBe('/device-activity')
    expect(routePattern('/internationalization-settings')).toBe('/internationalization-settings')
    expect(routePattern('/')).toBe('/')
  })

  it('routesOf — 처음 본 차례 · 겹침 없이, 주소가 아닌 것은 건너뛴다', () => {
    expect(routesOf(['/login', '/admin/menu/1', 'http://a/admin/menu/2?x', '/login', 'http://[bad'])).toEqual(['/login', '/admin/menu/:id'])
  })

  it('normalizeRoute — AI 가 머리에 쓴 값을 맞춘다', () => {
    expect(normalizeRoute('login')).toBe('/login')
    expect(normalizeRoute('/admin/menu/12/')).toBe('/admin/menu/:id')
    expect(normalizeRoute('http://a/b')).toBe('/b')
  })
})
