# 작업 흐름

plugins 저장소의 브랜치 · 머지 · 배포 흐름. desktop 저장소와 같은 `dev` → `main` 구조다.
- 훅(`.claude/hooks/`)이 막는 것은 괄호에 적었다. 나머지는 커밋 심사(`/convention-review`)와 사람이 지킨다.

1. 브랜치는 `dev` 에서 만든다. 이름은 `feat/…` · `fix/…` · `docs/…` 처럼 무엇을 하는지 드러낸다.
2. PR 은 `dev` 로 보낸다. `main` 으로 가는 PR 은 `dev` 를 올리는 PR 뿐이다.
3. `main` · `dev` 에 바로 push 하지 않는다. 늘 브랜치 → PR 이다. (훅이 막는다 — `block-protected-push.mjs`)
4. 머지 조건은 `npm run test:changed` 의 **종료 코드 0** 이다 — 바뀐 플러그인의 테스트와 저장소 공통 검사(표준 · 분류). 기준 브랜치는 `origin/dev`(없으면 `origin/main`)다. GitHub 의 CI 는 쓰지 않는다. (`gh pr merge` 앞에서 훅이 돌린다 — `check-before-merge.mjs`)
5. 커밋 전에 `/convention-review` 로 변경을 표준과 대조한다. (훅이 심사 없는 커밋을 막는다)
6. **배포는 서버에 올리는 일이다.** 카탈로그 · sha256 · 순번 · 서명은 litecode-deploy 서버가 만들고, 이 저장소는 zip 만 만들어 넘긴다. `dev` 에서는 코드만 머지하고, 올릴 때는 머지가 끝난 `dev` 에서 **서버가 있는 PC 의 CLI 로** 올린다(원격 발행 없음) — `npm run release -- <id> --dry-run` 으로 명령을 먼저 보고, `npm run release -- <id>`(= `litecode-deploy plugin publish`)로 올린다. 사용자에게 나가는 일이라 **올리기 전에 사용자(리더) 확인**을 받는다. 되돌리기 · 내리기는 `plugin rollback <순번>` · `plugin remove <id>`. 개인키는 저장소 밖에 둔다. 저장소에는 `release/<날짜>` 브랜치도, `dev` → `main` 승격 PR 도 필요 없다(`main` 은 `dev` 를 따라가는 정리용으로만 둔다).
7. 원본을 바꿨으면 `version` 을 올린다 — 서버는 지금 발행된 것보다 낮은 버전을 거절하고, 같은 버전은 이미 설치한 PC 가 바뀐 줄 모른다. (push 훅이 경고한다 — `warn-version.mjs`)

desktop 에 있지만 여기서는 아직 쓰지 않는 것: 이슈를 먼저 만드는 규칙, `feat_<이슈>_…` 브랜치 이름, PR 제목 형식(`<무엇을 왜> (#이슈)`), `kind:` 라벨, 머지 대기열(`merge-pr.mjs`), 리뷰 에이전트. 필요해지면 그때 더한다.
