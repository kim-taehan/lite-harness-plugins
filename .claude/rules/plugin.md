# 플러그인 표준

플러그인을 만들거나 고칠 때 지키는 규칙. 왜 그런지와 예제는 `docs/guides/` 가이드에 있다.
- **[필수]** 는 어기면 위반이다. 커밋 전 `/convention-review` 가 잡고, `— 테스트` 가 붙은 것은 `tests/standards.test.ts` 가 머지 전에 한 번 더 막는다.
- **[검토]** 는 위반이 아니라 확인 질문으로 남긴다.
- 정본은 desktop 코드다: manifest 는 `src/services/extensions/manifest.ts`, 권한·id 는 `shared/extensions.ts`, 앱 통로는 `calls/methods.ts`. 여기와 어긋나면 코드를 따르고 이 파일을 고친다.

## manifest
1. **[필수]** 폴더는 `plugins/<id>/` 하나 — 폴더 이름과 manifest 의 `id` 가 같다. 분류별 하위 폴더를 만들지 않는다. — 테스트
2. **[필수]** `id` 는 소문자·숫자·`-` 로 3~40자, `version` 은 `주.부.수`. — 테스트
3. **[필수]** manifest 에는 앱이 아는 필드만 쓴다. 모르는 필드가 하나라도 있으면 설치가 거절된다 — 메모·분류(`category`)·`changes` 를 넣지 않는다. 분류는 `categories.json`, 업데이트 글은 `changes.txt`. — 테스트
4. **[필수]** 새 플러그인의 manifest 파일 이름은 `plugin.json`. `extension.json` 은 옛 플러그인에만 남는다.
5. **[필수]** `permissions` 는 앱이 아는 값만(`network` · `secrets` · `project` · `projectWrite` · `chat` · `tools` · `mcp` · `usage`). `mcp` 선언과 `mcp` 권한은 둘 다 있거나 둘 다 없다. — 테스트
6. **[검토]** 권한은 실제로 부르는 앱 통로에 필요한 것만 적는다. 업데이트에서 권한이 늘면 사용자가 다시 허락해야 한다 — 늘렸다면 PR 에 이유를 적는다.

## 폐쇄망 · 비밀 값
7. **[필수]** 런타임 다운로드와 바깥 요청을 하지 않는다. 필요한 것은 zip 에 담는다 — 패널은 CDN 을 쓰지 않고(앱의 CSP 도 막는다), MCP 서버는 의존성까지 묶는다(`build.mjs` + esbuild, 묶이지 않는 패키지는 `server/node_modules` 로 옆에 싣기). 사용자가 적은 주소(사내 서버 등)로 가는 요청은 그 플러그인의 일이므로 된다. — 패널의 바깥 `<script>`·`<link>` 는 테스트
8. **[필수]** 토큰·비밀번호는 코드나 manifest 에 쓰지 않는다. 설정의 `secret` 칸 → `${secret:<키>}` 로 `mcp.env` 에만 넘기고, `mcp.args` 에는 넣지 않는다(프로세스 목록에 보인다). — `mcp.args` 는 테스트
9. **[필수]** 번들에 들어가는 의존성은 루트 `package.json` 에 버전을 고정해 둔다(`1.2.3`, `^`·`~` 없이). — 테스트

## 앱과의 경계
10. **[필수]** 패널은 앱 통로(`postMessage` 의 `{ litecode: 1, id, method, params }`)로만 앱에 닿는다. 앱 내부 파일·전역·DOM 을 가정하지 않는다.
11. **[필수]** MCP 서버는 앱의 Node 로 뜬다(`ELECTRON_RUN_AS_NODE`). 시스템에 깔린 Node·npm·전역 패키지를 가정하지 않는다. 작업 폴더는 도구를 부른 프로젝트 폴더다.
12. **[검토]** 앱에 없는 자리가 필요하면 플러그인에서 우회하지 말고 desktop 에 일반 기능으로 더하는 이슈를 낸다(`docs/architecture.md` "새 자리를 더하려면").

## 버전 · 배포
13. **[필수]** zip 에 들어가는 원본을 바꾸면 `version` 을 올린다. MCP 도구를 더하거나 바꿨으면 반드시 — 앱은 도구 목록을 버전마다 한 번 기억한다. (push 훅이 경고한다)
14. **[검토]** 사용자가 알아야 할 변경이면 `changes.txt` 에 한 줄씩 적는다.
15. **[필수]** `dist/` 와 `catalog.json` 은 `npm run release` 로만 바꾼다. 플러그인을 없앨 때도 먼저 `categories.json` 을 `unlisted` 로 두고 release 해 목록에서 내린 뒤 원본 폴더와 분류 줄을 지운다. (편집 훅이 막고, `tests/catalog.test.ts` 가 정합을 본다)
16. **[검토]** 도구·서버 로직을 바꾸면 `plugins/<id>/tests/` 에 동작을 보는 테스트를 더하거나 고친다. 실제 DB·서버가 필요한 확인은 테스트 대신 PR 에 "확인 못 한 것" 으로 적는다.
