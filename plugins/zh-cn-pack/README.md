# zh-cn-pack — 简体中文 언어 팩 (예제)

앱 화면 문구를 간체 중국어로 바꾸는 예제 언어 팩.

## 역할

- 하는 일: 설치한 뒤 설정 › 일반 › 언어에서 中文(简体) 를 고르면 앱 문구가 간체 중국어로 보인다. 표본 번역이라 눈에 띄는 문구(사이드바 · 입력창 · 모드 · 모델 메뉴 · 설정 · 확장 화면)만 옮겼고, 나머지는 영어로 보인다.
- 앱에 닿는 자리: 언어 팩(`type: "locale"`, 언어 `zh-CN`).
- 범위: 없음(언어 팩은 `scope` 를 적지 않는다, 표준 20번).
- 권한: 없음.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `extension.json` | manifest — `type: "locale"`, `locale`(언어 코드 · 이름), `entry: "locale.json"` |
| `locale.json` | 번역 `{ 키: 문자열 }` — 지금 169개. 앱의 내장 키에 있는 것만 받고, 없는 키 · 너무 긴 값은 말없이 버린다(desktop `src/services/extensions/locale.ts`) |

## 개발

- 묶기: `build.mjs` 없음 — release 가 폴더를 그대로 묶는다(`README.md` · `changes.txt` · `tests/` 빼고).
- 번역을 더할 때: 키 이름은 desktop `shared/i18n/ko.ts` 가 정본이다. 그 키 안에 있는지 보고 넣는다.
- 테스트: 자동 테스트 없음. 앱에 깔아 언어를 바꿔 본다. 만드는 법은 `docs/guides/locale-grammar.md`.
- 배포: `npm run release zh-cn-pack`.
