# service-example — 서비스 예제 (턴 세기)

설치형 서비스(`service` 선언)를 시험하는 예제. AI 대화 턴이 끝날 때마다 프로젝트별로 세고, 패널이 서비스에 물어 보여 준다.

## 역할

- 하는 일: 설치해서 켜면 패널에 "이 프로젝트에서 끝난 AI 대화 턴" 수가 보인다. 패널을 닫아 둔 동안에도 센다(서비스가 앱 안에서 계속 돈다).
- 앱에 닿는 자리: 서비스(`service`, 번들은 앱 프로세스 안에서 도는 코드)와 오른쪽 패널(`entry`). 목록에는 나오지 않는다(`unlisted`) — 방식을 시험하고 새 서비스를 만들 때 따라 하는 본보기다.
- 범위: `scope: "project"` — 프로젝트마다 다른 횟수를 센다.
- 권한: `service`(서비스 선언과 짝) · `chat`(`chat.turnEnded` 소식을 받으려면 필요 — 패널 소식과 같은 표).

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `service`(`main` · `api: 1` · `inject` · `events`) |
| `service.mjs` | 서비스 본체. `export default ({ Service }) => class … extends Service` — cordis 를 import 하지 않고 앱이 넘긴 `Service` 를 쓴다 |
| `index.html` | 패널 — `service.call { name: 'count' }` 로 5초마다 묻는다 |
| `tests/service.test.ts` | 앱 없이 가짜 `Service` · `ctx` 로 서비스 로직을 본다 |

## 개발

- 묶기: 의존성이 없어 `build.mjs` 없음 — release 가 폴더를 그대로 묶는다(`README.md` · `changes.txt` · `tests/` 빼고).
- 테스트: `npm test -- --project service-example` — 구독하는 소식 · 프로젝트별 셈 · 프로젝트 없는 소식 버리기. **앱이 서비스를 올리고 패널이 묻는 것은 앱 PR 2 뒤에 앱에서 확인**한다(아직 못 봄). 소식 값은 `{ directory, conversationId, outcome }`, `expose` 의 두 번째 인자는 `{ directory? }`(폴더를 모르면 없음)로 desktop 에 확인했다.
- 배포: 목록에 내는 플러그인이 아니라 release 하지 않는다. 내려면 `categories.json` 의 `unlisted` 를 분류로 바꾼다.
