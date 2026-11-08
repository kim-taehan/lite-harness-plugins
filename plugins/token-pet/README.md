# token-pet — 빛톨 키우기

AI 에 쓴 토큰만큼 자라는 도트 몬스터. 누르거나 말을 걸면 종 · 단계 · 성격대로 대답한다.

## 역할

- 하는 일: 토큰 사용량으로 알이 부화하고 세 단계로 진화해 졸업하면 도감에 남는다. 패널에서 누르면 미리 쓴 대사로, 대화에서 "빛톨아" 하고 부르면 AI 가 그 빛톨이 되어 답한다.
- 앱에 닿는 자리: 패널 · AI 도구(MCP) · 스킬.
- 범위: `"app"` — 어느 프로젝트에서나 같은 빛톨 하나.
- 권한:
  - `usage` — 쓴 토큰을 읽어 먹이로 센다.
  - `chat` — [말 걸기] 가 새 대화에 요청을 보낸다.
  - `mcp` — AI 가 빛톨의 말투(`persona`)를 읽고 한 말(`say`)을 남기는 서버.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `extension.json` | manifest — 패널, `mcp`(`server.mjs ${dataDir}`, 패널 전용 도구 `sync` · `last_said`), 스킬 |
| `index.html` | 패널 — 빛톨 그림 · 성장 · 도감 · 배경 · 전체 화면 |
| `persona.js` | 종 · 단계 · 성격별 대사와 말투 규칙. 패널(`<script src>`)과 서버(`import`)가 같이 쓴다 |
| `server.mjs` | MCP 서버(의존성 없음, stdio) — AI 용 `persona` · `say`, 패널 전용 `sync` · `last_said`. 서버가 프로젝트마다 뜨므로 상태는 `dataDir` 의 `state.json` · `last-said.json` 에 둔다 |
| `skills/token-pet/` | "빛톨아" 같은 말에 AI 가 `persona` 를 불러 그 말투로만 답하게 하는 스킬 |
| `changes.txt` | 업데이트 창에 보일 바뀐 것 |

## 개발

- 묶기: `build.mjs` 없음 — release 가 폴더를 그대로 묶는다(`README.md` · `changes.txt` · `tests/` 빼고). 앱 개발 모드는 이 폴더를 바로 연결한다.
- 테스트: `npm test -- --project token-pet` — 서버를 앱처럼 Node 로 띄워 JSON-RPC 로 부르고, 페르소나 규칙을 본다.
- 배포: `npm run release token-pet`.
