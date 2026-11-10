# 작업 흐름

plugins 저장소의 브랜치 · 머지 · 배포 흐름. desktop 저장소와 같은 `dev` → `main` 구조다.
- 훅(`.claude/hooks/`)이 막는 것은 괄호에 적었다. 나머지는 커밋 심사(`/convention-review`)와 사람이 지킨다.

1. 브랜치는 `dev` 에서 만든다. 이름은 `feat/…` · `fix/…` · `docs/…` 처럼 무엇을 하는지 드러낸다.
2. PR 은 `dev` 로 보낸다. `main` 은 배포가 올라간 상태만 담는다 — `main` 으로 가는 PR 은 `dev` 를 올리는 승격 PR 뿐이다.
3. `main` · `dev` 에 바로 push 하지 않는다. 늘 브랜치 → PR 이다. (훅이 막는다 — `block-protected-push.mjs`)
4. 머지 조건은 `npm run test:changed` 의 **종료 코드 0** 이다 — 바뀐 플러그인의 테스트와 저장소 공통 검사(표준 · catalog ↔ dist 정합). 기준 브랜치는 `origin/dev`(없으면 `origin/main`)다. GitHub 의 CI 는 쓰지 않는다. (`gh pr merge` 앞에서 훅이 돌린다 — `check-before-merge.mjs`)
5. 커밋 전에 `/convention-review` 로 변경을 표준과 대조한다. (훅이 심사 없는 커밋을 막는다) 앱이 설치를 거절할 manifest(`name` 80 · `description` 300 · `details` 2000자 초과, 폴더 이름 ≠ id, 깨진 JSON)와 `tests/standards.test.ts` 실패도 커밋 앞에서 막는다. (`check-manifest.mjs` — 심사 훅이 훈련이 아니라 검사로 걸리게 한다)
6. **배포는 `dev` 에서 하지 않는다.** `dev` 에서는 코드만 머지한다. 올릴 때는 `dev` 에서 `release/<날짜>` 브랜치를 만들어 `npm run release -- --changed` 를 돌리고(catalog 에 없거나 version 이 다른 플러그인만 올라간다, `--dry-run` 으로 목록만 먼저 본다) `catalog.json` · `dist/` 변경을 PR 로 `dev` 에 머지한 뒤, `dev` → `main` 승격 PR 을 올린다. 사용자에게 나가는 일이라 올리기 전에 사용자 확인을 받는다.
7. 원본을 바꿨으면 `version` 을 올린다 — 올리지 않으면 `--changed` 가 그 플러그인을 올리지 않는다. (push 훅이 경고한다 — `warn-version.mjs`)

desktop 에 있지만 여기서는 아직 쓰지 않는 것: 이슈를 먼저 만드는 규칙, `feat_<이슈>_…` 브랜치 이름, PR 제목 형식(`<무엇을 왜> (#이슈)`), `kind:` 라벨, 머지 대기열(`merge-pr.mjs`), 리뷰 에이전트. 필요해지면 그때 더한다.
