[← 가이드 목록](../README.md)

# 첫 패널 플러그인 만들기

오른쪽 패널에 탭 하나를 더하는 가장 작은 플러그인을 만듭니다. 파일은 둘, 빌드는 없습니다.

*약 15분 · 권한: project · chat*

> **방향 — 패널은 화면, 앱 기능과 상태는 서비스.** 코드를 가진 플러그인은 **서비스**(앱 안에서 도는 코드) 한 길로 가는 중이고, 패널은 서비스에 `service.call` 로 묻고 서비스가 밀어 보내는 소식으로 다시 그리는 방식이 기본이 됩니다 → [서비스 플러그인 만들기](service-plugin.md).
> 이 가이드는 **서비스 없이 패널만** 있는 가장 작은 플러그인입니다. 순수 화면(메모 · 계산기 · 뷰어)이면 이것으로 충분하고, 아래 **앱 통로**(`storage` · `project` · `chat` …)가 지금 앱에서 도는 **옛 방식 — 서비스로 옮기는 중**입니다. 병행 기간에는 둘 다 됩니다. 패널이 앱 기능이나 앱 소식을 써야 하면 처음부터 [서비스](service-plugin.md)로 만드세요.

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

패널 플러그인은 zip 하나입니다. 맨 위에 `plugin.json`(manifest)이 있고, 그것이 가리키는 **진입 HTML** 이 오른쪽 패널 탭이 됩니다.

