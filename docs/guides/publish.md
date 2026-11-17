[← 가이드 목록](../README.md)

# 서버로 내보내기

만든 플러그인을 litecode-deploy 서버에 올려, 앱의 [플러그인 둘러보기] 에 보이고 새 버전이 나오면 업데이트로 받게 합니다.

*약 10분 · categories.json · changes.txt · litecode-deploy*

## 만들 것

[첫 패널 플러그인](first-panel.md)의 `hello-panel` 을 서버에 올립니다. 끝나면

- 서버 카탈로그에 그 항목(버전 · sha256 · 권한 · 크기 …)이 들어가고
- 앱에서 업데이트 서버 주소를 설정한 사람의 [플러그인 둘러보기] 에 메모장이 보입니다.

## 준비물

- **서버가 있는 PC** 에서 `litecode-deploy` CLI 를 쓸 수 있어야 합니다. 올리는 일은 그 PC 의 CLI 로만 됩니다(원격 발행 아직 없음). 서버 사용법은 litecode-deploy 저장소의 `README.md` · `docs/SUPPORT.md`
- Node.js 22+, `zip` 명령
- `plugins/<id>/` 에 있는 플러그인 원본 (폴더 이름 = id)
- 빌드가 필요한 플러그인이면 처음 한 번 `npm ci`
- 서명하려면 개인키(`--sign-key`). **개인키는 저장소 밖에 둡니다.** 서명 안 하면 서명 없음으로 올라갑니다

## 서버가 하는 일

- 카탈로그(`catalog.json`) · sha256 · 순번(`sequence`) · 서명은 **서버가 만듭니다.** 이 저장소는 zip 만 만들어 넘깁니다 — `dist/` · `catalog.json` 을 쓰지 않습니다.
- 앱은 서버의 `GET /plugins/catalog.json` 을 읽고, 받은 zip 의 `sha256` 이 같을 때만 설치합니다. 그 뒤 zip 설치와 같은 검사를 거칩니다.
- 설치한 것보다 **버전이 높을 때만** 업데이트를 띄웁니다.
- 같은 id(·platform)의 zip 은 **3개까지만** 보관하고, 발행 때 초과분을 자동으로 지웁니다. 되돌릴 수 있는 옛 버전은 최대 3개입니다.

## 1. 분류 한 줄

`categories.json` 에 id 마다 분류를 하나 적습니다 — `game` · `dev-tool` · `locale`. 없으면 release 가 멈춥니다. release 가 `--category` 로 넘깁니다.

`categories.json`

```json
{
  …
  "hello-panel": "dev-tool",
  …
}
```

> 분류는 `plugin.json` 에 넣지 않습니다 — 앱은 모르는 필드로 설치를 거절합니다. 폴더도 분류별로 나누지 않고 `plugins/<id>/` 하나로 둡니다.

## 2. 바뀐 것 적기 (선택)

업데이트 창에 보일 글을 플러그인 폴더의 `changes.txt` 에 한 줄에 하나씩 적습니다. zip 에는 들어가지 않고 release 가 `--changes-file` 로 서버에 넘깁니다.

`plugins/hello-panel/changes.txt`

```text
메모를 적으면 0.4초 뒤 저절로 저장
[AI 에게 보내기] 가 입력창만 채우고 보내지는 않음
```

## 3. 만들 명령 먼저 보기

터미널 (저장소 맨 위에서)

```sh
npm run release -- hello-panel --dry-run     # zip 을 build/ 에 만들고, 서버에 넘길 명령만 보인다 (서버는 부르지 않는다)
```

release 가 하는 일:

1. 분류를 먼저 확인합니다. 빠지면 아무것도 하지 않고 멈춥니다. `unlisted` 는 올리지 않고 건너뜁니다.
2. 폴더에 `build.mjs` 가 있으면 그것을 돌려 `build/<id>[-<platform>].zip` 을 받고(서비스는 `service.mjs` 로 묶어 싣습니다), 없으면 폴더 안의 파일을 그대로 묶어 `build/<id>-<version>.zip` 에 둡니다(`changes.txt` · `README.md` · `.DS_Store` · `tests/` 빼고).
3. `litecode-deploy plugin publish <zip> --category <분류> [--changes-file <changes.txt>] …` 를 부릅니다.

## 4. 올리기 — 서버에, 올리기 전 사용자(리더) 확인

