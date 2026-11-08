[← 가이드 목록](../README.md)

# 저장소로 내보내기

만든 플러그인을 이 저장소에 올려, 앱의 [플러그인 둘러보기] 에 보이고 새 버전이 나오면 업데이트로 받게 합니다.

*약 10분 · catalog.json · dist/ · categories.json*

## 만들 것

[첫 패널 플러그인](first-panel.md)의 `hello-panel` 을 저장소에 올립니다. 끝나면

- `dist/hello-panel-0.1.0.zip` 이 생기고
- `catalog.json` 에 그 항목(버전 · sha256 · 권한 · 크기 …)이 들어가고
- 앱에서 **플러그인 저장소**를 켠 사람의 [플러그인 둘러보기] 에 메모장이 보입니다.

## 준비물

- 이 저장소에 push 할 수 있는 권한, Node.js 22+, `zip` 명령
- `plugins/<id>/` 에 있는 플러그인 원본 (폴더 이름 = id)
- 빌드가 필요한 플러그인이면 처음 한 번 `npm ci`

## 앱이 저장소를 읽는 법

- 앱은 PC 의 `git` 으로 저장소를 얕게(`--depth 1`) 받아 `catalog.json` 을 읽습니다. 사내 git 서버 미러나 USB 로 옮긴 폴더도 됩니다.
- 설치할 때 받은 zip 이 `catalog.json` 의 `sha256` 과 같아야 하고, 그 뒤 zip 설치와 같은 검사를 거칩니다.
- 설치한 것보다 **버전이 높을 때만** 업데이트를 띄웁니다. 그래서 `dist/` 와 `catalog.json` 은 손으로 고치지 않고 `npm run release` 로만 바꿉니다.

## 1. 분류 한 줄

`categories.json` 에 id 마다 분류를 하나 적습니다 — `game` · `dev-tool` · `locale`. 없으면 release 가 멈춥니다.

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

업데이트 창에 보일 글을 플러그인 폴더의 `changes.txt` 에 한 줄에 하나씩 적습니다. zip 에는 들어가지 않고 catalog 의 `changes` 로만 갑니다.

`plugins/hello-panel/changes.txt`

```text
메모를 적으면 0.4초 뒤 저절로 저장
[AI 에게 보내기] 가 입력창만 채우고 보내지는 않음
```

## 3. release

터미널 (저장소 맨 위에서)

```sh
npm run release hello-panel        # 하나만
npm run release -- --all           # 전부
```

release 가 하는 일:

1. 대상 전부의 분류를 먼저 확인합니다. 하나라도 빠지면 `dist` · `catalog` 를 건드리지 않고 멈춥니다.
2. 폴더에 `build.mjs` 가 있으면 그것을 돌려 `build/<id>[-<platform>].zip` 을 받고, 없으면 폴더 안의 파일을 그대로 묶습니다(`changes.txt` · `README.md` · `.DS_Store` · `tests/` 빼고 — 문서와 테스트는 zip 에 들어가지 않습니다).
3. zip 을 `dist/<id>-<version>.zip` 에 두고 같은 id 의 옛 zip 은 지웁니다 — 되돌리기는 git 기록으로.
4. sha256 · 크기 · details · permissions · type · category · changes 를 담아 `catalog.json` 의 그 항목을 갱신합니다.

`catalog.json 에 들어간 항목 (모양)`

```json
{
  "id": "hello-panel", "name": "메모장", "description": "…", "category": "dev-tool",
  "version": "0.1.0", "zip": "dist/hello-panel-0.1.0.zip", "sha256": "4e5a2dfa…",
  "details": "…", "permissions": ["project", "chat"], "size": 1524,
  "changes": ["메모를 적으면 0.4초 뒤 저절로 저장", "[AI 에게 보내기] 가 입력창만 채우고 보내지는 않음"]
}
```

## 4. 올리기

터미널

