# 플러그인 표준

플러그인을 만들거나 고칠 때 지키는 규칙. 왜 그런지와 예제는 `docs/guides/` 가이드에 있다.
- **[필수]** 는 어기면 위반이다. 커밋 전 `/convention-review` 가 잡고, `— 테스트` 가 붙은 것은 `tests/standards.test.ts` 가 머지 전에 한 번 더 막는다.
- **[검토]** 는 위반이 아니라 확인 질문으로 남긴다.
- 정본은 desktop 코드다: manifest 는 `src/services/extensions/manifest.ts`, 권한·id 는 `shared/extensions.ts`, 앱 통로는 `calls/table.ts`, 서비스 선언·소식·허용 목록은 `shared/extensions/serviceApi.ts` · `declarations.ts`(사본은 `sdk/`). 여기와 어긋나면 코드를 따르고 이 파일을 고친다.
- 코드를 가진 플러그인은 **서비스**(`service` 선언)가 기본이다(desktop #1614). `tools` · `mcp` · `lsp` 선언은 별도 프로세스가 맞는 일에 쓰고, 서비스가 `host.mcp.register` 로 올리기도 한다. 옛 선언 방식(`type: locale/grammar`, 패널이 앱 통로로 직접 부르기)은 desktop 이 지우기 전까지 병행한다.

## manifest
1. **[필수]** 폴더는 `plugins/<id>/` 하나 — 폴더 이름과 manifest 의 `id` 가 같다. 분류별 하위 폴더를 만들지 않는다. — 테스트
2. **[필수]** `id` 는 소문자·숫자·`-` 로 3~40자, `version` 은 `주.부.수`. — 테스트
3. **[필수]** manifest 에는 앱이 아는 필드만 쓴다. 모르는 필드가 하나라도 있으면 설치가 거절된다 — 메모·분류(`category`)·`changes` 를 넣지 않는다. 분류는 `categories.json`, 업데이트 글은 `changes.txt`. — 테스트
4. **[필수]** 새 플러그인의 manifest 파일 이름은 `plugin.json`. `extension.json` 은 옛 플러그인에만 남는다.
5. **[필수]** `permissions` 는 앱이 아는 값만(`network` · `secrets` · `project` · `projectWrite` · `chat` · `tools` · `mcp` · `usage` · `llm` · `lsp` · `service`). `tools` · `mcp` · `lsp` · `service` 는 같은 이름의 선언과 권한이 둘 다 있거나 둘 다 없다. — 테스트
   서비스가 `host.mcp.register` · `host.tools.register` 로 올린 서버 · 도구는 `service` 권한만 필요하다(`mcp` · `tools` 권한과 선언은 필요 없다). 서비스는 `host.call('secrets.get')` 을 부를 수 없다 — 비밀은 8번.
6. **[검토]** 권한은 실제로 부르는 앱 통로에 필요한 것만 적는다. 업데이트에서 권한이 늘면 사용자가 다시 허락해야 한다 — 늘렸다면 PR 에 이유를 적는다.

## 폐쇄망 · 비밀 값
7. **[필수]** 런타임 다운로드와 바깥 요청을 하지 않는다. 필요한 것은 zip 에 담는다 — 패널은 CDN 을 쓰지 않고(앱의 CSP 도 막는다), MCP 서버는 의존성까지 묶는다(`build.mjs` + esbuild, 묶이지 않는 패키지는 `server/node_modules` 로 옆에 싣기), 서비스는 한 파일 `service.mjs`(4MB 이하)로 묶고 cordis 를 가져오지 않는다(바깥 요청은 `host.fetch` 만 — 24번). 사용자가 적은 주소(사내 서버 등)로 가는 요청은 그 플러그인의 일이므로 된다. — 패널의 바깥 `<script>`·`<link>` 는 테스트
8. **[필수]** 토큰·비밀번호는 코드나 manifest 에 쓰지 않는다. 설정의 `secret` 칸(`type: "secret"`) → `${secret:<키>}` 로 `mcp.env`(서비스가 올리는 서버는 `host.mcp.register` 의 `env`)에만 넘기고, `args` 에는 넣지 않는다(프로세스 목록에 보인다). 서비스 코드는 비밀 값을 읽지 못한다. — manifest `mcp.args` · 서비스 소스의 `args` 는 테스트
9. **[필수]** 번들에 들어가는 의존성은 루트 `package.json` 에 버전을 고정해 둔다(`1.2.3`, `^`·`~` 없이). — 테스트

## 앱과의 경계
10. **[필수]** 패널은 앱 통로(`postMessage` 의 `{ litecode: 1, id, method, params }`, 응답은 `{ litecode: 1, id, ok, result | error }`)로만 앱에 닿는다. 앱 내부 파일·전역·DOM 을 가정하지 않는다. 서비스 플러그인의 패널은 앱 기능을 직접 부르지 않고 `service.call`(`{ name, params }`) 한 통로로 서비스에 맡기며 서비스가 `host.call` 로 부른다. 서비스가 밀어 보내는 소식은 `events.subscribe(['service.<이름>'])` 로 받는다. 옛 선언 방식 플러그인은 앱 통로를 직접 쓴다(병행 기간).
11. **[필수]** MCP 서버는 앱의 Node 로 뜬다(`ELECTRON_RUN_AS_NODE`). 시스템에 깔린 Node·npm·전역 패키지를 가정하지 않는다. 작업 폴더는 도구를 부른 프로젝트 폴더다. 서비스는 앱 프로세스 안에서 앱과 같은 권한으로 돈다 — 오래 걸리는 일 · 동기 루프 · 무거운 라이브러리는 메인 프로세스를 멈추니 별도 프로세스(MCP 서버)로 두고, 정리(`ctx.effect` · `projectOn` 해제)는 1초 안에 끝내고, 번들은 작게 둔다(켜기 · 다시 설치마다 번들 크기만큼 메모리가 남는다).
12. **[검토]** 앱에 없는 자리가 필요하면 플러그인에서 우회하지 말고 desktop 에 일반 기능으로 더하는 이슈를 낸다(`docs/architecture.md` "새 자리를 더하려면").

## 버전 · 배포
13. **[필수]** zip 에 들어가는 원본을 바꾸면 `version` 을 올린다. MCP 도구를 더하거나 바꿨으면 반드시 — 앱은 도구 목록을 버전마다 한 번 기억한다. (push 훅이 경고한다)
14. **[검토]** 사용자가 알아야 할 변경이면 `changes.txt` 에 한 줄씩 적는다.
15. **[필수]** `dist/` 와 `catalog.json` 은 `npm run release` 로만 바꾼다. 플러그인을 없앨 때도 먼저 `categories.json` 을 `unlisted` 로 두고 release 해 목록에서 내린 뒤 원본 폴더와 분류 줄을 지운다. (편집 훅이 막고, `tests/catalog.test.ts` 가 정합을 본다)
16. **[검토]** 도구·서버 로직을 바꾸면 `plugins/<id>/tests/` 에 동작을 보는 테스트를 더하거나 고친다. 실제 DB·서버가 필요한 확인은 테스트 대신 PR 에 "확인 못 한 것" 으로 적는다.
17. **[필수]** `mcp` 또는 `service` 선언과 `build.mjs` 가 같이 있는 플러그인의 build.mjs 는 `--dir` 을 받아 zip 과 같은 내용을 `build/<id>/` 폴더로 낸다. 원본 폴더는 묶기 전이라 앱이 띄울 수 없어서, 앱의 개발 모드(desktop #1348)는 이 폴더를 연결한다. — 테스트
18. **[필수]** `mcp.attach` 는 `litecode`(기본) · `server` 만 쓴다. `server` 면 id 가 `litecode` 이면 안 된다(예약 이름, 설치 거절). — 테스트
19. **[검토]** 도구가 많거나 사용자가 도구를 골라 쓰게 할 플러그인은 `attach: "server"` 를 검토한다. 방식을 바꾸면 스킬에 적힌 도구 이름(`litecode_<id>_<도구>` ↔ `<id>_<도구>`)도 같이 고친다.
20. **[필수]** 새 플러그인(아직 `catalog.json` 에 없는 id)은 `scope` 를 적는다 — 앱 전체용이면 `"app"`, 프로젝트마다 다르게 켜면 `"project"`. 만들기 전에 가장 먼저 정한다(`docs/README.md` "먼저 정할 것"). 옛 선언 방식 언어 팩 · 문법 팩(`type: "locale" · "grammar"`)은 적지 않는다(설치 거절 `scope-invalid`). 서비스로 만든 팩은 `"app"` 을 적는다 — 언어 · 문법 등록은 앱 전체용 서비스만 된다. — 테스트
21. **[검토]** 이미 배포된 플러그인은 다음 업데이트 때 `scope` 를 적는다(manifest 를 바꾸면 version 도 올린다 — 13번). `project` 플러그인은 `docs/architecture.md` "적용 범위" 의 주의점(저장 칸 · dataDir · 도구 목록은 프로젝트 없이 물음)을 확인한다.

## 문서
22. **[필수]** 플러그인 폴더마다 `README.md` 를 두고 `## 역할`(하는 일 · 앱에 닿는 자리 · 범위 · 권한마다 이유) · `## 구성`(파일 · 폴더마다 하는 일) · `## 개발`(묶기 · 테스트 · 배포) 세 절을 쓴다. 형식은 `docs/README.md` "플러그인마다 README.md". 서비스 플러그인은 `## 구성` 에 서비스 원본(`service/…`) · `build.mjs` · 패널이 부르는 `expose` 이름 · 서비스가 받는 소식을 적고 `## 개발` 에 앱에서 못 본 것을 적는다. zip 에는 들어가지 않는다(release 가 뺀다). — 테스트

## 서비스
23. **[필수]** 서비스 선언(`service`)은 `main` 이 플러그인 폴더 안 `.mjs` 한 파일, `api` 가 1 이상 정수(앱이 아는 최신 이하), `events` · `inject` 가 허용 목록 안이다. 허용 목록은 `sdk/litecode-service.d.ts` 의 `ServiceEventName`(지금 `chat.turnEnded` · `project.filesChanged` · `usage.changed`) · `ServiceInjectKey`(`projects` · `usage`)다. 소식은 패널과 같은 권한을 가져야 하고(`chat.turnEnded` → `chat`, `project.filesChanged` → `project`, `usage.changed` → `usage`) `usage.changed` 는 프로젝트를 모르니 `scope: "app"` 만 받는다. 서비스 플러그인은 `scope` 를 적는다(20번). — 테스트
24. **[필수]** 서비스 소스(`service/` 아래 `.mjs` · `service.main` 파일)는 cordis 를 가져오지 않고(`from 'cordis'` 등 — 호스트가 넘기는 `host.Service` 를 쓴다), 직접 바깥 요청을 하지 않으며(전역 `fetch(` · `WebSocket` · `node:http` · `https` · `http2` · `net` · `tls` · `dns` · `dgram` · `undici` — `host.fetch` 만, 설치 검사도 거절한다 `service-network-direct`), 비밀 값을 `args` 에 넣지 않는다. MCP 서버 쪽 코드(`server/` 등 서비스 소스 밖)는 해당 없다. — 테스트
25. **[검토]** 서비스와 패널이 같은 상태를 따로 쓰지 않는다(나중에 쓴 쪽이 이긴다). 서비스가 상태를 들고 패널은 `service.call` 로 읽기만 하거나, 키를 나눈다. 작은 영구 값은 `host.call('storage.*')`, 목록으로 쌓는 이력 · 색인 · 상태는 `host.db`(서비스 전용, 호스트 API 2 — MCP 서버 프로세스에서는 못 쓴다)를 쓴다. 프로젝트별(`scope: "project"`) 서비스는 `host.call` 에 `{ directory }` 를 넘기고, 프로젝트 몫 자원은 `projectOn` 이 돌려준 함수로 되돌린다.
26. **[검토]** AI 도구 이름을 확인한다: 서비스가 `host.tools.register` 로 올린 도구는 `<id>_<도구>`, 서비스가 `host.mcp.register`(또는 manifest `mcp`)로 올린 서버의 도구는 기본 `litecode_<id>_<도구>`, `attach: "server"` 면 `<id>_<도구>` 다. 스킬 본문의 도구 이름이 이와 같은지 본다(19번).
27. **[필수]** `sdk/` 는 desktop `docs/plugin-sdk/` 생성물의 사본이다 — 손으로 고치지 않고 `npm run sync:sdk` 로 옆 desktop 에서 복사한다. 옆 desktop 이 있으면 같은지 `node scripts/sync-sdk.mjs --check` 가 보고 테스트도 막는다. — 테스트(옆 desktop 이 있을 때)
