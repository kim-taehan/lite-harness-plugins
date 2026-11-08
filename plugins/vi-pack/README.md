# vi-pack — Tiếng Việt 언어 팩 (예제)

앱 화면 문구를 베트남어로 바꾸는 예제 언어 팩. 서비스(`service`)가 번역을 앱에 올린다.

## 역할

- 하는 일: 설치하고 켠 뒤 설정 › 일반 › 언어에서 Tiếng Việt 를 고르면 앱 문구가 베트남어로 보인다. 표본 번역이라 눈에 띄는 문구(사이드바 · 입력창 · 모드 · 모델 메뉴 · 설정 · 확장 화면)만 옮겼고, 나머지는 영어로 보인다.
- 앱에 닿는 자리: 서비스(`service`)가 `host.locale.register({ language: 'vi', … })` 로 번역을 올린다. 서비스를 끄거나 지우면 번역도 걷힌다.
- 범위: `scope: "app"` — 언어 등록은 앱 전체용 서비스만 할 수 있다.
- 권한: `service` — 앱 안에서 도는 코드를 담는다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜬다).

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `scope: "app"`, `permissions: ["service"]`, `service`(`main: "service.mjs"`, `api: 1`) |
| `locale.json` | 번역 `{ 키: 문자열 }` — 169개. 앱의 내장 키에 있는 것만 받고, 없는 키 · 너무 긴 값은 앱이 말없이 버린다 |
| `service/index.mjs` | 서비스 원본 — 번역을 `host.locale.register` 로 올린다 |
| `build.mjs` | 서비스를 `locale.json` 째 `service.mjs` 한 파일로 묶는다(`--dir` 지원) |
| `tests/service.test.ts` | SDK 가짜 host 로 번역이 올라가고 내리면 걷히는지 본다 |

## 개발

- 묶기: `node plugins/vi-pack/build.mjs` → `build/vi-pack.zip`, `--dir` 이면 `build/vi-pack/` 폴더(앱 개발 모드가 연결한다). zip 에는 `plugin.json` · `service.mjs` 만 들어간다(번역은 번들 안).
- 번역을 더할 때: 키 이름은 desktop `shared/i18n/ko.ts` 가 정본이다. 그 키 안에 있는지 보고 `locale.json` 에 넣고 다시 묶는다.
- 테스트: `npm test -- --project vi-pack` — 번역이 올라가고 서비스를 내리면 걷히는지. **앱이 서비스를 올려 실제로 언어가 바뀌는 것, 시작할 때 영어로 깜빡이지 않는지는 앱에서 확인**한다(못 봄).
- 배포: 지금은 목록에서 내려 두었다(`categories.json` `unlisted`). 내려면 분류를 적고 `npm run release vi-pack`.
- 이미 옛 방식(`type: "locale"`)으로 깔려 있으면 다시 설치해야 하고, 갈아끼운 직후 한 번 동의해야 켜진다.