```sh
git checkout -b plugin/hello-panel-0.1.0
git add plugins/hello-panel categories.json catalog.json dist
git commit -m "hello-panel 0.1.0"
git push -u origin plugin/hello-panel-0.1.0     # 그리고 main 으로 PR
```

main 에 머지되면 앱에서 [새로 확인] 을 눌러 목록에 보이는지 봅니다.

## 버전 규칙

- 버전은 `주.부.수`. 앱은 숫자로 비교해 **설치한 것보다 높을 때만** 업데이트를 띄우고, 낮은 버전으로는 바꾸지 않습니다.
- **같은 버전에 내용만 바꿔 다시 올리지 않습니다** — 이미 설치한 PC 는 바뀐 줄 모릅니다. 고치면 버전을 올립니다.
- 권한(`permissions`)이 늘어난 업데이트는 앱이 사용자에게 다시 묻습니다. 늘지 않았으면 묻지 않고 바꿉니다.
- MCP 플러그인은 도구 목록을 버전마다 한 번 기억하니, 도구를 바꿨다면 반드시 버전을 올립니다.

## 플랫폼 전용 플러그인

런타임을 싣는 플러그인(예: sonarqube)은 플랫폼마다 zip 이 다릅니다. `--platform` 을 주고 플랫폼마다 따로 돌리면, catalog 에 같은 id 가 플랫폼마다 한 줄씩 들어갑니다. `--all` 은 이런 플러그인을 건너뜁니다.

터미널

```sh
npm run release -- sonarqube --platform darwin-arm64     # darwin-arm64 · darwin-x64 · win32-x64
```

`platform` 이 없는 항목은 모든 PC 에, 있는 항목은 `<os>-<cpu>`(Node 의 `process.platform`-`process.arch`)가 같은 PC 에만 보입니다.

## 목록에서 내리기

원본은 두고 [플러그인 둘러보기] 에서만 내리려면 `categories.json` 에 분류 대신 `unlisted` 를 적고 release 를 한 번 돌립니다.

`categories.json · 터미널`

```json
"vi-pack": "unlisted"

npm run release vi-pack      # → - vi-pack 목록에서 내림 (unlisted)
```

- release 는 돌 때마다 `unlisted` 의 catalog 항목과 dist zip(플랫폼 zip 포함)을 지웁니다. `plugins/<id>/` 는 그대로 둡니다.
- `--all` 은 건너뛰고, 이름으로 불러도 묶지 않습니다. 다시 올리려면 분류를 적고 release 합니다.
- 아예 없애려면 먼저 위처럼 `unlisted` 로 두고 release 해 catalog 항목과 dist zip 을 내린 뒤, 원본 폴더와 categories 한 줄을 지웁니다. catalog 는 이때도 손으로 고치지 않습니다.
- 어느 쪽이든 **이미 설치한 PC 에서는 그대로 남습니다** — 앱은 catalog 에서 빠진 플러그인을 지우지 않습니다.

## 올리기 전 확인

- 폴더 이름과 manifest 의 `id` 가 같다
- `version` 을 올렸다 (새 플러그인이면 `0.1.0` 부터)
- `categories.json` 에 한 줄 있다
- zip 으로 직접 설치해 한 번 돌려 봤다
- 권한은 쓰는 것만 적었다
- 테스트가 있는 플러그인은 `npm test -- --project <id>` 로 그 플러그인 테스트가 통과한다. 머지 훅은 `npm run test:changed`(바뀐 플러그인 + 공통 검사)를 돌린다

## 정리

분류 한 줄 → (바뀐 것) → `npm run release` → 커밋 · PR. `dist/` 와 `catalog.json` 은 늘 release 가 만듭니다. 저장소 구조와 폐쇄망에서 쓰는 법은 [README](https://github.com/kim-taehan/lite-harness-plugins#readme) 에 있습니다.

## 다음

- [가이드 목록](../README.md) — 다른 종류의 플러그인 만들기
- [MCP 플러그인 만들기](mcp-plugin.md) — build.mjs 가 있는 플러그인
