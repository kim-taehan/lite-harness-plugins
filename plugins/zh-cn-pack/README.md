# zh-cn-pack — 简体中文 언어 팩

앱 화면 문구를 중국어(간체)로 바꾸는 언어 팩. 서비스(`service`)가 번역을 앱에 올린다.

## 역할

- 하는 일: 설치하고 켠 뒤 설정 › 일반 › 언어에서 中文(简体) 를 고르면 앱 문구가 중국어(간체)로 보인다. 앱의 화면 문구 전체(0.3.0 기준 2,349개)를 옮겼다. 앱이 새 문구를 더하면 이 팩을 업데이트하기 전까지 그 문구만 영어로 보인다.
- 앱에 닿는 자리: 서비스(`service`)가 `host.locale.register({ language: 'zh-CN', … })` 로 번역을 올린다. 서비스를 끄거나 지우면 번역도 걷힌다.
- 범위: `scope: "app"` — 언어 등록은 앱 전체용 서비스만 할 수 있다.
- 권한: `service` — 앱 안에서 도는 코드를 담는다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜬다).

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `scope: "app"`, `permissions: ["service"]`, `service`(`main: "service.mjs"`, `api: 1`) |
| `locale.json` | 번역 `{ 키: 문자열 }` — 2,349개(0.3.0, desktop `shared/i18n/en.ts` 의 키 전부). 앱의 내장 키에 있는 것만 받고, 없는 키 · 너무 긴 값은 앱이 말없이 버린다 |
| `service/index.mjs` | 서비스 원본 — 번역을 `host.locale.register` 로 올린다 |
| `build.mjs` | 서비스를 `locale.json` 째 `service.mjs` 한 파일로 묶는다(`--dir` 지원) |
| `tests/service.test.ts` | SDK 가짜 host 로 번역이 올라가고 내리면 걷히는지 본다 |

## 개발

- 묶기: `node plugins/zh-cn-pack/build.mjs` → `build/zh-cn-pack.zip`, `--dir` 이면 `build/zh-cn-pack/` 폴더(앱 개발 모드가 연결한다). zip 에는 `plugin.json` · `service.mjs` 만 들어간다(번역은 번들 안).
- 번역을 더할 때: 키 이름은 desktop `shared/i18n/ko.ts` 가 정본이고 영어 원문은 `en.ts`(영역별 `en/*.ts`)다. desktop 에 문구가 더해지면 `locale.json` 에 없는 키가 영어로 보이므로, 옆 desktop 의 `en` 사전과 키를 견줘 빠진 것을 옮기고 다시 묶는다. 번역할 때는 `{자리표시}` · `<…>` · `/명령` 을 영어 원문 그대로 두고, 같은 말은 파일 안의 기존 용어(대화 · 扩展 · 工作树 · 钩子 …)를 따른다.
- 앱의 한도: 키 5,000개 · 값 하나 2,000자까지만 받고 넘으면 말없이 버린다(`shared/extensions/limits.ts`). 지금은 키 2,349개 · 가장 긴 값 291자.
- 테스트: `npm test -- --project zh-cn-pack` — 번역이 올라가고 서비스를 내리면 걷히는지. **앱이 서비스를 올려 실제로 언어가 바뀌는 것, 시작할 때 영어로 깜빡이지 않는지는 앱에서 확인**한다(못 봄).
- 배포: 지금은 목록에서 내려 두었다(`categories.json` `unlisted`). 내려면 분류를 적고 `npm run release zh-cn-pack`.
- 이미 옛 방식(`type: "locale"`)으로 깔려 있으면 다시 설치해야 하고, 갈아끼운 직후 한 번 동의해야 켜진다.
