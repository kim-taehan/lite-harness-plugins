[← 가이드 목록](../README.md)

# 언어 팩 · 문법 팩 만들기

앱 화면을 다른 언어로 바꾸는 언어 팩, 파일 개요가 새 프로그래밍 언어를 읽게 하는 문법 팩. 둘 다 **데이터를 앱에 올리기만 하는 작은 서비스**로 만듭니다.

*약 20분 · service · host.locale · host.grammars · 권한: service · scope: app*

## 만들 것

- **프랑스어 언어 팩** `fr-pack` — 설정 › 일반 › 언어에 *Français* 가 생기고, 고르면 번역한 문구가 바뀝니다.
- **Ruby 문법 팩** `ruby-grammar` — `.rb` 파일을 열면 경로 줄에 [개요] 가 생겨 모듈 · 클래스 · 메서드가 보입니다.

## 서비스로 만드는 까닭과 옛 방식

코드를 가진 플러그인은 서비스 한 길이고, 언어 팩 · 문법 팩도 그 길을 따릅니다(desktop 이슈 #1614). 서비스는 앱 안에서 도는 번들이 `host.locale.register` · `host.grammars.register` 를 부르면, 앱이 번역 사전과 파일 개요의 언어 표에 올립니다. 서비스를 끄거나 지우면 올린 것도 같이 걷힙니다.

> **옛 방식**(`type: "locale"` · `type: "grammar"` manifest)은 서비스로 옮기는 동안 병행되는 길입니다. 지금도 동작하지만, 이전이 끝나면 desktop 이 한꺼번에 지울 예정이라 새 팩은 서비스로 만듭니다. `type` 이 `locale` · `grammar` 인 플러그인은 `service` 를 담을 수 없습니다(설치 거절). 옛 방식으로 깔려 있던 팩을 같은 id 의 서비스 팩으로 바꿔 올리면 [아래](#설치-동의와-다시-설치) 와 같이 한 번 동의해야 켜집니다.

두 팩의 공통 규칙:

| | |
|---|---|
| `scope` | **`"app"` 만** — 언어는 앱 전체의 성격이라 `scope: "app"` 서비스만 올릴 수 있습니다. 아니면 `register` 가 던집니다 |
| 권한 | `permissions: ["service"]` 하나. `service` 선언과 `service` 권한은 같이만 있어야 합니다 |
| 번들 | 서비스는 **한 파일** `service.mjs`(ESM) 이고 cordis 를 가져오지 않습니다. 앱이 넘기는 `host` 로 만듭니다 |
| 하는 일 | 올리는 일만 합니다. 다른 앱 기능은 쓰지 않습니다 |

## 설치 동의와 다시 설치

- 서비스를 담은 플러그인은 설치만으로는 켜지지 않습니다. 설치 확인창의 "이 플러그인은 앱 안에서 직접 실행됩니다. 출처를 확인했습니다" 에 동의하고 설치하면 **그 자리에서 켜집니다.** 번역 파일 하나뿐인 팩도 같은 문구입니다.
- 창을 거치지 않은 설치는 꺼진 채입니다.
- 업데이트가 서비스를 새로 담았거나 권한 · `inject` · `events` · `service.api` · `scope` 를 바꿨으면 다시 동의해야 켜집니다. 옛 방식 팩을 서비스 팩으로 바꾼 업데이트가 이 경우입니다 — 동의하기 전에는 꺼져 있어 언어가 기본 언어로 보입니다. 이전 방식으로 설치돼 서비스 기록이 없는 팩은 "다시 설치해야 합니다" 가 뜹니다.
- 저장해 둔 언어가 팩 언어(예: `ja`)인데 서비스가 아직 안 올라왔으면, 앱이 서비스가 올라올 때까지(상한 2초) 첫 화면을 기다렸다 다시 읽습니다 — 시작할 때 영어로 잠깐 보였다 바뀌는 일을 막으려는 것입니다(desktop #1641). 서비스를 올리는 데는 번들 하나에 약 12ms 가 듭니다.

## 준비물

- [첫 패널 플러그인](first-panel.md)의 manifest 규칙 · zip 설치
- 서비스 번들의 규칙은 desktop 의 [플러그인 서비스 작성 안내](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/docs/plugin-sdk/README.md) — 이 저장소의 `sdk/` 에 같은 사본(타입 · 가짜 host)이 있습니다
- 언어 팩: 앱의 영어 문구 원본 [shared/i18n/en.ts](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/shared/i18n/en.ts)
- 문법 팩: Node.js 22+ 와 이 저장소 (`npm ci`), 그 언어의 tree-sitter 문법 패키지

## 언어 팩

### 1. plugin.json

`plugins/fr-pack/plugin.json`

```json
{
  "id": "fr-pack",
  "name": "Français 언어 팩",
  "description": "앱 화면 문구를 프랑스어로 바꾸는 언어 팩",
  "details": "켜는 법\n설치할 때 \"앱 안에서 직접 실행됩니다\" 동의를 거쳐 켜집니다. 켜도 언어가 바로 바뀌지는 않으니 설정 › 일반 › 언어에서 Français 를 고르세요.\n번역하지 않은 문구는 영어로 보입니다.",
  "version": "0.1.0",
  "scope": "app",
  "permissions": ["service"],
  "service": { "main": "service.mjs", "api": 1 }
}
```

옛 방식의 `type` · `locale` · `entry` 는 쓰지 않습니다. 언어 이름과 코드는 서비스 코드에서 줍니다.

### 2. locale.json

앱 문구 키 → 번역한 글의 평평한 JSON 입니다. 키는 `en.ts` 에 있는 것만 쓰입니다(모르는 키는 앱이 말없이 버립니다). `{count}` 같은 자리표시는 그대로 둡니다.

`plugins/fr-pack/locale.json`

```json
{
  "sidebar.hide": "Masquer la barre latérale",
  "sidebar.show": "Afficher la barre latérale",
  "sidebar.newChat": "+ Nouvelle discussion",
  "extensionRepo.browse": "Parcourir les plugins",
  "extensionRepo.browseNew": "Parcourir les plugins · {count} nouveaux"
}
```

- 번역하지 않은 키는 영어로 보입니다. 사이드바 · 입력창 · 설정처럼 눈에 띄는 곳부터 옮기면 됩니다.
- 옛 방식과 같은 거름을 씁니다 — 내장 사전에 없는 키 · 너무 긴 값은 버립니다(옛 방식의 상한은 키 5000개 · 값 하나 2000자). 모바일 앱에는 적용되지 않습니다.
- 팩을 끄거나 지우면 언어가 English 로 돌아갑니다.

### 3. 서비스

번역 JSON 은 번들에 넣습니다(파일이 작고, 폴더에서 따로 읽으면 경로 처리가 서비스마다 생깁니다).

`plugins/fr-pack/service/index.mjs`

```js
import messages from '../locale.json'

export default (host) =>
  class FrPack extends host.Service {
    constructor(ctx) {
      super(ctx)
      host.locale.register({ language: 'fr', label: 'Français', messages })
    }
  }
```

| 인자 | 규칙 |
|---|---|
| `language` | BCP 47 언어 태그 (`fr` · `zh-CN` …). 내장 `ko` · `en` 은 거절 |
| `label` | 언어 고르기에 보이는 그 언어의 자기 이름 |
| `messages` | 위 번역 JSON |

`register` 는 걷는 함수를 돌려주지만 따로 부르지 않아도 됩니다. 서비스가 내려가면 앱이 걷습니다.

### 4. 묶어 설치

esbuild 로 서비스를 번역째 `service.mjs` 한 파일로 묶고, `plugin.json` 과 함께 zip 으로 만듭니다. 실제 파일은 [ja-pack 의 `build.mjs`](https://github.com/kim-taehan/lite-harness-plugins/blob/main/plugins/ja-pack/build.mjs) 입니다.

`plugins/fr-pack/build.mjs (핵심만)`

```js
await build({
  entryPoints: [path.join(here, 'service/index.mjs')],
  outfile: path.join(stage, 'service.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
})
cpSync(path.join(here, 'plugin.json'), path.join(stage, 'plugin.json'))
// --dir 이면 stage 를 build/fr-pack/ 폴더로, 아니면 zip -qry build/fr-pack.zip
```

터미널

```sh
node plugins/fr-pack/build.mjs          # → build/fr-pack.zip (plugin.json · service.mjs)
node plugins/fr-pack/build.mjs --dir    # → build/fr-pack/ (개발 모드에서 폴더 연결)
```

**설정 › 기능 › 플러그인 › [플러그인 추가 (zip)]** 으로 설치하고 동의창에 동의하면 켜집니다. **설정 › 일반 › 언어**에서 Français 를 고릅니다. 실제 예: [ja-pack](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/ja-pack) · [vi-pack](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/vi-pack) · [zh-cn-pack](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/zh-cn-pack).

### 5. 테스트

앱 없이 SDK 의 가짜 host 로 번역이 올라가는지, 서비스를 내리면 걷히는지 봅니다.

`plugins/fr-pack/tests/service.test.ts (핵심만)`

```ts
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'

const fake = createFakeHost({ id: 'fr-pack', scope: 'app' })
fake.mount(bundle)                       // 묶은 service.mjs 의 default
expect(fake.locales()[0]).toMatchObject({ language: 'fr', label: 'Français' })
await fake.dispose()
expect(fake.locales()).toEqual([])
```

앱이 실제로 서비스를 올려 언어가 바뀌는 것, 시작할 때 깜빡이지 않는지는 앱에서 확인합니다 — 가짜 host 는 보지 못합니다.

## 문법 팩

오른쪽 패널에서 파일을 열면 보이는 **개요**는 tree-sitter 로 파일을 읽어 클래스 · 함수 같은 정의를 뽑습니다. 문법 팩은 앱에 없는 언어의 **문법 wasm** 과 **어떤 노드를 개요에 올릴지 적은 표**를 더합니다. 앱에 이미 있는 언어(Java · Python · JS/TS · C/C++ · Go)의 확장자는 가져갈 수 없습니다.

서비스는 그 선언을 `host.grammars.register` 로 앱에 올립니다. **wasm 은 번들에 넣지 않고 설치 폴더에 둡니다.** 번들은 한 파일이고(그 옆 파일을 `import` 하거나 `import.meta.url` 기준 경로로 읽을 수 없습니다), wasm 은 크고 바이너리라서입니다. 등록 인자의 `wasm` 은 **플러그인 폴더 기준 상대 경로 문자열**(앱이 설치 폴더 안의 일반 파일인지 검사해 싣습니다) 또는 wasm 바이트(`Uint8Array`)입니다.

### 6. 문법 패키지 받기

문법 패키지를 `code-grammar-<언어>` 별칭으로, 버전을 고정해(`-E`) 개발 의존성에 더합니다. wasm 은 저장소에 넣지 않고 묶을 때 여기서 꺼냅니다.

터미널 (저장소 맨 위에서)

```sh
npm i -D -E code-grammar-ruby@npm:tree-sitter-ruby@<버전>
ls node_modules/code-grammar-ruby/*.wasm      # 패키지가 wasm 을 싣고 있는지 확인
```

> wasm 을 싣지 않은 문법 패키지도 있습니다. 그럴 때는 다른 배포본(예: `@tree-sitter-grammars/…`)을 찾습니다 — kotlin 팩이 그렇게 받습니다. 패키지의 라이선스 파일은 팩 폴더에 `LICENSE` 로 같이 둡니다.

### 7. plugin.json

새 팩은 `plugin.json` 으로 씁니다(표준 4번).

`plugins/ruby-grammar/plugin.json`

```json
{
  "id": "ruby-grammar",
  "name": "Ruby 문법 팩",
  "description": "파일 개요가 Ruby(.rb) 파일의 모듈 · 클래스 · 메서드를 읽게 합니다",
  "version": "0.1.0",
  "scope": "app",
  "permissions": ["service"],
  "service": { "main": "service.mjs", "api": 1 }
}
```

### 8. grammars.json

올릴 문법 선언 배열입니다. 옛 manifest 의 `grammars` 항목과 같은 모양이라, 한 팩이 여러 언어를 올려도 됩니다.

`plugins/ruby-grammar/grammars.json`

```json
[
  {
    "id": "ruby",
    "label": "Ruby",
    "extensions": ["rb"],
    "wasm": "tree-sitter-ruby.wasm",
    "definitions": {
      "module": "namespace",
      "class": "class",
      "method": "method",
      "singleton_method": "method"
    }
  }
]
```

| 필드 | 규칙 |
|---|---|
| `id` | 팩 안에서 겹치지 않는 언어 id (소문자 · 숫자 · `-`) |
| `extensions` | 점 없는 소문자 확장자. 앱 내장 언어의 것은 거절 |
| `wasm` | **팩 폴더 기준 상대 경로** — 패키지 안의 파일 이름과 같게. 폴더 밖 · 링크는 거절 |
| `definitions` | tree-sitter 노드 종류 → 개요 종류: `class` · `interface` · `enum` · `record` · `annotation` · `struct` · `namespace` · `type` · `constructor` · `method` · `function` |

노드 하나가 경우에 따라 다른 종류면 **조건 칸**을 씁니다. 노드의 `field` 자리에 든 노드 종류로 고르고(`*` 는 나머지), `name` 을 적으면 이름을 그 필드에서 읽습니다. Rust 팩의 `impl` 블록이 예입니다:

`rust-grammar 의 grammars.json 일부`

```
"impl_item": { "field": "type", "kinds": { "*": "struct" }, "name": "type" }
```

노드 종류 이름은 문법 패키지의 `src/node-types.json` 이나 [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/7-playground.html) 에서 확인합니다.

### 9. 서비스와 build.mjs

문법 팩의 서비스는 모두 같아서 공용 본체(`scripts/grammar-service.mjs`)가 있습니다. 팩의 서비스는 자기 `grammars.json` 을 넘기는 세 줄이고, `build.mjs` 는 한 줄입니다.

`scripts/grammar-service.mjs (공용 본체)`

```js
export function grammarService(grammars) {
  return (host) =>
    class GrammarPack extends host.Service {
      constructor(ctx) {
        super(ctx)
        for (const grammar of grammars) host.grammars.register(grammar)
      }
    }
}
```

`plugins/ruby-grammar/service/index.mjs`

```js
import { grammarService } from '../../../scripts/grammar-service.mjs'
import grammars from '../grammars.json'

export default grammarService(grammars)
```

`plugins/ruby-grammar/build.mjs`

```js
import { packGrammar } from '../../scripts/grammar-pack.mjs'

await packGrammar(import.meta.dirname, 'code-grammar-ruby', { dir: process.argv.includes('--dir') })
```

터미널

```sh
node plugins/ruby-grammar/build.mjs         # → build/ruby-grammar.zip (plugin.json · service.mjs · LICENSE · wasm)
node plugins/ruby-grammar/build.mjs --dir   # → build/ruby-grammar/ (개발 모드에서 폴더 연결)
```

묶기(`packGrammar`)는 서비스를 `grammars.json` 째 `service.mjs` 한 파일로 묶고, `grammars.json` 이 가리키는 wasm 을 `node_modules` 의 문법 패키지에서 꺼내 같이 zip 에 넣습니다. 저장소로 올릴 때는 `categories.json` 에 `"ruby-grammar": "dev-tool"` 한 줄을 더합니다 — [저장소로 내보내기](publish.md).

### 10. 테스트하고 설치

1. `npm test -- --project ruby-grammar` — 가짜 host 로 등록 인자(`id` · `extensions` · `definitions`), 묶은 폴더에 wasm 이 일반 파일로 있는지(50MB 이하), 번들이 상대 경로 · 직접 네트워크를 쓰지 않는지 봅니다.
2. `build/ruby-grammar.zip` 을 [플러그인 추가 (zip)] 으로 설치하고 동의합니다.
3. **설정 › 기능**의 **코드 탐색**이 켜져 있어야 합니다.
4. `.rb` 파일을 오른쪽 패널에서 열고 경로 줄의 [개요] 를 눌러 항목이 보이는지 봅니다. 끄거나 지우면 [개요] 가 사라집니다. 앱에서 실제로 보이는지는 가짜 host 가 보지 못하니 직접 확인합니다.

## 정리

언어 팩은 번역 JSON 을 번들에 넣어 `host.locale.register`, 문법 팩은 `grammars.json` 과 폴더의 wasm 으로 `host.grammars.register` 를 부르는 서비스입니다. 둘 다 `scope: "app"` · 권한 `service`, 설치할 때 동의하면 그 자리에서 켜집니다. 실제 문법 팩: [rust-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/rust-grammar) · [kotlin-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/kotlin-grammar) · [csharp-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/csharp-grammar).

## 다음

- [서비스 플러그인 만들기](service-plugin.md) — 서비스의 소식 · 호스트 API 전체
- [저장소로 내보내기](publish.md) — 팩을 [플러그인 둘러보기] 에 올리기