서버에 올리는 일은 사용자에게 나가는 일입니다. **올리기 전에 사용자(리더) 확인을 받습니다.**

작업은 `dev` 에서 브랜치를 따서 하고 PR 은 `dev` 로 보냅니다(`main` · `dev` 에는 직접 push 하지 않습니다). PR 머지가 끝난 뒤, 서버가 있는 PC 에서 올립니다.

터미널 (서버 PC 의 저장소 맨 위에서)

```sh
git switch dev && git pull
npm run release -- hello-panel --dry-run                    # 만들 명령 먼저 확인
npm run release -- hello-panel                              # 올리기
npm run release -- hello-panel --data /srv/deploy/data      # 서버 데이터 폴더가 기본(./data)이 아닐 때
npm run release -- hello-panel --sign-key ~/keys/dev.key --key-id dev-release   # 서명할 때
```

이름을 여러 개 줄 수 있습니다(`npm run release -- a b c`). 직접 묶은 zip 은 `npm run release -- --zip <파일> [--platform …]`. 올린 뒤 앱에서 [새로 확인] 을 눌러 목록에 보이는지 봅니다. 올라간 것은 `litecode-deploy plugin list` 로 봅니다.

> 서명 키를 처음 켤 때는 공개키가 든 앱을 먼저 배포한 뒤 서명된 항목을 올립니다(앱에 키가 없으면 "알 수 없는 서명 키"로 거절됩니다).

## 버전 규칙

- 버전은 `주.부.수`. 앱은 숫자로 비교해 **설치한 것보다 높을 때만** 업데이트를 띄우고, 낮은 버전으로는 바꾸지 않습니다.
- **같은 버전에 내용만 바꿔 다시 올리지 않습니다** — 이미 설치한 PC 는 바뀐 줄 모릅니다. 고치면 버전을 올립니다.
- 권한(`permissions`)이 늘어난 업데이트는 앱이 사용자에게 다시 묻습니다. 늘지 않았으면 묻지 않고 바꿉니다.
- **서비스 플러그인**은 업데이트가 서비스를 새로 담았거나 `permissions` · `service.inject` · `service.events` · `service.api` · `scope` 를 바꿨으면, 사용자가 다시 동의하기 전까지 꺼집니다(카드에 "다시 동의해야 켜집니다"). 같은 선언으로 버전만 올리면 켜진 채 그대로입니다. 그래서 서비스 선언을 바꾸는 업데이트는 `changes.txt` 에 그 사실을 적습니다.
- MCP 플러그인은 도구 목록을 버전마다 한 번 기억하니, 도구를 바꿨다면 반드시 버전을 올립니다.

## 서비스 플러그인 올리기

서비스(`service` 선언)를 담은 플러그인은 앱 안에서 도는 코드라서 zip 구성과 설치 뒤 동작이 조금 다릅니다. 만드는 법은 [서비스 플러그인 만들기](service-plugin.md).

- **zip 구성** — `plugin.json` · `service.mjs`(번들 한 파일, ESM) · 패널 `index.html` · `skills/` · 서비스가 폴더에서 읽을 자산(wasm 같은 것). `build.mjs` 가 만듭니다. `README.md` · `tests/` · `changes.txt` 는 들어가지 않습니다.
- **번들 한 파일** — 앱은 번들 바이트를 사본으로 옮겨 올려서, 옆 파일 `import` 나 `import.meta.url` 기준 경로는 설치 폴더를 가리키지 않습니다. 자산은 `host.dir`(플러그인 폴더) 에서 읽습니다.
- **상한** — 번들 한 파일 4MB 이하, 읽고 올리는 데 5초 이내, 내릴 때 정리는 1초 이내입니다. `cordis` 를 가져오지 않고, `fetch(` · `node:http` · `WebSocket` 같은 직접 네트워크 흔적이 있으면 설치가 거절됩니다(`service-network-direct`) — 바깥 요청은 `host.fetch` 로만 합니다.
- **`--dir` 개발 폴더** — `node plugins/<id>/build.mjs --dir` 가 같은 내용을 `build/<id>/` 로 냅니다(표준 17번). 개발 모드(설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결])로 연결하면 선언을 고칠 때마다 재동의가 걸리지 않습니다(개발자 본인 폴더로 보고 동의한 것으로 침). 카드에 DEV 표시가 붙습니다.
- **설치와 동의** — 설치 확인창에서 "앱 안에서 직접 실행됩니다. 출처를 확인했습니다" 에 동의하고 설치하면 그 자리에서 켜집니다. 창을 거치지 않은 설치(자동 동기화 등)는 꺼진 채입니다. 설치할 때 번들의 sha256 을 기록하고, 올릴 때마다 읽은 바이트가 같은 때만 올립니다.
- **다시 설치** — 서비스 기록이 없는 이전 방식 설치본은 올라오지 않고 카드에 "다시 설치해야 합니다" 가 뜹니다. 옛 방식(`type: locale` · `grammar` 등)에서 서비스로 바꾼 업데이트는 서비스를 새로 담은 것이라 사용자가 한 번 동의해야 켜집니다. PR 과 `changes.txt` 에 "다시 설치 필요" 를 적습니다.

