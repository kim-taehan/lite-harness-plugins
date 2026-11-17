# lite-harness-plugins

[English](README.md) · **한국어**

**Lite Harness 를 내보내는 배포 저장소 — 앱 설치 파일과 확장을 한곳에서.**

이 저장소는 두 가지를 내보냅니다.

| 무엇 | 어디 |
|---|---|
| 앱 설치 파일 (mac arm64 · mac x64 · win x64) | GitHub Releases 의 `app-v<버전>` |
| 확장 | 원본은 `plugins/<id>/`, 배포는 **litecode-deploy 서버**로 ([구조](#구조) 참고) |

Lite Harness(데스크탑 앱)에 설치하는 확장은 litecode-deploy 서버에서 받습니다. 앱에 업데이트 서버 주소가 있으면 앱이 서버의 `catalog.json` 을 읽어 [확장 둘러보기] 에 목록을 보이고, 누르면 설치 · 새 버전이 오면 업데이트합니다. zip 파일로 직접 설치하는 길(설정 › 기능 › 확장 추가 (zip))도 그대로 있습니다.

## 문제

확장은 앱보다 자주 바뀝니다. 앱에 확장을 넣어 두면 게임 하나·언어 팩 하나를 고칠 때마다 앱을 새로 빌드해 나눠야 합니다. 그렇다고 확장 마켓 서버를 따로 세우면 폐쇄망에서는 닿지 않고, 또 하나의 서비스를 운영해야 합니다. zip 을 손으로 돌리면 누가 어떤 버전을 쓰는지, 받은 파일이 맞는지 알 길이 없습니다.

## 아이디어

원본은 이 저장소에 두고, 목록을 내주는 작은 서버(litecode-deploy)에 zip 을 발행합니다.

1. **목록은 서버가 만든다** — `catalog.json`(id · 버전 · zip 경로 · sha256 · 바뀐 것) · 순번 · 서명은 zip 을 발행할 때 서버가 만듭니다. 앱은 이것만 읽으면 둘러보기·설치·업데이트를 할 수 있습니다.
2. **읽기 전용 서버** — 앱은 `GET` 만 합니다. 관리 화면 · 쓰기 API 가 없고, 올리는 일은 서버 PC 의 CLI 입니다.
3. **원본은 여기, 내보낸 것은 서버에** — `plugins/<id>/` 원본에서 `npm run release` 가 zip 을 만들어 `litecode-deploy plugin publish` 로 넘깁니다. 빌드가 필요한 확장(MCP 서버 묶기 · 런타임 싣기)도 같은 명령 하나로 나갑니다.
4. **믿는 것은 해시와 버전** — 받은 zip 은 catalog 의 sha256 과 같을 때만 설치하고, 버전이 높을 때만 업데이트합니다. 권한이 늘면 다시 묻습니다. 서버가 항목에 서명(ed25519)하면 앱이 검증할 수 있습니다.
5. **되돌리기 · 내리기도 서버에서** — `plugin rollback` 은 카탈로그를 그 순번의 모습으로, `plugin remove` 는 id 를 카탈로그에서 내립니다. 서버는 같은 id(·platform)의 zip 을 3개까지만 보관합니다.

## 설치 · 사용

**앱 설치** — [Releases](https://github.com/kim-taehan/lite-harness-plugins/releases) 의 `app-v<버전>` 에서 설치 파일을 받습니다(macOS Apple Silicon / Intel, Windows). 앱 사용법은 [lite-harness-desktop](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/README.ko.md) 에 있습니다.

**확장 설치** — 앱에 업데이트 서버 주소를 넣고(macOS 설치 스크립트가 넣어 줍니다. 아니면 앱 설정에서 입력) [확장 둘러보기] 에서 고릅니다. 서버 없이 zip 하나만 설치하려면 설정 › 기능 › 확장 추가 (zip) 로 넣습니다.

### 폐쇄망(사내망)에서 쓰기

폐쇄망에는 서버에 바로 닿을 수 없으므로 **오프라인 번들**을 들고 들어갑니다.

1. 밖(발행하는 PC)에서 `litecode-deploy export --out litecode-bundle.tar.gz [--sign-key … --key-id …]` — 지금 발행된 데스크톱 + 플러그인 카탈로그를 파일 하나로 담는다(확장만이면 `--only plugins`). 출력된 sha256 은 다른 경로로 알린다.
2. 번들을 옮긴다(USB · 자료실 등).
3. 사내 미러 서버에서 `litecode-deploy import litecode-bundle.tar.gz --sha256 <알린 값> --data <폴더>` 후 `litecode-deploy serve --data <폴더>`. 앱의 서버 주소를 그 서버로 한다.

번들 구조 · 재생 방지 · 믿는 키는 litecode-deploy 의 README "오프라인 반입" 에 있습니다.

### 앱이 읽는 법

- 앱은 서버의 `GET /plugins/catalog.json` 과 `GET /plugins/dist/<id>-<버전>[-<platform>].zip` 을 읽는다. 서버 주소가 없으면 아무 요청도 하지 않는다.
- 받은 zip 은 `catalog.json` 의 `sha256` 과 같을 때만 설치하고, 그 뒤는 zip 설치와 같은 검사(크기 · 경로 · manifest · 앱 버전 · 권한 확인)를 그대로 거친다.
- 서버에 닿지 못하면 마지막으로 받은 목록을 그대로 보이고, 둘러보기 화면에만 안내를 띄운다. 설치한 확장은 그대로 돈다.

## 개발 완료된 플러그인

개발이 끝난 플러그인의 소개 문서입니다: [목차](docs/completed-plugins.md)

## 확장 내보내기

### 구조

```
plugins/<id>/            확장 원본 — extension.json(플러그인은 plugin.json) + 진입 파일(index.html · locale.json …). 분류 폴더 없이 id 하나로
plugins/<id>/build.mjs   빌드가 필요한 확장만 — build/<id>[-<platform>].zip 을 만든다 (아래 참고)
plugins/<id>/changes.txt 바뀐 것 한 줄씩 — release 가 --changes-file 로 넘긴다
categories.json          확장 id → 분류(game · dev-tool · locale), 또는 "이 저장소가 올리지 않는다" 는 unlisted. release 가 --category 로 넘긴다
scripts/grammar-pack.mjs 문법 팩 build.mjs 가 같이 쓰는 묶기
scripts/release.mjs      zip 을 만들고(시스템 zip 사용, build.mjs 가 있으면 먼저 돌린다) `litecode-deploy plugin publish` 를 부른다
package.json             build.mjs 가 쓰는 의존성 (esbuild · MCP SDK · DB 드라이버 · playwright-core) — 버전 고정. 빌드 전에 npm ci
```

`catalog.json` · `dist/` 는 더 이상 정본이 아닙니다 — 카탈로그는 서버가 쓰고 zip 도 서버가 보관합니다.

### 새 버전 올리는 법

1. `plugins/<폴더>/` 의 파일을 고친다.
2. `extension.json` 의 `version` 을 올린다 (`1.2.3` 꼴). 바뀐 것을 업데이트 창에 보이려면 그 폴더에 `changes.txt` 를 두고 한 줄에 하나씩 적는다 (선택 — zip 에는 들어가지 않고 release 가 서버에 넘긴다. `extension.json` 에 적으면 앱이 모르는 필드로 설치를 거절한다).
3. PR 로 `dev` 에 머지한 뒤, **서버 PC 에서 사용자(리더) 확인을 받고** 올린다 — 사용자에게 나가는 일이다.

```bash
npm run release -- <id> --dry-run   # zip 을 만들고 서버에 넘길 명령만 보인다 (서버는 부르지 않는다)
npm run release -- <id>             # litecode-deploy plugin publish <zip> --category … --changes-file …
npm run release -- <id> --sign-key ~/keys/release.key --key-id release-1   # 서명 (개인키는 저장소 밖에)
```

새 확장은 `plugins/` 에 폴더를 하나 만들고 같은 순서로 하면 된다. 되돌리기 · 내리기는 `litecode-deploy plugin rollback <순번>` · `plugin remove <id>` — [발행 가이드](docs/guides/publish.md).

### 버전 규칙

- 버전은 `주.부.수` 숫자 세 칸. 앱은 숫자로 비교해 **설치한 것보다 높을 때만** 업데이트를 띄우고, 낮은 버전으로는 바꾸지 않는다.
- 같은 버전에 내용만 바꿔 다시 올리지 않는다 — 이미 설치한 PC 는 바뀐 줄 모른다. 고치면 버전을 올린다.
- 권한(`permissions`)이 늘어난 업데이트는 앱이 사용자에게 다시 묻는다. 늘지 않았으면 묻지 않고 바꾼다.

### 빌드가 따로 필요한 확장

폴더에 `build.mjs` 가 있으면 `npm run release <id>` 가 그것을 먼저 돌리고, 나온 `build/<id>[-<platform>].zip` 을 그대로 올린다. 처음 한 번 `npm ci` 로 의존성을 받는다.

| 확장 | 하는 일 | 올리는 법 |
|---|---|---|
| `sql-tuning` | MCP 서버를 드라이버(oracledb · pg)째 한 파일로 묶는다 | `npm run release sql-tuning` |
| `ui-test` | MCP 서버를 묶고 playwright-core 를 옆에 싣는다 (브라우저는 PC 의 Chrome · Edge) | `npm run release ui-test` |
| `chrome-browser` | Playwright MCP 를 레지스트리에서 고정 버전 · sha512 로 받아 싣는다 | `npm run release chrome-browser` |
| `rust-grammar` · `csharp-grammar` · `kotlin-grammar` | 문법 패키지(package.json 의 별칭 `code-grammar-*`)에서 wasm 을 꺼내 extension.json · LICENSE 와 묶는다 (`scripts/grammar-pack.mjs`) | `npm run release rust-grammar` |
| `sonarqube` | 분석기(Java 런타임 + SonarScanner, 풀어서 약 100MB)를 플랫폼별로 받아 싣는다 | `npm run release -- sonarqube --platform darwin-arm64` |

- sql-tuning 에 사내 SQL 표준을 넣으려면 `node plugins/sql-tuning/build.mjs --standard <표준.md>` 로 묶고 `npm run release -- --zip build/sql-tuning.zip`.
- sonarqube 는 플랫폼 전용이라 `--platform`(`darwin-arm64` · `darwin-x64` · `win32-x64`)이 꼭 있어야 한다. 분석기는 `plugins/sonarqube/fetch-runtime.mjs` 가 망 밖에서 버전 · sha256 고정으로 받아 `build/vendor/` 에 둔다(git 에는 넣지 않는다, 받으면 수 GB). 지금은 mac(Apple 칩)판만 검증됐다.
- 문법 팩을 더할 때는 폴더 하나(extension.json · LICENSE · 다른 팩과 같은 한 줄짜리 build.mjs) + `npm i -D -E code-grammar-<언어>@npm:<문법 패키지>@<버전>` + categories.json 한 줄. 앱에 이미 있는 언어의 확장자는 앱이 설치를 거절한다.
- chrome-browser 의 Playwright MCP 버전을 올리면 도구 이름이 바뀔 수 있다 — `server.mjs` 의 `DENIED` 를 새 `tools/list` 와 다시 댄다.
- 빌드가 필요한 확장의 테스트는 `plugins/<id>/tests/` 에 있다. `npm test`(vitest) 로 돌리고, zip 에는 들어가지 않는다(build.mjs 가 고른 파일만 싣는다).
- release 는 대상 전부의 분류를 먼저 확인하고 나서 빌드한다. 하나라도 빠지면 서버를 부르기 전에 멈춘다.

### 분류(category)

분류는 `categories.json` 에 확장 id 마다 하나 적는다. 값은 `game` · `dev-tool` · `locale` 중 하나이고, 없거나 다른 값이면 release 가 멈춘다. 새 확장을 올리기 전에 여기에 먼저 한 줄 더한다.
`extension.json` 에는 적지 않는다(앱이 모르는 필드로 설치를 거절한다). 폴더도 분류별로 나누지 않는다 — `plugins/<id>/` 하나로 둔다.

**`unlisted`** 는 "이 저장소가 올리지 않는다" 는 표시다(release 가 건너뛴다). 서버는 바꾸지 않는다. 이미 올라간 것을 내리려면 서버에서 `litecode-deploy plugin remove <id>` 를 하고, 다시 올리지 않게 `unlisted` 로 둔다. 이미 설치한 PC 에서는 그대로 남는다 — 앱은 catalog 에서 빠진 확장을 지우지 않는다.

### 플랫폼(platform)

카탈로그에서 `platform` 이 없는 항목은 모든 PC 에 보인다. 있으면 `<os>-<cpu>`(Node 의 `process.platform`-`process.arch`)가 같은 PC 에만 보인다. 같은 id 를 플랫폼마다 한 줄씩 둘 수 있다.

## 관련 저장소

Lite Harness 는 함께 나가는 저장소 셋으로 이뤄집니다.

```
 lite-harness-plugins (이 저장소) ──(확장 zip)──▶ litecode-deploy 서버 ──(카탈로그 · zip)──▶ lite-harness-desktop
                                                                                 │  OpenAI 호환 API
                                                                                 │  (API 키 또는 회사 SSO)
                                                                                 ▼
                                                                         lite-harness-gateway ──▶ LLM (vLLM · Ollama · 클라우드 …)
```

| 저장소 | 역할 | 이 저장소와의 관계 |
|---|---|---|
| [lite-harness-desktop](https://github.com/kim-taehan/lite-harness-desktop) | 데스크톱 앱(Electron)과 Android 앱(`mobile/`) | 확장을 이 저장소가 아니라 litecode-deploy 서버에서 받습니다: 앱이 서버의 카탈로그를 읽어 확장 목록·설치·업데이트를 합니다. 없어도 zip 직접 설치는 됩니다. 앱 설치 파일은 이 저장소의 `app-v<버전>` 릴리스로 나갑니다. |
| **lite-harness-plugins** (이 저장소) | 확장 원본과 앱 설치 파일(`app-v<버전>` 릴리스). 확장은 litecode-deploy 서버로 발행 | — 확장 원본은 desktop #1282 에서 `extensions/` 로부터 이리 옮겼습니다. |
| [lite-harness-gateway](https://github.com/kim-taehan/lite-harness-gateway) | LLM 게이트웨이 — 폐쇄망 스택용 [LiteLLM](https://github.com/BerriAI/litellm) 포크(Keycloak SSO, 키·팀 예산, 사용량 한도) | 직접 관계는 없습니다. 앱의 **모델 provider** 입니다: 설정 → 모델 에서 API 키로 더하거나, **SSO 로그인** 으로 회사 계정에 로그인해 그 계정이 쓸 수 있는 모델을 받아 옵니다. |

## 범위와 철학

- **작은 읽기 전용 서버.** 목록 · sha256 · 순번 · 서명은 litecode-deploy 가 만들고, 폐쇄망에는 오프라인 번들을 들고 들어갑니다.
- **앱 빌드와 확장 배포를 떼어 둔다.** 확장을 고쳐도 앱은 다시 나눌 필요가 없습니다.
- **원본에서 다시 만들 수 있게.** zip 은 `plugins/` 원본과 고정된 의존성에서 `npm run release` 로 언제든 다시 만들어집니다.
- **조용히 바꾸지 않는다.** 같은 버전은 다시 올리지 않고, 권한이 늘면 사용자에게 다시 묻습니다.
