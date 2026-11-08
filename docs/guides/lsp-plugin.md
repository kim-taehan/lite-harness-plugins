[← 가이드 목록](../README.md)

# 언어 서버(LSP) 플러그인 만들기

언어 서버를 플러그인에 실어, 앱의 파일 보기와 AI 가 그 언어의 오류 · 정의 · 참조 · 설명을 정확하게 얻게 합니다. 서버 정의는 **서비스가 `host.lsp.register` 로 올립니다.** 실제 예는 java-lsp(동봉한 Java 런타임으로 Eclipse JDT LS 를 띄움 — [PR #29](https://github.com/kim-taehan/lite-harness-plugins/pull/29) 에서 작업 중이며 아직 manifest `lsp` 선언으로 쓰여 있습니다)입니다.

*약 30분 · 서비스 + `host.lsp.register` · 권한: service · 빌드: build.mjs (플랫폼 전용)*

## 서비스로 올린다

언어 서버 자체는 따로 띄운 프로세스입니다(앱이 띄우고 LSP 로 잇습니다). 플러그인이 하는 일은 **서버와 실행기를 싣고, 서비스가 어떤 서버를 언제 올릴지 정의를 앱에 넘기는 것**입니다.

- 서비스는 앱이 넘기는 `host` 로 만든 클래스이고, 생성자에서 `host.lsp.register({ … })` 를 부릅니다. 모양은 아래 [선언](#2-pluginjson-과-서비스)과 같습니다.
- **권한은 `service` 하나**입니다. `host.lsp.register` 에 `lsp` 권한은 필요 없습니다(desktop 확인). `scope` 는 `"project"` 가 어울립니다.
- 서비스가 켜지지 않은 프로젝트에서는 서버를 띄우지 않고, 서비스가 내려가면 올린 서버 정의도 걷힙니다. 같은 서비스에서 `languageId` · 확장자가 겹치게 올리면 `register` 가 던집니다.
- 서버 실행 파일은 **플러그인 폴더 안**의 것만 됩니다. `.mjs` · `.js` 가 아닌 실행 파일(동봉 바이너리 · 셸 스크립트)은 **zip 안에서 실행 비트를 가져야** 합니다 — 설치가 zip 에 실행 비트가 있던 일반 파일만 살리고, 심볼릭 링크와 폴더 밖 경로는 거절합니다(desktop #1643).
- 서비스 번들 자체의 규칙(한 파일 · cordis 없음 · 4MB · 정리 기한)은 [서비스 플러그인 만들기](service-plugin.md).

> **옛 경로: manifest `lsp` 선언**(`plugin.json` 의 `lsp` 배열 + `permissions: ["lsp"]`)은 곧 삭제됩니다(desktop 폐지 PR B). 새 플러그인은 쓰지 않습니다. 선언과 같은 모양을 `host.lsp.register` 에 주면 되고, 서버 정의 필드와 검사는 같습니다.

## 앱이 언어 서버를 다루는 법

앱(desktop `src/services/lsp/`)이 띄우고 LSP 로 잇습니다. 플러그인은 **서버와 실행기만** 싣고, 무엇을 언제 띄울지는 서비스가 `host.lsp.register` 로 올린 서버 정의가 정합니다.

- **켜진 프로젝트에서만.** 서비스가 켜지지 않은 프로젝트에서는 띄우지 않습니다. 그래서 `scope: "project"` 가 어울립니다.
- **필요할 때 띄움.** 그 확장자 파일을 파일 보기에서 열어 오류 · 경고를 물을 때, 또는 AI 가 `code_*` 도구를 부를 때 폴더마다 하나 띄웁니다.
  - worktree 는 따로 띄웁니다.
  - 앱 전체에서 동시에 2개까지만 돕니다. 넘으면 가장 오래 안 쓴 서버부터 내립니다.
  - `idleMs` 동안 쓰지 않으면 내립니다. 플러그인을 끄거나 지우거나 업데이트해도 내립니다.
- **화면.** 파일 보기에 다음이 얹힙니다:
  - 준비 칩("Java 준비 중 · N%")
  - 오류 · 경고 물결 밑줄과 줄 앞 점
  - 마우스 풍선(진단 + 타입 · 문서)
  - 문제 목록 서랍
- **AI.** 그 프로젝트에 켜졌을 때만 `code_diagnostics` · `code_hover` · `code_definition` · `code_references` 가 보입니다. 코드 탐색의 정의 · 참조 · 이름 찾기도 언어 서버로 정확해집니다.
- **준비.** `initialize` 가 끝나고 서버의 진행 알림(`$/progress`)이 모두 끝난 뒤 1초 동안 새 진행이 없으면 준비로 봅니다. 진행 알림을 보내지 않는 서버는 `initialize` 뒤 1.5초 조용하면 준비입니다.
- **앱이 지원하는 LSP 범위.**
  - 문서 동기화는 Full 만 씁니다 — 파일 보기가 읽기 전용이라, 디스크의 내용만 서버에 맞춥니다.
  - 파일 바뀜을 알리고(`didChangeWatchedFiles`), `workspace/configuration` 에 `settings` 로 답합니다.
  - 서버는 파일을 고칠 수 없습니다(`workspace/applyEdit` 거절).
- **실행.** `command` 가 `.mjs` · `.js` 면 앱 자신의 Node 로 돌리고(MCP 와 같음), 그 밖의 파일은 그대로 실행합니다. 실행 권한 비트는 설치 · 개발 모드 연결 때 보존됩니다(desktop #1429).

## 1. 폴더 구조

```
plugins/<id>/
  plugin.json          manifest — service 선언 · service 권한 · scope
  service/index.mjs    서비스 원본 — host.lsp.register 로 서버 정의를 올림 (build.mjs 가 service.mjs 한 파일로 묶음)
  server/<실행기>.mjs   동봉 런타임으로 언어 서버를 stdio 로 띄우는 실행기 (.mjs 가 아니면 zip 안에서 실행 비트)
  fetch-runtime.mjs    망 밖에서 런타임 · 서버를 고정 버전 · sha256 으로 받기 (build/vendor/<id>/<플랫폼>/)
  build.mjs            서비스 묶기 + --platform 별로 묶기, --dir 이면 개발 폴더
  tests/               실행기 · 서비스(가짜 host) 테스트
  README.md            역할 · 구성 · 개발 (표준 22번)
```

런타임과 서버 바이너리는 저장소에 넣지 않습니다. `build.mjs` 가 묶을 때 `build/vendor/` 에서 가져옵니다. 앱은 아무것도 내려받지 않습니다(표준 7번).

## 2. plugin.json 과 서비스

`plugins/<id>/plugin.json`

```json
{
  "id": "java-lsp",
  "name": "Java 언어 서버",
  "description": "…",
  "version": "0.1.0",
  "scope": "project",
  "permissions": ["service"],
  "service": { "main": "service.mjs", "api": 1 }
}
```

`plugins/<id>/service/index.mjs`

```js
export default (host) =>
  class JavaLsp extends host.Service {
    constructor(ctx) {
      super(ctx)
      host.lsp.register({
        languageId: 'java',
        extensions: ['java'],
        command: 'server/jdtls.mjs',
        args: ['-data', '${lspWorkspaceDir}'],
        env: { JAVA_OPTS: '-Xmx1g' },
        initializationOptions: { settings: { java: { import: { maven: { offline: { enabled: true } } } } } },
        settings: { java: { import: { gradle: { enabled: false } } } },
        idleMs: 600000,
      })
    }
  }
```

`register` 가 받는 모양은 SDK `litecode-service.d.ts` 의 `host.lsp.register`(`languageId` · `extensions` · `command` · `args` · `env` · `initializationOptions` · `settings` · `idleMs`)이고, 돌려주는 걷는 함수는 따로 부르지 않아도 됩니다(서비스가 내려가면 앱이 걷습니다). 한 서비스에서 서버를 둘 이상 올려도 됩니다(언어 + 빌드 파일). 서비스는 서버 정의만 올리고 다른 일은 하지 않습니다.

권한은 `service` 하나이고 `lsp` 권한은 쓰지 않습니다. 같은 서버 정의를 옛 manifest `lsp` 선언으로 적으면 `lsp` 권한이 필요했고, 둘이 어긋나면 `lsp-mismatch` 로 거절됐습니다 — 그 경로가 곧 삭제됩니다.

| 필드 | 뜻 · 제한 (옛 선언과 같은 검사 — desktop `shared/extensions/lspDeclaration.ts`) |
|---|---|
| (서버 수) | 옛 선언은 1~4개. 보통 하나(언어 + 빌드 파일이면 둘). `register` 의 개수 상한은 desktop 이 정합니다(이 가이드는 확인하지 못함) |
| `languageId` | LSP 언어 id — 영문 · 숫자 · `_.+-` 1~40자 |
| `extensions` | 맡을 확장자 — 점 없이 소문자, 1~16개. 한 플러그인 안 서버끼리 겹치면 거절 |
| `command` | 플러그인 폴더 안 상대 경로 |
| `args` | 고정 자리표시만: `${extensionDir}` · `${dataDir}` · `${projectDataDir}` · `${lspWorkspaceDir}` |
| `env` | 위 자리표시 + `${storage:<키>}` · `${secret:<키>}` — 비밀 값은 프로세스 목록에 보이는 `args` 가 아니라 여기로 |
| `initializationOptions` · `settings` | JSON 각 64KB 까지. 안의 글은 **고정 자리표시만** 풉니다 — 설정 칸 값(`${storage:…}`)은 여기서 풀리지 않으니 `env` 로 받아 실행기가 넘깁니다 |
| `idleMs` | 쉬면 내릴 때까지 — 1분 ~ 24시간 |

**`${lspWorkspaceDir}`** 는 그 프로젝트 자료 폴더 아래 `lsp/<폴더 해시>-<languageId>` 입니다. 폴더 · worktree · 언어마다 따로입니다. JDT LS 의 `-data` 처럼 서버가 작업 공간을 잠그는 경우, 둘이 같이 쓰면 잠금이 부딪히기 때문에 이 자리를 씁니다. 서버가 만드는 파일(`.project` · 색인 등)도 사용자 프로젝트 폴더가 아니라 여기에 두게 설정합니다.

## 3. 실행기

언어 서버는 보통 자기 런타임(Java · .NET 등)이 필요합니다. 사용자 PC 의 런타임을 가정하지 말고, **런타임을 동봉**하고 실행기가 그것으로 서버를 띄웁니다(표준 11번과 같은 이유).

- stdio 를 그대로 서버에 잇습니다. 실행기는 LSP 내용을 건드리지 않습니다.
- `command` 는 플러그인 폴더 안 파일이어야 합니다. `.mjs` · `.js` 가 아니면 zip 안에서 실행 비트(0o755)를 가진 일반 파일이어야 앱이 그대로 살립니다 — 실행기가 셸 스크립트나 바이너리라면 묶을 때 실행 비트를 잃지 않게 하고, 묶은 zip 에서 `unzip -Z` 로 권한을 확인합니다.
- 메모리 옵션 같은 것은 `env` 로 받습니다(`JAVA_OPTS`).
- 플러그인 폴더는 여러 프로젝트가 같이 쓰고 업데이트 때 바뀝니다. 서버가 쓰는 설정 · 캐시는 작업 공간(`${lspWorkspaceDir}`) 아래로 돌립니다.

## 4. 폐쇄망

- **서버가 바깥으로 나가지 않게** 설정합니다. 의존성 받기, 소스 · 문서 받기, 버전 목록 확인을 끕니다.
  - java-lsp 의 예: Maven offline, Gradle 가져오기 끔, 소스 받기 끔.
  - JDT LS 의 Gradle 플러그인처럼 꺼도 시작할 때 요청을 보내는 것이 있습니다. 실행기가 그 캐시를 미리 채워 막습니다.
- **확인:** 새 작업 공간에서 띄워 서버 프로세스의 바깥 연결을 `lsof` 등으로 봅니다.
- **사용자 프로젝트의 스크립트를 실행하는 기능은 기본으로 끕니다.** Gradle 가져오기처럼 빌드 스크립트를 돌리는 기능이 그렇습니다.

## 5. 크기 · 플랫폼

런타임이 들어가면 커집니다. 앱의 설치 상한(desktop `src/services/extensions/install/limits.ts`)은 다음과 같습니다.

| 상한 | 값 |
|---|---|
| zip 크기 | 100MB |
| 항목 수 | 2000 |
| 풀었을 때 합 | 200MB |
| 파일 하나 | 50MB |

- JRE 의 `lib/modules` 처럼 한 파일이 50MB 를 넘으면 jlink 압축 등으로 줄입니다.
- 모듈을 빼서 줄이는 것은 조심합니다. 서버가 자기 런타임을 사용자 코드의 JDK 로도 쓰면, 빠진 모듈 때문에 사용자 코드에 가짜 오류가 납니다.
- 서비스 번들(`service.mjs`)은 작습니다(서버 정의만) — 4MB 상한에 걸릴 일이 없습니다. 크기는 런타임이 차지합니다.
- `build.mjs` 가 상한을 넘으면 멈추게 합니다.
- 런타임이 플랫폼마다 다르므로 **플랫폼 전용**으로 올립니다. 사용자 PC 와 같은 플랫폼의 zip 만 앱에 보입니다(sonarqube 와 같음).
  ```sh
  node plugins/<id>/build.mjs --platform darwin-arm64          # → build/<id>-darwin-arm64.zip
  node plugins/<id>/build.mjs --platform darwin-arm64 --dir    # → build/<id>-darwin-arm64/ (개발 모드에서 연결)
  npm run release -- <id> --platform darwin-arm64               # dist · catalog 까지
  ```

## 6. 확인

- **테스트**(`npm test -- --project <id>`): 실행기의 인자 · env 처리와, 서비스가 올리는 서버 정의를 봅니다. SDK 의 가짜 host 가 올린 서버를 돌려줍니다 — `fake.mount(bundle)` 뒤 `fake.lspServers()` 로 `languageId` · `extensions` · `command` 가 맞는지 보고(자리표시 · `idleMs` 까지는 가짜 host 가 돌려주지 않으니 서비스 소스를 직접 읽어 확인), 서비스를 내리면(`fake.dispose()`) 걷히는지 봅니다. java-lsp 의 `tests/launcher.test.ts` 가 실행기 쪽 예입니다.
- **서버 동작**: 앱과 같은 범위로 말하는 작은 LSP 클라이언트로 띄워 봅니다.
  - 클라이언트 동작: Full 동기화를 쓰고, `workspace/configuration` · `registerCapability` · `workDoneProgress/create` 에 답하고, `applyEdit` 는 거절합니다.
  - 볼 것: `publishDiagnostics` · `definition` · `references` · `hover` 가 오프라인에서 답하는지, 고친 내용을 보내면 오류가 사라지는지.
- **앱에서**: 설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결] 로 `build/<id>-<플랫폼>/` 을 연결합니다.
  - 그 언어 파일을 열어 준비 칩 → 밑줄 · 문제 목록 · 마우스 풍선이 나오는지 봅니다.
  - AI 에게 `code_diagnostics` 를 부르게 해 봅니다.

## 정리

- 서비스가 `host.lsp.register` 로 서버를 올립니다 — `permissions: ["service"]`, `scope: "project"`. manifest `lsp` 선언은 곧 삭제될 옛 경로입니다.
- 런타임과 서버는 동봉하고 실행기가 띄웁니다. 작업 공간은 `${lspWorkspaceDir}`.
- 바깥 요청을 끄고, 사용자 스크립트 실행은 기본으로 끕니다.
- 플랫폼 전용으로 묶고, 상한(zip 100MB · 파일 50MB)을 build.mjs 가 지킵니다. `.mjs` 가 아닌 실행 파일은 zip 안에서 실행 비트를 가져야 합니다.

## 다음

- [서비스 플러그인 만들기](service-plugin.md) — 서비스 번들과 호스트 API 전체
- [저장소로 내보내기](publish.md) — 플랫폼 전용 플러그인을 올리는 법과 버전 규칙.