- HTML 은 **sandbox iframe** 에서 돕니다. 바깥 스크립트 · 스타일 · 이미지 · 글꼴과 `fetch` 는 CSP 로 막힙니다.
- 같은 zip 의 스크립트 · 스타일시트 · 이미지는 진입 HTML 이 상대 경로로 적으면 앱이 읽어 넣어 줍니다 — 아래 [같은 zip 의 파일 쓰기](#같은-zip-의-파일-쓰기). 작은 패널은 한 파일에 다 넣어도 됩니다.
- 앱에 무언가를 부탁하는 길은 `parent.postMessage` 하나(**앱 통로**)입니다. 앱은 메시지가 어느 iframe 에서 왔는지로 플러그인을 알아보고, manifest 의 `permissions` 에 적힌 것만 들어 줍니다. 서비스가 있는 플러그인은 이 통로 중 `service.call` 하나로 서비스에 묻고, 앱 기능은 서비스가 대신 부릅니다 — [아래](#서비스가-있는-패널).

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
  "scope": "app",
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
| `pages` | 선택(베타). 패널 화면을 여러 장으로 — 이름 → HTML 경로. 쓰면 `litecode` 도 적습니다. 아래 [화면 여러 장](#화면-여러-장--pages-베타) |
| `scope` | `"app"`(앱 전체) · `"project"`(프로젝트별). 새 플러그인은 필수 — [먼저 정할 것](../README.md#먼저-정할-것-앱-전체용인가-프로젝트별인가). 메모장은 어느 프로젝트에서나 같으니 `app` |
| `permissions` | 선택. 아래 [권한 표](#앱-통로와-권한)의 값만 |
| `litecode` | 선택. 필요한 최소 앱 버전 — 낮은 앱은 설치를 거절합니다 |

> **모르는 필드는 설치 거절입니다.** `permisions` 같은 오타가 조용히 넘어가 권한이 빠진 채 설치되지 않게 하려는 것입니다. 메모용 필드를 manifest 에 넣지 마세요. 옛 이름 `extension.json` 도 읽지만 새 플러그인은 `plugin.json` 으로 씁니다.

## 2. 패널 HTML

이 예제는 서비스 없이 패널이 앱 통로를 직접 씁니다(옛 방식, 서비스로 옮기는 중 — 순수 패널의 첫걸음으로 남겨 둔 것입니다). 짧아서 한 파일 안에 화면 · 스타일 · 스크립트를 다 넣습니다(나누는 법은 아래 [같은 zip 의 파일 쓰기](#같은-zip-의-파일-쓰기)). 맨 위 `call()` 이 앱 통로입니다 — 요청에 번호를 붙여 보내고, 같은 번호의 답을 기다립니다.

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

## 4. 고치면서 바로 확인하기

고칠 때마다 zip 을 다시 묶지 않아도 됩니다. 앱의 **개발 모드**에 플러그인 폴더를 연결해 두면, 저장할 때마다 앱이 알아서 다시 설치합니다.

개발 모드는 아래 둘 중 하나에만 있습니다. 배포된 일반 앱에는 없습니다.

- desktop 저장소를 받아 `npm run dev` 로 띄운 앱
- 플러그인 개발자용 설치본 **litecode Plugin Dev**. desktop 저장소의 Release 작업을 수동 실행할 때 `variant` 를 `plugin-dev` 로 골라 만듭니다. 산출물은 하루만 보관되니 그 안에 받으세요. 일반 설치본과 나란히 설치됩니다.

둘 다 일반 설치본과 저장 공간이 따로라, 평소 쓰는 앱과 나란히 띄워 둘 수 있고 서로의 플러그인이 섞이지 않습니다. 대신 플러그인 설정 값(연결 정보 등)은 여기서 한 번 다시 넣어야 합니다.

1. 설정 › 기능 › 플러그인 › **개발 중** 에서 **[폴더 연결]** 을 누르고 `plugins/hello-panel/` 을 고릅니다. zip 설치와 같은 검사를 거쳐 바로 설치됩니다. 권한 확인 카드는 뜨지 않습니다.
2. `index.html` 을 고쳐 저장합니다. 폴더가 바뀌고 1초 동안 조용하면 다시 설치되고, 열려 있는 패널 탭이 새 내용으로 다시 그려집니다. 행에 "… 설치됨" 이 보입니다.
3. 검사에 걸리면 행에 "… 실패 — 앞 설치를 그대로 둡니다" 와 이유가 뜨고, 앞 내용이 그대로 남습니다. 고쳐 저장하면 다시 시도합니다.

- 검사는 zip 설치와 같습니다. 개발 모드에서 통과하면 zip 으로도 통과합니다.
- version 은 올리지 않아도 됩니다. 같은 버전으로 다시 설치해도 새 내용으로 바뀝니다. MCP 서버는 다음 호출 때 새 코드로 뜨고 도구 목록도 다시 받습니다.
- 연결한 플러그인은 목록과 패널 탭에 **DEV** 표시가 붙습니다. **[지금 다시 읽기]** 로 바로 다시 설치하고, **[연결 끊기]** 로 감시를 멈춥니다. 연결을 끊어도 플러그인은 설치된 채로 남습니다.
- 빌드가 필요한 플러그인(서비스 · MCP 서버 등)은 원본 대신 빌드한 폴더를 연결합니다 — [MCP 가이드의 8번](mcp-plugin.md#8-고치면서-바로-확인하기).

개발 모드가 없는 앱에서는 `version` 을 올리고(`0.1.1`) 3번처럼 다시 묶어 설치합니다. 설치 카드에 지금 버전이 같이 보이고 새 버전으로 바뀝니다. 저장소로 나갈 때는 버전이 높아야만 업데이트로 보이니, 올리기 전에 버전을 꼭 올리세요(표준 13번). 권한을 늘리면 앱이 사용자에게 다시 묻습니다.

## 같은 zip 의 파일 쓰기

패널이 커지면 스크립트 · 스타일 · 이미지를 따로 두어도 됩니다. iframe 은 파일을 직접 읽지 못해서, 앱이 진입 HTML 에 **직접 적힌** 참조만 설치 폴더에서 읽어 iframe 안에 넣어 줍니다.

```html
<link rel="stylesheet" href="style.css">
<img src="img/logo.png" alt="">
<script src="lib/chart.js"></script>
<script src="app.js"></script>
```

| 넣어 주는 것 | 넣지 않는 것 |
|---|---|
| `<script src>` — `type` 이 없거나 classic JS 일 때 | `<script type="module">` · 실행 중에 고르는 동적 `import()` |
| `<link rel="stylesheet" href>` | CSS 안의 `url()` · `@import` · 글꼴 |
| `<img src>` | JS 가 나중에 만드는 `<img>` · `<script>` 의 주소 |

- **경로**는 진입 HTML 이 있는 폴더 기준 상대 경로입니다. `?` · `#` 뒤는 떼고, URL 인코딩은 풉니다. 플러그인 폴더 안에 머무는 `..` 는 됩니다.
- 폴더 밖으로 나가는 `..`, 절대 경로(`/` 로 시작), 스킴(`https:` · `data:` 등), 백슬래시(`\`), 폴더 밖을 가리키는 링크는 읽지 않습니다.
- js · css 는 UTF-8 글로, 이미지(png · jpg · jpeg · gif · webp · svg · ico · bmp)는 `data:` 주소로 넣습니다.
- **상한**은 앞에서부터 64개, 하나에 4MB, 합쳐서 32MB 입니다. 넘거나 못 읽은 파일은 조용히 빠지고 패널은 그대로 열립니다. 오류 코드가 없으니, 빠진 게 의심되면 파일 이름 · 경로부터 봅니다.
- 글꼴과 CSS 배경 이미지는 넣어 주지 않습니다. 필요하면 CSS 안에 `data:` 주소로 직접 넣습니다.
- CSP 는 그대로라 바깥 주소(CDN 등)는 여전히 막힙니다(표준 7번). 라이브러리는 zip 에 담아 상대 경로로 적습니다.

## 서비스가 있는 패널

서비스를 같이 담은 플러그인에서 패널은 **화면만** 맡습니다. 상태 · 앱 기능 · 앱 소식은 서비스가 맡고, 패널은 앱 통로 중 두 가지만 씁니다.

```js
const serviceCall = (name, params) => call('service.call', { name, params })   // call() 은 위 2번의 앱 통로

await call('events.subscribe', { events: ['service.update'] })   // 서비스가 host.panel.emit('update', …) 로 밀어 보낸 소식
const snapshot = await serviceCall('state')                       // 서비스가 expose('state', …) 로 낸 메서드
```

- 답은 위와 같은 모양(`{ litecode: 1, id, ok, result }`)이고 `result` 가 서비스가 돌려준 값입니다. 서비스가 꺼져 있으면 `service-off`, 그 프로젝트에서 꺼져 있으면 `not-on`, 서비스가 던지면 `service-failed` 입니다.
- 서비스가 밀어 보낸 소식은 이름에 `service.` 가 붙고 권한은 `service` 입니다. 구독은 iframe 이 살아 있는 동안만이라 패널이 시작할 때마다 구독합니다.
- 패널은 상태를 자기 저장소에 쓰지 않습니다(서비스가 들고 있고 패널은 읽기만). 둘 다 써야 하면 키를 나눕니다.

옛 앱 통로의 일이 서비스에서는 이렇게 바뀝니다.

| 패널이 앱 통로로 하던 일 | 서비스가 있으면 |
|---|---|
| `storage.*` · `project.*` · `chat.*` · `network.*` · `settings.*` · `usage.summary` · `panel.notify` · `skills.readFile` | 서비스가 `host.call` 로 같은 이름 · 같은 권한 검사로 부르고 패널에는 `expose` 로 냅니다 |
| `events.subscribe`(앱 소식 — `usage.changed` 등) | 서비스의 `ctx.on` 이 받고, 패널이 알아야 하면 `host.panel.emit` 으로 보냅니다 |
| `mcp.call` · `mcp.status` | 서비스가 `host.call('mcp.call')` 로 **자기가 등록한** 서버를 부릅니다 — [MCP 가이드](mcp-plugin.md) |
| `panel.fullscreen` · `settings.open` | 서비스가 `host.call` 로 엽니다(그 플러그인 탭이 보이는 탭일 때만 — 아니면 `no-window`) |
| `secrets.get` | 서비스는 비밀을 읽지 못합니다. 비밀은 설정 `secret` 칸 + `${secret:}` → MCP 서버 환경 변수로만 |
| `panel.args` · `fileActions` 로 열린 파일 | 패널이 받습니다(서비스에는 받을 탭이 없어 못 부름) |
| `panel.navigate`(화면 옮기기) | 패널이 부릅니다(서비스에는 옮길 패널이 없어 못 부름) |

## 앱 통로와 권한

패널이 부를 수 있는 것과 필요한 권한입니다. **병행 기간의 옛 방식입니다 — 서비스로 옮기는 중**이고, 서비스가 있는 플러그인은 위 표대로 서비스가 대신 부릅니다. 권한이 없는 메서드를 부르면 `permission-missing` 이 돌아옵니다.

| 권한 | 메서드 | 하는 일 |
|---|---|---|
| (없음) | `storage.get` · `set` · `delete` | 플러그인별 JSON 값 `{ key, value }`. 전체 64KB — 화면 상태용, 큰 캐시는 담지 않습니다. `project` 플러그인은 프로젝트마다 따로입니다. 설정 칸 값은 여기 없으니 `settings.summary` 로 읽습니다 |
| (없음) | `panel.fullscreen` | `{ on }` — 오른쪽 패널을 전체 화면으로. 가운데 탭에서는 `panel-hidden` |
| (없음) | `panel.notify` | `{ title, body?, level? }` — 앱 알림을 띄웁니다. 아래 [알림](#알림) |
| (없음) | `panel.navigate` | `{ page }` — `pages` 에 적힌 이름의 화면으로 바꿉니다. 아래 [화면 여러 장](#화면-여러-장--pages-베타) |
| (이벤트마다) | `events.subscribe` | `{ events: [...] }` — 앱 소식을 받습니다. 이벤트마다 권한을 따로 봅니다. 아래 [앱 소식 받기](#앱-소식-받기) |
| `project` | `project.info` · `readFile` · `listDir` · `findFiles` · `fileInfo` · `openFile` · `pickPath` · `changedFiles` · `openTabs` | 지금 프로젝트 안만 읽고, 파일을 앱의 미리보기로 엽니다. 경로는 프로젝트 기준 상대 경로 (`..` · 절대 경로 거절) |
| `projectWrite` | `project.writeFile` · `removeFile` | 프로젝트의 `.litecode/` 바로 아래 `.md` 만 — 팀이 커밋해 같이 쓰는 문서용 |
| `chat` | `chat.compose` · `exists` · `titles` · `open` | `{ text, send }` — 새 대화를 열어 입력창을 채우거나(`send: false`) 곧바로 보냅니다 |
| `chat` | `chat.current` | 지금 보고 있는 대화 `{ conversationId, title }`, 없으면 `null`. 프로젝트가 없으면 `no-project` |
| `project` | `panel.args` | 파일 우클릭으로 열렸을 때 넘어온 `{ path }`, 없으면 `null` — 아래 [파일 우클릭으로 열기](#파일-우클릭으로-열기) |
| `secrets` | `secrets.get` · `set` · `delete` | 토큰 · 비밀번호를 OS 암호 저장소로 봉해 둡니다 |
| `network` | `network.fetch` · `connection` · `setConnection` | 앱(메인)이 대신 요청합니다. 처음 가는 주소는 사용자에게 묻고, 기한 15초 · 응답 5MB |
| `usage` | `usage.summary` | 토큰 사용량 숫자만 (대화 글 · 제목 없음) |
| `llm` | `llm.ask` | **서비스 전용**(패널은 못 부름). 앱의 기본 모델에 한 번 묻고 답 글 `{ text }` 를 받습니다 — [서비스 플러그인 5-1](service-plugin.md#5-1-ai-에게-한-번-묻기--llmask) |
| `mcp` · `tools` | `mcp.call` · `mcp.status` · `tools.run` | 플러그인이 싣고 온 MCP 서버 · 도구 — [MCP 플러그인](mcp-plugin.md) 가이드 |

> 권한은 필요한 것만 적으세요. 설치 카드에 그대로 보이고, 업데이트에서 권한이 늘면 사용자가 다시 허락해야 합니다.

### 알림

패널이 탭 밖의 사용자에게 알릴 일이 있으면(긴 작업이 끝남 · 실패 등) `panel.notify` 를 부릅니다. 권한은 필요 없습니다.

```js
await call('panel.notify', { title: '분석 끝', body: '느린 쿼리 3개를 찾았습니다', level: 'success' })
```

- `title` 필수, 앞뒤 빈칸을 뺀 글 1~80자 · `body` 선택, 300자까지 · `level` 은 `info`(기본) · `success` · `warning` · `error`.
- 앱이 그리는 토스트(플러그인 이름 + 제목 + 본문)로 뜨고, 누르면 그 플러그인 탭이 열립니다. 설정 › 기능의 "알림" 이 꺼져 있으면 뜨지 않습니다.
- 성공하면 결과는 `null` 입니다. 모양이 틀리면 `params-invalid`, 플러그인 하나가 60초에 5개를 넘기면 `notify-limit` 이 돌아옵니다. 진행률처럼 자주 바뀌는 것은 패널 안에 그리고, 알림은 끝난 일에만 씁니다.

### 앱 소식 받기

패널이 계속 물어보지 않아도(폴링) 앱에서 일이 생기면 알려 받을 수 있습니다. (서비스가 있으면 앱 소식은 서비스가 `ctx.on` 으로 받고 패널은 서비스가 밀어 보내는 `service.<이름>` 소식만 구독하는 것이 기본입니다.) `events.subscribe` 로 받을 이벤트를 고르면, 답장과 같은 길로 `{ litecode: 1, event, data }` 가 옵니다. 답장과 달리 `id` 가 없습니다.

```js
addEventListener('message', ({ data }) => {
  if (data?.litecode !== 1 || !data.event) return          // 답장(id 있음)은 call() 이 받는다
  if (data.event === 'usage.changed') refreshUsage()        // 숫자는 usage.summary 로 다시 읽는다
  if (data.event === 'project.filesChanged') reload(data.data.paths)
})
await call('events.subscribe', { events: ['usage.changed', 'project.filesChanged'] })
```

| 이벤트 | 필요한 권한 | `data` | 언제 · 어느 탭에 |
|---|---|---|---|
| `chat.turnEnded` | `chat` | `{ conversationId, outcome }` — `done` · `failed` · `interrupted` | 그 프로젝트의 대화에서 AI 턴이 끝날 때, 그 프로젝트의 탭에만 |
| `project.filesChanged` | `project` | `{ paths, truncated? }` — 프로젝트 기준 상대 경로, 정렬, 최대 200개 | **AI 의 write · edit 도구가 쓴 파일만**, 0.5초씩 모아서. 셸 · 외부 편집기 · git 으로 바뀐 것은 아직 안 잡습니다 |
| `project.openTabsChanged` | `project` | `{ paths }` | 오른쪽 패널에 연 파일 탭 목록이 바뀔 때만 |
| `usage.changed` | `usage` | `{}` — 숫자는 `usage.summary` 로 읽습니다 | 사용량이 늘 때, 모든 탭에 |
| `settings.saved` | (없음) | `{}` | 이 플러그인의 설정 값을 저장할 때, 그 플러그인 탭에만. 설치 때 넣은 값으로는 오지 않습니다 |
| `chat.currentChanged` | `chat` | `{ current: { conversationId, title } \| null }` | 보고 있는 대화가 바뀌거나 그 제목이 바뀔 때 |
| `panel.args` | `project` | `{ path }` | 이미 열린 이 플러그인 탭이 파일 우클릭으로 다시 불렸을 때 |

- 부를 때마다 목록 **전체를 바꿉니다**. 빈 배열이면 그만 받습니다. 결과는 `{ events: [...] }` 입니다.
- 하나라도 틀리면 전체를 거절하고 기존 목록을 그대로 둡니다. 모양이 틀리면 `params-invalid`, 모르는 이름이면 `event-unknown`, 권한이 없으면 `permission-missing` 입니다.
- 구독은 iframe 이 살아 있는 동안만입니다. 탭을 다시 열거나 다시 설치(개발 모드 포함)로 진입 HTML 을 다시 읽으면 목록이 비니, 패널이 시작할 때마다 구독합니다.
- 대화 글과 파일 내용은 싣지 않습니다. 필요하면 받은 경로로 `project.readFile` 을 부릅니다.

## 화면 여러 장 — pages (베타)

패널은 지금까지처럼 HTML 한 장(`entry`)으로 만들어도 됩니다. 화면이 여러 개 필요하면 `plugin.json` 에 `pages` 를 더합니다. **`pages` 를 적지 않으면 아무것도 달라지지 않습니다** — 한 장짜리 플러그인은 새 앱에서도 그대로 돕니다.

```json
{
  "litecode": "<이 기능이 들어간 앱 버전>",
  "entry": "index.html",
  "pages": { "home": "index.html", "settings": "ui/settings.html", "detail": "ui/detail.html" }
}
```

- `pages` 는 `이름 → manifest 기준 HTML 경로(.html · .htm)` 입니다. `entry` 는 그대로 필수이고 **첫 화면**입니다. 첫 화면으로 돌아오고 싶으면 위의 `home` 처럼 `entry` 도 이름을 붙여 적습니다.
- 이름은 글자로 시작하는 64자 안(글자 · 숫자 · `_` · `.` · `-`)이고, 화면은 **8개까지**, 장마다 **2MB 까지**입니다. 같은 폴더의 스크립트 · 스타일 · 이미지(`<script src>` 등)는 장마다 따로 읽고, 자산 한도(64개 · 하나 4MB · 합 32MB)도 장마다 따로 적용됩니다.
- 패널이 화면을 옮기려면 앱 통로로 `panel.navigate` 를 보냅니다. 권한은 필요 없고, 응답은 다른 호출과 같습니다.

  ```js
  await call('panel.navigate', { page: 'settings' })   // call() 은 위 앱 통로
  ```

  `<a href="settings.html">` 같은 링크는 이동하지 않고 막힙니다.
- **파일 경로를 줄 수 없습니다.** 패널은 `pages` 에 적힌 **이름**만 고릅니다. 목록에 없는 이름(경로를 적어도)은 `page-unknown`, `params` 모양이 틀리면 `params-invalid` 로 거절됩니다. 경로는 앱이 `plugin.json` 에서 꺼내 읽습니다.
- **화면을 옮기면 새 문서가 열립니다.** 패널 안의 변수 · 입력 중인 값 · 스크롤 · 타이머는 사라지고, `events.subscribe` 로 받던 소식은 새 화면에서 **다시 구독**해야 합니다. `panel.args` 와 전체 화면 상태는 유지됩니다.
- **화면 사이에 넘길 값은 서비스(`service.call`)에 맡깁니다.** 패널은 격리된 상자 안이라 `sessionStorage` 를 쓸 수 없다고 보세요. 옮기면서 값을 넘기는 `params` 는 아직 없습니다.
- 앱 쪽 뒤로가기나 화면 목록은 아직 없습니다. 돌아가는 길은 패널이 직접 만듭니다(`panel.navigate` 로 `home` 같은 이름을 다시 부릅니다).
- **`pages` 를 쓰면 `litecode` 를 적습니다.** `pages` 를 모르는 옛 앱은 이 필드를 모르는 필드로 보고 설치를 거절합니다. 최상위 `litecode` 에 이 기능이 들어간 앱 최소 버전을 적으면 옛 앱은 "모르는 필드" 대신 "앱 버전이 낮다" 로 거절합니다.
- 설치할 때 `pages` 에 적은 파일이 zip 에 있고 `.html` 인지 봅니다(`page-missing` · `page-not-html` · `pages-invalid`). 서비스는 `panel.navigate` 를 부를 수 없습니다(옮길 패널이 없습니다).

## 가운데 탭에 두기

패널은 기본으로 오른쪽 패널의 `+` 메뉴에서 엽니다. 화면이 넓어야 하는 플러그인(보드 · 표 · 편집기)은 manifest 에 `"placement": "center"` 를 적어 **가운데 탭**에 둘 수 있습니다.

```json
"entry": "index.html",
"placement": "center"
```

- 값은 `"center"` 만 됩니다. 패널(`entry`)이 있는 플러그인만 쓸 수 있고, 언어 팩 · 문법 팩에는 쓸 수 없습니다. 어기면 설치 때 `placement-invalid` 로 거절됩니다.
- 가운데 탭 줄은 대화 / (추론 과정) / 가운데 플러그인들 순서입니다. 플러그인은 이름 순(같으면 id 순)이고, 그 프로젝트에서 켜진 것만 나옵니다. 긴 이름은 줄여 보이고, 마우스를 올리면 전체 이름이 보입니다.
- 가운데 플러그인은 오른쪽 패널의 `+` 메뉴에 나오지 않습니다.
- 그 탭을 고를 때만 화면을 그립니다. 다른 탭에 갔다 오면 iframe 을 새로 읽으니, 상태는 `storage` 에 두고 이벤트는 시작할 때마다 다시 구독합니다.
- 격리(iframe · CSP)와 앱 통로는 오른쪽 패널과 같습니다. 다만 `panel.fullscreen` 은 `panel-hidden` 이 돌아옵니다(이미 넓은 자리라서).
- 알림(`panel.notify`)을 누르거나 파일 우클릭(`fileActions`)으로 고르면 가운데 탭이 선택됩니다.
- 대화와 같이 쓰는 패널이면 `chat.current` 로 지금 대화를 읽고, `chat.currentChanged` 를 구독해 대화가 바뀌는 것을 따라갑니다.

## 파일 우클릭으로 열기

파일 트리와 파일 탭의 우클릭 메뉴에 "이 플러그인으로 열기" 항목을 더할 수 있습니다. `.sql` 을 SQL 튜닝 패널로 여는 식입니다.

```json
"permissions": ["project"],
"fileActions": [{ "label": "SQL 튜닝으로 열기", "match": ["*.sql", "*Mapper.xml"] }]
```

- 오른쪽 패널(`entry`)이 있고 `project` 권한이 있는 플러그인만 쓸 수 있습니다. 항목은 3개까지, `label` 은 1~40자(앞뒤 빈칸은 다듬음), `match` 는 1~10개(패턴 하나 64자)이고, 항목에는 `label` · `match` 만 둡니다.
- 패턴은 경로가 아니라 **파일 이름**에 맞춥니다. `/` · `\` 는 쓸 수 없고 `*` · `?` 만 특별한 뜻이 있으며, 대소문자는 가리지 않습니다.
- 어기면 설치 때 `file-actions-invalid` 로 거절됩니다(`params.field` 가 `shape` · `label` · `match` · `entry` · `permission` 중 하나). 가운데 탭 플러그인(`placement: "center"`)도 쓸 수 있습니다.
- 메뉴에는 그 프로젝트에서 켜진 플러그인만 나옵니다. 맞는 항목이 3개까지면 "플러그인" 소제목 아래 바로, 4개부터는 앞의 2개와 "다른 플러그인으로 열기" 로 묶입니다. 파일 탭 메뉴는 프로젝트 안 파일만 해당합니다.
- 고르면 그 플러그인의 탭을 엽니다. 오른쪽 패널 플러그인은 오른쪽 패널 탭을(이미 열려 있으면 그 탭으로), 가운데 탭 플러그인은 그 가운데 탭을 고릅니다. 넘어온 파일은 어느 쪽이든 같은 두 길로 받습니다.

```js
// 막 열린 패널 — 시작할 때 한 번 읽는다
const args = await call('panel.args')            // { path } 또는 null
if (args) open(args.path)
// 이미 열린 탭 — 이벤트로 받는다
addEventListener('message', ({ data }) => { if (data?.litecode === 1 && data.event === 'panel.args') open(data.data.path) })
await call('events.subscribe', { events: ['panel.args'] })
```

- `path` 는 프로젝트 기준 상대 경로(`/` 구분)입니다. 내용은 넘어오지 않으니 `project.readFile` 로 읽습니다.

## 정리

`plugin.json` 과 HTML 하나로 패널 플러그인을 만들고, 앱 통로로 저장 · 프로젝트 읽기 · 대화 열기를 했습니다. 순수 화면은 이것으로 충분합니다. 앱 기능 · 상태 · 앱 소식이 필요하면 패널은 화면만 맡고 나머지는 서비스로 옮깁니다 — 실제 예는 [token-pet](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/token-pet)(서비스가 먹이를 쌓고 패널은 `service.call` · `service.update` 로 그립니다)입니다.

## 다음

- [서비스 플러그인 만들기](service-plugin.md) — 앱 소식 · 상태 · AI 도구를 서비스로
- [MCP 플러그인 만들기](mcp-plugin.md) — 오래 걸리는 일 · 비밀을 별도 프로세스로
- [저장소로 내보내기](publish.md) — 메모장을 [플러그인 둘러보기] 에 올리기
