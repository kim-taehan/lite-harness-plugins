# csharp-grammar — C# 문법 팩

파일 개요가 C#(.cs) 파일의 네임스페이스 · 클래스 · 인터페이스 · 메서드를 읽게 합니다.

## 역할

- 하는 일: 오른쪽 패널에서 C# 파일(.cs)을 열면 경로 줄에 [개요] 가 생기고, 정의(namespace · class · interface · struct · enum · record · type · constructor · method · function)를 목록으로 보인다. 설정 › 기능 의 코드 탐색이 켜져 있어야 한다.
- 앱에 닿는 자리: 문법 팩(`type: "grammar"`) — 앱의 파일 개요가 이 wasm 문법으로 파일을 읽는다.
- 범위: 없음(문법 팩은 `scope` 를 적지 않는다, 표준 20번).
- 권한: 없음 — 화면도 실행하는 코드도 없다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `extension.json` | manifest — `grammars[0]`: 언어 id `c-sharp`, 확장자, wasm 이름(`tree-sitter-c_sharp.wasm`), 정의 노드 → 개요 종류 표(`definitions`) |
| `LICENSE` | 문법 패키지의 라이선스 (zip 에 같이 들어간다) |
| `build.mjs` | 묶기 — `scripts/grammar-pack.mjs` 로 루트 `package.json` 의 `code-grammar-c-sharp`(npm:tree-sitter-c-sharp@0.23.5)에서 wasm 을 꺼내 manifest · LICENSE 와 함께 묶는다. wasm 은 폴더에 두지 않는다 |

## 개발

- 묶기: `node plugins/csharp-grammar/build.mjs` → `build/csharp-grammar.zip` (먼저 `npm ci`). 문법 버전을 올리려면 `package.json` 의 별칭 버전을 바꾸고 `definitions` 의 노드 이름이 그대로인지 본다.
- 테스트: 자동 테스트 없음. 앱에 깔아 C# 파일의 [개요] 에 정의가 다 보이는지 본다. 만드는 법은 `docs/guides/locale-grammar.md`.
- 배포: `npm run release csharp-grammar`. 아직 catalog 에 올린 적이 없다.
