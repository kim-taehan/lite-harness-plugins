# risene-pet — 리센느 키우기

AI 에 쓴 토큰이 먹이가 되어 걸그룹 리센느 멤버의 치비 캐릭터가 자라는 개인용 플러그인. 누르거나 부르면 그 캐릭터 말투로 대답한다(빛톨 키우기 `token-pet` 과 같은 콘셉트).

## 역할

- 하는 일: 멤버(지금은 원이 · 메이)를 골라 키운다. 고른 멤버의 현재 캐릭터가 토큰을 먹고 1→2→3단계로 자라 졸업하고 도감에 남는다. 알 · 부화 · 무작위 뽑기는 없다. 캐릭터와 멤버는 계속 추가된다 — 멤버마다 캐릭터가 순서 목록으로 있고(원이: 거제소녀 → 파이리원이, 메이: 매트 → 디렉터) 앞 캐릭터가 졸업하면 다음 캐릭터가 열린다. 마지막까지 졸업하면 그 멤버는 완주해 먹이를 받지 않지만, 목록에 캐릭터가 더해지면 다시 자란다. 대기실(전체 화면)에는 멤버마다 현재 캐릭터가 항상 한 명씩 있다. 캐릭터 이름을 부르면 AI 가 그 말투로 답하고 패널이 말풍선으로 보여 준다.
- 앱에 닿는 자리: 서비스(`service` — 사용량 소식으로 먹이 계산 · AI 도구 · 스킬)와 오른쪽 패널(`entry`, 전체 화면 = 대기실).
- 범위: `scope: "app"` — 토큰 사용량이 프로젝트를 모르는 앱 전체 값이고(`usage.changed` 는 app 만 받는다) 캐릭터도 앱 하나에 한 무리라서.
- 권한:
  - `service` — 앱 안에서 도는 코드를 담는다(설치 동의창에 "앱 안에서 직접 실행됩니다" 가 뜬다).
  - `usage` — 사용량 장부를 읽어 늘어난 토큰을 먹이로 센다(`usage.summary` · `usage.changed`).
  - `chat` — [말 걸기] 가 새 대화를 "<캐릭터 이름>, " 로 채워 연다(`chat.compose`, 보내지 않는다).
- 데이터: 상태(고른 멤버 `active` — 키울 수 있는(준비중이 아닌) 멤버가 한 명뿐이면 처음부터 그 멤버(지금은 둘이라 처음엔 비어 있다)이고 사용자가 해제한 `null` 은 다시 켜도 그대로 둔다 · 캐릭터별 먹이 · 졸업 · 새로 만남, `v: 2`)는 `storage` 의 `state` 키 하나에만 둔다. 이 PC 에만 남고 프로젝트 파일은 만들지 않는다.
- 준비중 캐릭터(`soon`): 미나미(갸루상) · 리브(리트) · 제나(신라공주)는 `game.js` 에 `soon: true` 로만 있어 도감에 카드만 보이고 고르거나 키울 수 없다(`select` 는 "준비 중인 멤버입니다." 로 거절, 먹이 · 졸업 · 해금 · 자동 선택 계산에서 빠진다). 준비되면 `soon` 만 지우면 되고, 이 셋은 시트와 확정 페르소나가 생기면 메모(`risene-persona-minami` · `risene-persona-liv` · `risene-persona-zena`)로 만든다. 도감 순서는 키울 수 있는 멤버가 먼저, 준비중 멤버가 뒤(원이 → 메이 → 미나미 → 리브 → 제나)다.

## 구성

| 파일 · 폴더 | 하는 일 |
|---|---|
| `plugin.json` | manifest — `scope: "app"` · `permissions` · `service`(`main: "service.mjs"`, `api: 1`, `events: ["usage.changed"]`) |
| `game.js` | 게임 규칙(`globalThis.RISENE_PET_GAME`) — 멤버 · 캐릭터 목록(`MEMBERS` · `CHARACTERS`, 캐릭터는 여기 두 표에만 둔다), 성장 기준 `ENDS`, `sayMax`(멤버별 `say` 글자 수 상한 — 원이 40 · 메이 700, `sayMaxOf`), `feed` · `applyUsage` · `select` · `deselect` · `roster`(대기실 · 도감용 파생값) · `migrate`. 서비스와 패널이 같이 쓴다 |
| `persona.js` | 캐릭터 말투 · 대사(`globalThis.RISENE_PET_PERSONA`) — 서비스는 `ACTIONS` · `voice` 를 읽는다 |
| `service/index.mjs` | 서비스 원본 — 사용량 소식(`usage.changed`)에서 먹이 계산, 저장, `service.update` 로 패널에 밀어 보내기, AI 도구 `persona` · `say`, 스킬 등록 |
| `index.html` | 패널 — 무대 · 성장 배지 · 도감 · 대기실 화면 |
| `assets/` | 캐릭터별(`assets/<캐릭터 id>/`) 컷아웃 이미지(zip 과 `--dir` 에 그대로 실린다) |
| `skills/risene-pet/` | 캐릭터 이름을 부르면 AI 가 `persona` 도구로 그 말투로 답하게 하는 스킬 |
| `build.mjs` | `service/index.mjs` 를 `game.js` · `persona.js` 째 `service.mjs` 한 파일로 묶고 나머지를 담는다(`--dir` 지원) |
| `tests/service.test.ts` | SDK 가짜 host 로 게임 규칙과 서비스를 본다 |
| `changes.txt` | 업데이트 창에 보일 바뀐 것 |

패널이 부르는 `expose` 이름: `state` · `select`(`{ member }`) · `deselect` · `talk` · `fullscreen`(`{ on }`) · `seenDex`(`{ id }`). 상태를 바꾸는 것은 모두 같은 스냅샷(`{ state, today, error, said }`)을 돌려주고 `service.update` 로도 밀어 보낸다. 서비스가 받는 소식: `usage.changed`. 푸시에는 먹이를 먹었을 때 `event`(`eat` · `evolve` · `graduate`)와 `id` 가 붙고, `graduate` 에는 새로 열린 캐릭터 `unlocked`(없으면 `null`)도 붙는다. 대기실 위치는 저장하지 않는다 — 패널이 `roster(state)` 로 그리고 걷기를 처리한다.

## 개발

- 묶기: `node plugins/risene-pet/build.mjs` → `build/risene-pet.zip`, `--dir` 이면 `build/risene-pet/` 폴더(앱 개발 모드가 연결한다). `persona.js` · `skills/` · `assets/` 가 있어야 묶인다.
- 테스트: `npm test -- --project risene-pet` — 가짜 host 로 멤버 선택 · 고른 멤버만 먹이 받기 · 졸업과 다음 캐릭터 해금 · 완주와 캐릭터 추가 뒤 재성장 · 이어받기와 옛 형식(`stage` · `names`) 옮기기 · `say`/`persona` · 패널로 밀어 보내기를 본다.
- 앱에서 못 본 것: 앱이 서비스를 올리고 패널이 `service.call` 로 묻는 것, 스킬을 읽은 AI 가 `risene-pet_persona` · `risene-pet_say` 를 부르는 것, `usage.changed` 소식이 실제로 오는 것.
- 배포: 아직 목록에 내지 않는다(`categories.json` 에 `unlisted`). 낼 때 분류를 적고 `docs/guides/publish.md` 의 절차를 따른다.
