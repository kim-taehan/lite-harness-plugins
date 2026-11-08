---
name: convention-review
description: "커밋 전에 바뀐 내용(git diff --cached + git diff)을 .claude/rules 의 플러그인 표준과 대조해 위반을 보고하고, 위반이 없으면 심사 상태를 기록한다. 커밋 훅이 '규칙 심사가 필요합니다' 라며 막았을 때, 또는 커밋 전에 표준을 점검하고 싶을 때 (/convention-review)."
---

# convention-review — 플러그인 표준 커밋 심사

커밋 훅(`.claude/hooks/require-convention-review.mjs`)은 이 스킬의 마지막 단계가 기록한 상태와
지금 변경이 같을 때만 커밋을 통과시킨다. **4단계 상태 저장까지 끝까지 한다.**

## 절차

1. **규칙 읽기** — `.claude/rules/` 의 마크다운을 전부 읽는다. 새로 생긴 규칙 파일도 자동으로 대상이다.
2. **심사 범위** — `git diff --cached`(스테이징) + `git diff`(미스테이징). 둘 다 비면 `git show HEAD` 를 대신 심사한다.
   새 파일은 `git add` 해야 diff 에 들어온다 — 커밋할 파일을 먼저 스테이징한다.
3. **대조와 보고** — 변경을 규칙 하나하나와 대조한다. 위반마다 규칙(파일·번호), 파일, 줄을 적는다. 없으면 "위반 없음".
   - 위반이 있으면 먼저 고치고 2단계부터 다시 한다. 위반을 남긴 채 4단계로 가지 않는다.
   - **[검토]** 규칙은 위반이 아니라 확인 질문으로만 남긴다. **[필수]** 는 위반이다.
   - `build.mjs` 가 바뀐 mcp 플러그인은 `node plugins/<id>/build.mjs --dir` 을 한 번 돌려, `build/<id>/` 맨 위에 manifest 와 `mcp.command` 파일이 있는지 본다(규칙 17). 테스트는 `--dir` 이 적혀 있는지만 본다.
   - `— 테스트` 가 붙은 규칙도 눈으로 본다. 테스트는 머지 때에야 돌기 때문이다. 플러그인 원본이나 `tests/standards.test.ts` 가 바뀌었으면 `npx vitest run tests` 를 돌려 본다.
   - **desktop 정본 대조** — 옆에 desktop 저장소(`../desktop`)가 있으면 `tests/standards.test.ts` 의 `KNOWN_FIELDS` · `PERMISSIONS` · `ID` 를
     desktop `src/services/extensions/manifest.ts` 의 `KNOWN`(= `REQUIRED` + 나머지), `shared/extensions.ts` 의 `EXTENSION_PERMISSIONS` · `EXTENSION_ID` 와 비교한다.
     서비스 선언도 본다: 테스트의 `EVENT_PERMISSION` · `APP_ONLY_EVENTS`(소식 ↔ 권한 표)와 `sdk/` 의 `ServiceEventName` · `ServiceInjectKey` 를 desktop `shared/extensions/serviceApi.ts`(`SERVICE_EVENTS` · `SERVICE_INJECT_ALLOWLIST` · `SERVICE_API_LATEST`)와,
     `PAIRED` 를 `shared/extensions/declarations.ts` 의 `PLUGIN_DECLARATIONS`(permission 이 있는 행)와 비교한다.
     다르면 위반으로 적고 테스트와 `rules/plugin.md` 를 desktop 에 맞춘다. desktop 이 없으면 "desktop 대조 못 함" 이라고만 적는다.
   - **`sdk/` 대조** — 옆 desktop 이 있으면 `node scripts/sync-sdk.mjs --check` 를 돌려 `sdk/` 가 desktop `docs/plugin-sdk/` 생성물과 같은지 본다(다르면 위반 — `npm run sync:sdk` 로 복사하고 desktop 이 dev 최신인지 확인). 위치가 다르면 `LITECODE_DESKTOP=<desktop 폴더>`.
   - **서비스 플러그인이 바뀌었으면**(manifest `service` · `service/` 소스) 24번 금지 사항(cordis import · 직접 `fetch(` · `node:http` 등 · `args` 비밀)을 눈으로도 본다 — 테스트는 소스 글자만 보고, 일부러 가린 코드는 못 잡는다. 서비스 코드가 오래 걸리는 일 · 동기 루프를 하지 않는지(11번), 상태를 패널과 따로 쓰지 않는지(25번)도 본다.
4. **상태 저장 (필수, 마지막)** —
   ```sh
   node .claude/hooks/convention-state.mjs store
   ```
   "스테이징 diff + 워크트리 diff + 규칙 파일" 지문을 `.claude/.convention-state` 에 적는다(git 에 올리지 않음). 이후 변경이나 규칙이 바뀌면 다시 심사해야 한다.
