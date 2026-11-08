import { existsSync, readdirSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// 테스트는 플러그인마다 프로젝트 하나(이름 = 플러그인 id)와 저장소 공통 검사(repo: 표준 · catalog 정합)로 나눈다.
// npm test 는 전부, npm test -- --project <id> 는 그 플러그인만, npm run test:changed 는 바뀐 플러그인만(머지 훅).
const withTests = readdirSync('plugins', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(`plugins/${entry.name}/tests`))
  .map((entry) => entry.name)

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'repo', include: ['tests/**/*.test.ts'] } },
      ...withTests.map((id) => ({ test: { name: id, include: [`plugins/${id}/tests/**/*.test.ts`] } })),
    ],
  },
})
