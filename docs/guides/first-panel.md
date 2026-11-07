[← 가이드 목록](../README.md)

# 첫 패널 플러그인 만들기

오른쪽 패널에 탭 하나를 더하는 가장 작은 플러그인을 만듭니다. 파일은 둘, 빌드는 없습니다.

*약 15분 · 권한: project · chat*

## 만들 것

**메모장** 패널을 만듭니다. 오른쪽 패널의 `+` 메뉴에서 열면

- 지금 프로젝트 이름을 보여 주고 (`project.info`)
- 적은 메모를 플러그인 저장소에 남겨 다시 열어도 그대로 있고 (`storage.get` · `storage.set`)
- [AI 에게 보내기] 를 누르면 그 메모로 새 대화를 엽니다 (`chat.compose`).

## 준비물

- Lite Harness 앱 ([Releases](https://github.com/kim-taehan/lite-harness-plugins/releases) 의 `app-v<버전>`)
- 텍스트 편집기, 그리고 `zip` 명령 (macOS 기본 · Windows 는 탐색기의 "압축(ZIP) 폴더" 로도 됩니다)
- HTML · JavaScript 기초

## 플러그인은 어떻게 도나

패널 플러그인은 zip 하나입니다. 맨 위에 `plugin.json`(manifest)이 있고, 그것이 가리키는 **한 파일짜리 HTML** 이 오른쪽 패널 탭이 됩니다.

- HTML 은 **sandbox iframe** 에서 돕니다. 외부 스크립트 · 스타일 · 이미지 · 글꼴과 `fetch` 는 CSP 로 막힙니다 — 스크립트와 스타일은 HTML 안에 인라인으로 넣습니다. 같은 zip 의 다른 파일도 패널에서 불러올 수 없습니다.
- 앱에 무언가를 부탁하는 길은 `parent.postMessage` 하나(**앱 통로**)입니다. 앱은 메시지가 어느 iframe 에서 왔는지로 플러그인을 알아보고, manifest 의 `permissions` 에 적힌 것만 들어 줍니다.

## 1. 폴더와 plugin.json

저장소의 `plugins/` 아래에 플러그인 id 와 같은 이름으로 폴더를 만듭니다. (저장소에 올리지 않을 거면 아무 폴더여도 됩니다.)

`plugins/hello-panel/plugin.json`

```json
{
  "id": "hello-panel",
  "name": "메모장",
  "description": "프로젝트 이름을 보여 주고, 적은 메모를 남기고, AI 에게 보내는 예제 패널",
  "details": "오른쪽 패널의 + 메뉴에서 메모장을 엽니다.\n적은 메모는 이 PC 의 플러그인 저장소에만 남습니다.",
  "version": "0.1.0",
  "entry": "index.html",
  "permissions": ["project", "chat"]
}
```

| 필드 | 규칙 |
|---|---|
| `id` | 소문자 · 숫자 · `-`, 3~40자. 폴더 이름 · 설정 키로 쓰입니다. 앱 기능 이름과 겹치면 거절 |
| `name` · `description` | 카드 제목(80자)과 한 줄 설명(300자) |
| `details` | 선택. 카드를 펼치면 보이는 긴 설명(2000자, 글만 — HTML 아님). 켜는 법 · 쓰는 법은 여기에 |
| `version` | semver (`0.1.0`). 앱은 더 높은 버전만 업데이트로 받습니다 |
| `entry` | 패널 HTML (`.html` · `.htm`), manifest 기준 상대 경로 |
| `permissions` | 선택. 아래 [권한 표](#앱-통로와-권한)의 값만 |
| `litecode` | 선택. 필요한 최소 앱 버전 — 낮은 앱은 설치를 거절합니다 |

> **모르는 필드는 설치 거절입니다.** `permisions` 같은 오타가 조용히 넘어가 권한이 빠진 채 설치되지 않게 하려는 것입니다. 메모용 필드를 manifest 에 넣지 마세요. 옛 이름 `extension.json` 도 읽지만 새 플러그인은 `plugin.json` 으로 씁니다.

## 2. 패널 HTML

한 파일 안에 화면 · 스타일 · 스크립트를 다 넣습니다. 맨 위 `call()` 이 앱 통로입니다 — 요청에 번호를 붙여 보내고, 같은 번호의 답을 기다립니다.

`plugins/hello-panel/index.html`

```html
<!doctype html>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { margin: 16px; display: grid; gap: 10px; }
  textarea { width: 100%; min-height: 160px; box-sizing: border-box; font: inherit; }
  .muted { opacity: .7; }
</style>
<h3 id="project" class="muted">프로젝트 …</h3>
<textarea id="memo" placeholder="메모를 적으세요"></textarea>
<div>
  <button id="send">AI 에게 보내기</button>
  <span id="status" class="muted"></span>
</div>
<script>
// ── 앱 통로 ──
let next = 0
const waiting = new Map()
function call(method, params) {
  const id = ++next
  parent.postMessage({ litecode: 1, id, method, params }, '*')
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
}
addEventListener('message', ({ data }) => {
  const w = data && data.litecode === 1 && waiting.get(data.id)
  if (!w) return
  waiting.delete(data.id)
  data.ok ? w.resolve(data.result) : w.reject(new Error(data.error))
})

// ── 화면 ──
const memo = document.getElementById('memo')
const status = document.getElementById('status')

call('project.info')
  .then(({ name }) => (document.getElementById('project').textContent = name))
  .catch(() => (document.getElementById('project').textContent = '열린 프로젝트 없음'))

call('storage.get', { key: 'memo' }).then((saved) => (memo.value = saved ?? ''))

let timer
memo.addEventListener('input', () => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    await call('storage.set', { key: 'memo', value: memo.value })
    status.textContent = '저장됨'
  }, 400)
})

document.getElementById('send').addEventListener('click', () => {
  if (memo.value.trim() === '') return
  call('chat.compose', { text: memo.value, send: false })
    .catch((error) => (status.textContent = '보내지 못함: ' + error.message))
})
</script>
```

답은 `{ litecode: 1, id, ok: true, result }` 또는 `{ litecode: 1, id, ok: false, error }` 모양입니다. `error` 는 `permission-missing` · `no-project` · `params-invalid` 같은 코드라 화면에 그대로 띄우기보다 경우별로 안내를 다는 편이 좋습니다.

## 3. zip 으로 묶어 설치

폴더 **안에서** 묶어 `plugin.json` 이 zip 맨 위에 오게 합니다. 폴더째 묶으면 manifest 가 한 칸 안에 들어가 설치가 거절됩니다.

터미널

```sh
mkdir -p build
cd plugins/hello-panel
zip -r ../../build/hello-panel.zip . -x '.DS_Store'
```

1. 앱의 **설정 › 기능 › 플러그인** 탭에서 **[플러그인 추가 (zip)]** 을 누르고 zip 을 고릅니다.
2. 설치 확인 카드에 이름 · 설명 · 요청 권한(project · chat)이 보입니다. 설치합니다.
3. 오른쪽 패널의 `+` 메뉴에 **메모장** 이 생깁니다. 열어 메모를 적고, 탭을 닫았다 다시 열어 메모가 남아 있는지 봅니다.

거절되면 카드에 사유가 나옵니다 — 모르는 필드 · id 모양 · 진입 파일 없음 · 모르는 권한(오타면 맞는 이름을 같이 알려 줍니다) 같은 것들입니다.

## 4. 고치고 다시 설치

`version` 을 올리고(`0.1.1`) 다시 묶어 같은 길로 설치하면 설치 카드에 지금 버전이 같이 보이고 새 버전으로 바뀝니다. 저장소로 나간 뒤에는 버전이 높아야만 업데이트로 보이니, 고칠 때마다 버전을 올리는 습관을 들이세요. 권한을 늘리면 앱이 사용자에게 다시 묻습니다.

## 앱 통로와 권한

패널이 부를 수 있는 것과 필요한 권한입니다. 권한이 없는 메서드를 부르면 `permission-missing` 이 돌아옵니다.

| 권한 | 메서드 | 하는 일 |
|---|---|---|
| (없음) | `storage.get` · `set` · `delete` | 플러그인별 JSON 값 `{ key, value }`. 전체 64KB — 설정 · 화면 상태용, 큰 캐시는 담지 않습니다 |
| (없음) | `panel.fullscreen` | `{ on }` — 오른쪽 패널을 전체 화면으로 |
| `project` | `project.info` · `readFile` · `listDir` · `findFiles` · `fileInfo` · `openFile` · `pickPath` · `changedFiles` · `openTabs` | 지금 프로젝트 안만 읽고, 파일을 앱의 미리보기로 엽니다. 경로는 프로젝트 기준 상대 경로 (`..` · 절대 경로 거절) |
| `projectWrite` | `project.writeFile` · `removeFile` | 프로젝트의 `.litecode/` 바로 아래 `.md` 만 — 팀이 커밋해 같이 쓰는 문서용 |
| `chat` | `chat.compose` · `exists` · `titles` · `open` | `{ text, send }` — 새 대화를 열어 입력창을 채우거나(`send: false`) 곧바로 보냅니다 |
| `secrets` | `secrets.get` · `set` · `delete` | 토큰 · 비밀번호를 OS 암호 저장소로 봉해 둡니다 |
| `network` | `network.fetch` · `connection` · `setConnection` | 앱(메인)이 대신 요청합니다. 처음 가는 주소는 사용자에게 묻고, 기한 15초 · 응답 5MB |
| `usage` | `usage.summary` | 토큰 사용량 숫자만 (대화 글 · 제목 없음) |
| `mcp` · `tools` | `mcp.call` · `mcp.status` · `tools.run` | 플러그인이 싣고 온 MCP 서버 · 도구 — [MCP 플러그인](mcp-plugin.md) 가이드 |

> 권한은 필요한 것만 적으세요. 설치 카드에 그대로 보이고, 업데이트에서 권한이 늘면 사용자가 다시 허락해야 합니다.

## 정리

`plugin.json` 과 인라인 HTML 하나로 패널 플러그인을 만들고, 앱 통로로 저장 · 프로젝트 읽기 · 대화 열기를 했습니다. 실제 예로는 [token-pet](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/token-pet)(`usage` · `storage` · 전체 화면)이 같은 모양입니다.

## 다음

- [MCP 플러그인 만들기](mcp-plugin.md) — AI 가 부르는 도구를 싣기
- [저장소로 내보내기](publish.md) — 메모장을 [플러그인 둘러보기] 에 올리기
