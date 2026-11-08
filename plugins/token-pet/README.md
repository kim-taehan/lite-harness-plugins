# token-pet — 빛톨 키우기

AI 에 쓴 토큰만큼 자라는 도트 몬스터. 누르거나 말을 걸면 종 · 단계 · 성격대로 대답한다.

## 역할

- 하는 일: 토큰 사용량으로 알이 부화하고 세 단계로 진화해 졸업하면 도감에 남는다. 패널에서 누르면 미리 쓴 대사로, 대화에서 "빛톨아" 하고 부르면 AI 가 그 빛톨이 되어 답한다. 먹이는 서비스가 쌓으므로 패널을 닫아 둬도 자란다.
- 앱에 닿는 자리: 서비스(`service` — 앱 안에서 도는 코드, 먹이 계산 · AI 도구 `persona` · `say`) · 패널 · 스킬.
- 범위: `"app"` — 어느 프로젝트에서나 같은 빛톨 하나.
- 권한:
  - `service` — 앱 안에서 도는 서비스를 담는다.
  - `usage` — 쓴 토큰을 읽어 먹이로 센다(`usage.changed` 소식 · `usage.summary`).
  - `chat` — [말 걸기] 가 새 대화에 요청을 보낸다(`chat.compose`).

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `extension.json` | manifest — 패널, `service`(`service.mjs`, 소식 `usage.changed`), 스킬 |
| `service/index.mjs` | 서비스 원본 — 사용량 소식을 받아 먹이를 주고 저장(storage `state`)하고 패널에 밀어 보낸다(`service.update`). 패널이 부르는 `state` · `setBg` · `talk`, AI 도구 `persona` · `say` |
| `game.js` | 게임 규칙(기준 · 부화 · 진화 · 졸업). 서비스(묶음에 들어간다)와 패널(`<script src>`)이 같이 쓴다 |
| `persona.js` | 종 · 단계 · 성격별 대사와 말투 규칙. 서비스와 패널이 같이 쓴다 |
| `index.html` | 패널 — 빛톨 그림 · 성장 · 도감 · 배경 · 전체 화면. 상태는 서비스가 주고 패널은 저장하지 않는다 |
| `build.mjs` | `service/index.mjs` 를 `game.js` · `persona.js` 째 `service.mjs` 한 파일로 묶는다 |
| `skills/token-pet/` | "빛톨아" 같은 말에 AI 가 `token-pet_persona` 를 불러 그 말투로만 답하게 하는 스킬 |
| `tests/service.test.ts` | SDK 가짜 host 로 서비스 · 게임 규칙 · 페르소나를 본다 |
| `changes.txt` | 업데이트 창에 보일 바뀐 것 |

## 개발

- 묶기: `node plugins/token-pet/build.mjs` → `build/token-pet.zip`, `--dir` 이면 `build/token-pet/` 폴더(앱 개발 모드가 연결한다).
- 테스트: `npm test -- --project token-pet` — 앱 없이 가짜 host 로 먹이 · 부화 · 진화 · 졸업, 저장 이어받기, `say` · `persona` 도구, 패널로 밀어 보내기를 본다. **앱이 서비스를 올리고 패널이 `service.call` 로 묻는 것, AI 가 도구를 부르는 것은 앱에서 확인**한다(가짜 host 가 못 본다).
- 한계: 서비스에 영구 저장소가 없어 `host.call('storage.*')` 로 패널이 쓰던 `state` 키를 그대로 이어 쓴다. 패널 전체 화면(`panel.fullscreen`)은 아직 패널이 직접 부른다(서비스에서 여는 길은 desktop 후속 PR).
- 배포: `npm run release token-pet`.
