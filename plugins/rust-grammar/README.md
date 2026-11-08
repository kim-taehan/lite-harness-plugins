# rust-grammar — Rust 문법 팩

파일 개요가 Rust(.rs) 파일의 모듈 · 구조체 · 트레이트 · impl · 함수를 읽게 합니다. 서비스(`service`)가 tree-sitter 문법을 앱에 올린다.

## 역할

- 하는 일: 설치하고 켜면 오른쪽 패널에서 Rust 파일을 열 때 경로 줄에 [개요] 가 생겨 정의를 목록으로 보인다. 설정 › 기능 의 코드 탐색이 켜져 있어야 한다. 끄거나 지우면 [개요] 가 사라진다.
- 앱에 닿는 자리: 서비스(`service`)가 `host.grammars.register` 로 문법(`grammars.json` 의 확장자 `rs` · wasm · 정의 노드 표)을 올린다. 서비스를 끄거나 지우면 등록도 걷힌다.
- 범위: `scope: "app"` — 문법 등록은 앱 전체용 서비스만 할 수 있다.
- 권한: `service` — 앱 안에서 도는 코드를 담는다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜬다). 문법을 올리는 일 외에는 하지 않는다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `scope: "app"`, `permissions: ["service"]`, `service`(`main: "service.mjs"`, `api: 1`) |
| `grammars.json` | 올릴 문법 선언 `[{ id, label, extensions, wasm, definitions }]` — 옛 manifest 의 `grammars` 와 같은 모양 |
| `service/index.mjs` | 서비스 원본 — `scripts/grammar-service.mjs` 의 공용 본체에 `grammars.json` 을 넘긴다 |
| `build.mjs` | `scripts/grammar-pack.mjs` 로 묶는다 — 서비스를 `service.mjs` 한 파일로, `tree-sitter-rust.wasm` 은 폴더에 둔다 |
| `LICENSE` | 문법(tree-sitter) 라이선스 |
| `tests/service.test.ts` | 가짜 host 로 등록 인자와 내리면 걷히는지, 묶은 폴더에 wasm 이 있는지 본다 |

## 개발

- 묶기: `node plugins/rust-grammar/build.mjs` → `build/rust-grammar.zip`, `--dir` 이면 `build/rust-grammar/` 폴더(앱 개발 모드가 연결한다). zip 에는 `plugin.json` · `service.mjs` · `LICENSE` · `tree-sitter-rust.wasm`. wasm 은 폴더에 커밋하지 않고 묶을 때 node_modules 의 문법 패키지(`code-grammar-rust`)에서 꺼낸다 — `npm ci` 가 먼저다.
- 테스트: `npm test -- --project rust-grammar` — 가짜 host 로 등록 인자(id · extensions · definitions)와 서비스를 내리면 걷히는지, 묶은 폴더에 wasm 이 일반 파일로 있는지. **앱이 서비스를 올려 실제 파일 개요에 Rust 이 보이는지는 앱에서 확인**한다(못 봄). SDK 사본에 `host.grammars` · `host.dir` 가 아직 없어 테스트가 가짜 host 에 `grammars.register` 를 덧붙여 쓴다.
- 배포: 목록에서 내려 둔 상태(`categories.json` `unlisted`)이고 나온 적이 없다. 내려면 분류를 적고 `npm run release rust-grammar`.
- 이미 옛 방식(`type: "grammar"`)으로 깔려 있으면 다시 설치해야 하고, 갈아끼운 직후 한 번 동의해야 켜진다.
