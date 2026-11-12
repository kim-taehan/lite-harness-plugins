# tetris — 테트리스

한 파일짜리 테트리스 게임 — 최고 점수를 서비스가 기억합니다.

## 역할

- 하는 일: 패널에서 테트리스를 하고, 게임이 끝나면 점수를 서비스에 알려 최고 점수를 남깁니다. 서비스가 꺼져 있어도 게임은 되고 최고 점수만 "–" 로 보입니다.
- 앱에 닿는 자리: 서비스(`service` — 앱 안에서 도는 코드)와 오른쪽 패널(`entry`).
- 범위: `scope: "app"` — 최고 점수가 프로젝트와 상관없는 하나의 기록이라 앱 전체로 둡니다.
- 권한: `service` — 최고 점수를 들고 있는 코드를 앱 안에 담습니다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜹니다). 저장은 `storage`(키 `best`)라 다른 권한은 없습니다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `scope` · `permissions` · `service`(`main: "service.mjs"`, `api: 1`) |
| `service/index.mjs` | 서비스 원본 — 최고 점수를 `storage` 에 두고 `expose` 이름 `best`(읽기) · `submit`(`{ score, lines }` — 더 높을 때만 기록)을 낸다. 받는 앱 소식은 없다 |
| `index.html` | 패널 — 게임 화면(캔버스). 시작할 때 `best` 를 읽고 게임이 끝나면 `submit` 으로 알린다 |
| `build.mjs` | `service/index.mjs` 를 `service.mjs` 한 파일로 묶는다(`--dir` 지원) |
| `tests/service.test.ts` | SDK 가짜 host 로 서비스 로직을 본다 |
| `changes.txt` | 업데이트 창에 보일 바뀐 것 |

## 개발

- 묶기: `node plugins/tetris/build.mjs` → `build/tetris.zip`, `--dir` 이면 `build/tetris/` 폴더(앱 개발 모드가 연결한다).
- 개발 모드: 앱 설정 › 기능 › 플러그인 › 개발 중 › [폴더 연결] 로 `build/tetris/` 를 연결해 고치며 확인한다. 고친 뒤 다시 묶는다.
- 테스트: `npm test -- --project tetris` — 가짜 host 로 서비스 로직을 본다. 앱이 서비스를 올려 패널과 주고받는 것은 앱에서 확인한다.
- 앱에서 못 본 것: 개발 모드에서 패널이 `service.call` 로 최고 점수를 읽고 쓰는 종단 확인은 하지 않았다(가짜 host 시험만).
- 배포: 아직 목록에 내지 않는다(`categories.json` 에 `unlisted`). 낼 때 분류를 적고 `docs/guides/publish.md` 의 절차(dev 에서는 release 하지 않고 `release/<날짜>` 브랜치에서 `npm run release -- --changed`)를 따른다.