## 플랫폼 전용 플러그인

런타임을 싣는 플러그인(예: sonarqube)은 플랫폼마다 zip 이 다릅니다. `--platform` 을 주고 플랫폼마다 따로 돌리면, 서버 카탈로그에 같은 id 가 플랫폼마다 한 줄씩 들어갑니다.

터미널

```sh
npm run release -- sonarqube --platform darwin-arm64     # darwin-arm64 · darwin-x64 · win32-x64
```

`platform` 이 없는 항목은 모든 PC 에, 있는 항목은 `<os>-<cpu>`(Node 의 `process.platform`-`process.arch`)가 같은 PC 에만 보입니다.

## 되돌리기 · 내리기

서버 CLI 로 합니다(서버 PC 에서, 사용자 확인 뒤).

터미널

```sh
litecode-deploy plugin list               # 카탈로그와 순번 이력
litecode-deploy plugin rollback 4         # 카탈로그를 순번 4 때의 모습으로
litecode-deploy plugin remove vi-pack     # 카탈로그에서만 내린다 (--platform 으로 플랫폼 하나만)
```

- `rollback` 은 낮은 버전을 더 높은 `sequence` 와 `rollback: true` 로 다시 가리킵니다. 보관 한도(같은 id 의 zip 3개) 안의 옛 버전만 되살릴 수 있습니다.
- `remove` 는 카탈로그에서만 내립니다. zip 과 이력은 남아 있어 `rollback` 으로 되살릴 수 있습니다.
- **이미 설치한 PC 에서는 그대로 남습니다** — 앱은 카탈로그에서 빠진 플러그인을 지우지 않습니다.
- `categories.json` 의 `unlisted` 는 **"이 저장소가 올리지 않는다"** 는 표시일 뿐 서버를 바꾸지 않습니다. 이미 올라간 것을 내리려면 `plugin remove` 를 하고, 다시 올리지 않게 `unlisted` 로 둡니다. 아예 없애려면 `plugin remove` 한 뒤 원본 폴더와 categories 한 줄을 지웁니다.

## 올리기 전 확인

- 폴더 이름과 manifest 의 `id` 가 같다
- `version` 을 올렸다 (새 플러그인이면 `0.1.0` 부터)
- 서비스 플러그인이면 `build.mjs --dir` 로 낸 폴더가 되고, zip 으로 설치해 동의 · 켜기까지 한 번 돌려 봤다
- `categories.json` 에 분류 한 줄이 있다
- zip 으로 직접 설치해 한 번 돌려 봤다
- 권한은 쓰는 것만 적었다
- 테스트가 있는 플러그인은 `npm test -- --project <id>` 로 그 플러그인 테스트가 통과한다. 머지 훅은 `npm run test:changed`(바뀐 플러그인 + 공통 검사)를 돌린다
- `--dry-run` 으로 본 명령이 맞고, 올리기 전 사용자(리더) 확인을 받았다

## 정리

`dev` 에서 브랜치 → 분류 한 줄 → (바뀐 것) → 커밋 · PR(`dev` 로) → 머지 → 서버 PC 에서 `npm run release -- <id>`(사용자 확인 뒤). 카탈로그 · 순번 · 서명은 서버가 만듭니다. 저장소 구조와 폐쇄망에서 쓰는 법은 [README](https://github.com/kim-taehan/lite-harness-plugins#readme) 에 있습니다.

## 다음

- [가이드 목록](../README.md) — 다른 종류의 플러그인 만들기
- [서비스 플러그인 만들기](service-plugin.md) — 서비스 번들과 호스트 API
- [MCP 플러그인 만들기](mcp-plugin.md) — build.mjs 가 있는 플러그인
