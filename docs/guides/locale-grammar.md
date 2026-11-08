[← 가이드 목록](../README.md)

# 언어 팩 · 문법 팩 만들기

코드를 실행하지 않고 데이터만 담는 두 플러그인. 앱 화면을 다른 언어로 바꾸는 언어 팩, 파일 개요가 새 프로그래밍 언어를 읽게 하는 문법 팩.

*약 20분 · type: locale · grammar · 권한 없음*

## 만들 것

- **프랑스어 언어 팩** `fr-pack` — 설정 › 일반 › 언어에 *Français* 가 생기고, 고르면 번역한 문구가 바뀝니다.
- **Ruby 문법 팩** `ruby-grammar` — `.rb` 파일을 열면 경로 줄에 [개요] 가 생겨 모듈 · 클래스 · 메서드가 보입니다.

둘 다 권한 · 화면 · 스킬 · MCP 를 담을 수 없습니다. 담으면 설치가 거절됩니다.

## 준비물

- [첫 패널 플러그인](first-panel.md)의 manifest 규칙 · zip 설치
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
  "details": "켜는 법\n설치만으로는 언어가 바뀌지 않습니다. 설정 › 일반 › 언어에서 Français 를 고르세요.\n번역하지 않은 문구는 영어로 보입니다.",
  "version": "0.1.0",
  "type": "locale",
  "locale": { "language": "fr", "label": "Français" },
  "entry": "locale.json"
}
```

| 필드 | 규칙 |
|---|---|
| `type` | `"locale"` |
| `locale.language` | BCP 47 언어 태그 (`fr` · `zh-CN` …). 내장 `ko` · `en` 은 거절 |
| `locale.label` | 언어 고르기에 보이는 그 언어의 자기 이름 |
| `entry` | 필수. 번역 번들 `.json` |

### 2. locale.json

앱 문구 키 → 번역한 글의 평평한 JSON 입니다. 키는 `en.ts` 에 있는 것만 쓰입니다(모르는 키는 버립니다). `{count}` 같은 자리표시는 그대로 둡니다.

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
- 상한: 키 5000개, 값 하나 2000자. 모바일 앱에는 적용되지 않습니다.
- 팩을 끄거나 지우면 언어가 English 로 돌아갑니다.

### 3. 묶어 설치

터미널

```sh
mkdir -p build
cd plugins/fr-pack
zip -r ../../build/fr-pack.zip . -x '.DS_Store'
```

**설정 › 기능 › 플러그인 › [플러그인 추가 (zip)]** 으로 설치하고, **설정 › 일반 › 언어**에서 Français 를 고릅니다. 실제 예: [ja-pack](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/ja-pack) · [zh-cn-pack](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/zh-cn-pack).

## 문법 팩

오른쪽 패널에서 파일을 열면 보이는 **개요**는 tree-sitter 로 파일을 읽어 클래스 · 함수 같은 정의를 뽑습니다. 문법 팩은 앱에 없는 언어의 **문법 wasm** 과 **어떤 노드를 개요에 올릴지 적은 표**를 더합니다. 앱에 이미 있는 언어(Java · Python · JS/TS · C/C++ · Go)의 확장자는 가져갈 수 없습니다.

### 4. 문법 패키지 받기

문법 패키지를 `code-grammar-<언어>` 별칭으로, 버전을 고정해(`-E`) 개발 의존성에 더합니다. wasm 은 저장소에 넣지 않고 빌드 때 여기서 꺼냅니다.

터미널 (저장소 맨 위에서)

```sh
npm i -D -E code-grammar-ruby@npm:tree-sitter-ruby@<버전>
ls node_modules/code-grammar-ruby/*.wasm      # 패키지가 wasm 을 싣고 있는지 확인
```

> wasm 을 싣지 않은 문법 패키지도 있습니다. 그럴 때는 다른 배포본(예: `@tree-sitter-grammars/…`)을 찾습니다 — kotlin 팩이 그렇게 받습니다. 패키지의 라이선스 파일은 팩 폴더에 `LICENSE` 로 같이 둡니다.

### 5. plugin.json

새 팩은 `plugin.json` 으로 씁니다(표준 4번). 묶기 스크립트(`scripts/grammar-pack.mjs`)는 `plugin.json` 을 먼저, 없으면 옛 팩의 `extension.json` 을 읽습니다.

`plugins/ruby-grammar/plugin.json`

```json
{
  "id": "ruby-grammar",
  "name": "Ruby 문법 팩",
  "description": "파일 개요가 Ruby(.rb) 파일의 모듈 · 클래스 · 메서드를 읽게 합니다",
  "version": "0.1.0",
  "type": "grammar",
  "grammars": [
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
}
```

| 필드 | 규칙 |
|---|---|
| `grammars[].id` | 팩 안에서 겹치지 않는 언어 id (소문자 · 숫자 · `-`) |
| `extensions` | 점 없는 소문자 확장자. 앱 내장 언어의 것은 거절 |
| `wasm` | 팩 폴더 기준 경로 — 패키지 안의 파일 이름과 같게 |
| `definitions` | tree-sitter 노드 종류 → 개요 종류: `class` · `interface` · `enum` · `record` · `annotation` · `struct` · `namespace` · `type` · `constructor` · `method` · `function` |

노드 하나가 경우에 따라 다른 종류면 **조건 칸**을 씁니다. 노드의 `field` 자리에 든 노드 종류로 고르고(`*` 는 나머지), `name` 을 적으면 이름을 그 필드에서 읽습니다. Rust 팩의 `impl` 블록이 예입니다:

`rust-grammar 의 definitions 일부`

```
"impl_item": { "field": "type", "kinds": { "*": "struct" }, "name": "type" }
```

노드 종류 이름은 문법 패키지의 `src/node-types.json` 이나 [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/7-playground.html) 에서 확인합니다.

### 6. build.mjs 와 분류

다른 문법 팩과 같은 한 줄짜리입니다.

`plugins/ruby-grammar/build.mjs`

```js
import { packGrammar } from '../../scripts/grammar-pack.mjs'

packGrammar(import.meta.dirname, 'code-grammar-ruby')
```

터미널

```sh
node plugins/ruby-grammar/build.mjs     # → build/ruby-grammar.zip (plugin.json · LICENSE · wasm)
```

저장소로 올릴 때는 `categories.json` 에 `"ruby-grammar": "dev-tool"` 한 줄을 더합니다 — [저장소로 내보내기](publish.md).

### 7. 설치하고 확인

1. `build/ruby-grammar.zip` 을 [플러그인 추가 (zip)] 으로 설치합니다.
2. **설정 › 기능**의 **코드 탐색**이 켜져 있어야 합니다.
3. `.rb` 파일을 오른쪽 패널에서 열고 경로 줄의 [개요] 를 눌러 항목이 보이는지 봅니다. 끄거나 지우면 [개요] 가 사라집니다.

## 정리

언어 팩은 `type: "locale"` + 번역 JSON, 문법 팩은 `type: "grammar"` + wasm + 정의 노드 표입니다. 둘 다 코드를 실행하지 않아 권한을 묻지 않습니다. 실제 문법 팩: [rust-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/rust-grammar) · [kotlin-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/kotlin-grammar) · [csharp-grammar](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/csharp-grammar).

## 다음

- [저장소로 내보내기](publish.md) — 팩을 [플러그인 둘러보기] 에 올리기
