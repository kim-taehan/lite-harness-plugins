[← 가이드 목록](../README.md)

# MCP 플러그인 만들기

AI 가 대화 중에 부르는 도구를 MCP 서버로 싣습니다. 설치 때 받는 설정 칸, [연결 확인], 같이 설치되는 스킬, 그리고 한 파일로 묶는 빌드까지.

*약 30분 · 권한: mcp · 빌드: build.mjs*

## 만들 것

**인사 도구** 플러그인 `hello-mcp` 를 만듭니다.

- AI 가 부를 수 있는 도구 `greet` — 이름을 받아, 설치 때 정한 인사말로 인사합니다.
- 설치 2단계에 **설정 폼**(인사말 · 말투)이 뜨고, **[연결 확인]** 이 값이 제대로 들어갔는지 보여 줍니다.
- 같이 설치되는 **스킬**이 "인사해 줘" 같은 말에 AI 가 이 도구를 쓰도록 이끕니다.

패널은 없습니다 — `entry` 를 빼면 `+` 메뉴에 나오지 않는 도구 전용 플러그인이 됩니다. 패널을 같이 두는 법은 [끝에서](#패널을-같이-두려면) 다룹니다.

## 준비물

- [첫 패널 플러그인](first-panel.md)을 읽었으면 좋습니다 (manifest 규칙 · zip 설치)
- Node.js 22+ 와 이 저장소 (`git clone` 후 `npm ci` — esbuild · MCP SDK 가 버전 고정으로 들어 있습니다)
- [MCP](https://modelcontextprotocol.io) 의 도구(tools/list · tools/call) 개념

## 앱이 MCP 서버를 다루는 법

- AI 가 그 플러그인 도구를 **처음 부를 때** 앱이 `mcp.command` 를 띄워 stdio 로 MCP 를 주고받고, 한동안(`idleMs`, 기본 10분) 부르지 않으면 내립니다.
- `.mjs` · `.js` 는 **앱 자신의 Node** 로 돕니다. 사용자 PC 에 Node 가 없어도 되지만, `node_modules` 도 없으니 의존성은 한 파일로 묶어 싣습니다 — 그래서 `build.mjs` 가 필요합니다.
- 작업 폴더는 도구를 부른 **프로젝트 폴더**이고, 프로젝트마다 서버가 하나씩 뜹니다.
- 도구 목록은 서버에 묻고(tools/list) **플러그인 버전마다 한 번** 기억합니다. 도구를 더하거나 바꾸면 버전을 올리세요.
- AI 에게는 `litecode_<플러그인 id>_<도구>` 이름으로 보입니다 — 여기선 `litecode_hello-mcp_greet`.
- AI 에 붙는 플러그인(mcp · skills · tools)은 설치할 때 **범위**를 고릅니다: 모든 프로젝트, 또는 이 프로젝트(`<프로젝트>/.litecode/settings.json` 의 `plugins` 에 적혀 커밋하면 팀이 같이 씁니다).

## 1. 폴더 구조

`plugins/hello-mcp/`

```
plugin.json              manifest
server/index.mjs         MCP 서버 원본 (빌드가 server/hello-mcp.mjs 한 파일로 묶는다)
skills/hello-mcp/SKILL.md  같이 설치되는 스킬
build.mjs                묶기 — build/hello-mcp.zip 을 만든다 (--dir 이면 build/hello-mcp/ 폴더)
```

## 2. plugin.json

`plugins/hello-mcp/plugin.json`

```json
{
  "id": "hello-mcp",
  "name": "인사 도구",
  "description": "AI 가 정해 둔 인사말로 인사하는 예제 MCP 플러그인",
  "details": "설치할 때 인사말과 말투를 넣고 [연결 확인] 으로 값을 봅니다.\n대화에서 \"홍길동에게 인사해 줘\" 라고 하면 AI 가 greet 도구를 씁니다.",
  "version": "0.1.0",
  "permissions": ["mcp"],
  "settings": [
    { "key": "greeting", "label": "인사말", "type": "text", "required": true },
    { "key": "tone", "label": "말투", "type": "select", "options": ["존댓말", "반말"] }
  ],
  "settingsCheck": "status",
  "mcp": {
    "command": "server/hello-mcp.mjs",
    "env": {
      "HELLO_GREETING": "${storage:greeting}",
      "HELLO_TONE": "${storage:tone}"
    }
  },
  "skills": ["skills/hello-mcp"]
}
```

| 필드 | 규칙 |
|---|---|
| `mcp` | `mcp` 권한과 **같이만** — 한쪽만 있으면 거절. `command` 는 zip 안의 실행 파일(빌드 결과 경로) |
| `mcp.env` | 자리표시 `${storage:<키>}` · `${secret:<키>}` · `${extensionDir}` · `${dataDir}`. 값이 바뀌면 다음 호출에 새 값으로 서버를 다시 띄웁니다 |
| `mcp.args` | `${extensionDir}` · `${dataDir}` 만 — 비밀 값은 프로세스 목록에 보이는 args 에 넣지 않습니다 |
| `mcp.idleMs` · `timeoutMs` | 쉬면 내리는 시간(기본 10분) · 호출 한 번의 기한(기본 5분) |
| `mcp.panelTools` | AI 목록에 올리지 않고 패널의 `mcp.call` 로만 부르는 도구 |
| `settings` | 칸 종류 `text` · `number` · `select`(`options` 필수) · `secret`. 일반 값은 `${storage:키}`, secret 은 이 기기에 암호화돼 `${secret:키}` 로만 나갑니다 |
| `settingsCheck` | [연결 확인] 에 부를 도구 이름. `mcp` 선언이 있어야 하고, AI 에게는 보이지 않습니다 |
| `settingsPer` | `"project"` 면 설정 값을 늘 프로젝트마다 따로 둡니다 (DB 연결처럼 프로젝트마다 다른 값) |
| `skills` | 스킬 폴더 경로 목록. 폴더 이름(소문자 · 숫자 · `-`)이 스킬 이름이고 그 안에 `SKILL.md` |

## 3. MCP 서버

저장소의 다른 플러그인(sql-tuning · ui-test)과 같은 SDK 저수준 `Server` 로 씁니다. 도구 둘 — AI 가 쓰는 `greet`, [연결 확인] 용 `status`.

`plugins/hello-mcp/server/index.mjs`

```js
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const greeting = process.env.HELLO_GREETING ?? ''
const casual = process.env.HELLO_TONE === '반말'

const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError && { isError }) })

const server = new Server({ name: 'hello-mcp', version: '0.1.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'greet',
      description: 'Greet a person by name with the greeting configured for this project.',
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Who to greet' } }, required: ['name'] },
    },
    {
      name: 'status',
      description: 'Show the configured greeting (used by the settings check).',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (greeting === '') return text('인사말이 비어 있습니다 — 설정 › 기능 › 플러그인 › 인사 도구 › [고치기]', true)
  if (params.name === 'status') return text(`인사말: ${greeting} · 말투: ${casual ? '반말' : '존댓말'}`)
  if (params.name === 'greet') {
    const who = String(params.arguments?.name ?? '').trim()
    if (who === '') return text('name 이 필요합니다', true)
    const project = path.basename(process.cwd())
    return text(`${greeting}, ${who}${casual ? '!' : '님!'} (${project} 에서)`)
  }
  return text(`모르는 도구: ${params.name}`, true)
})

await server.connect(new StdioServerTransport())
```

> 도구 설명(`description`)은 모델이 읽는 글이라 **영어**로 씁니다. 사용자에게 보이는 결과 글은 한국어여도 됩니다. stdout 은 MCP 통신 자리이니 로그는 `console.error`(stderr)로 남기세요.

## 4. 스킬

스킬은 플러그인이 켜져 있는 동안 앱 스킬로 보입니다. 언제 어떤 도구를 쓰는지, 도구가 없을 때 어떻게 할지를 적습니다.

`plugins/hello-mcp/skills/hello-mcp/SKILL.md`

```md
---
name: hello-mcp
description: Greet people with the hello-mcp plugin's greet tool. Use when the user asks to greet someone ("홍길동에게 인사해 줘").
---

# Greeting

Call **`litecode_hello-mcp_greet`** with the person's name and show its result as is.

If the tool is not available in this conversation, stop and tell the user:
"인사 도구가 이 대화에 붙지 않았습니다 — 설정 › 기능 › 플러그인에서 인사 도구가 이 프로젝트에 켜져 있는지 확인해 주세요."
Do not imitate the tool.
```

## 5. build.mjs 로 묶기

esbuild 로 서버를 SDK 째 한 파일로 묶고, manifest · 스킬과 함께 zip 을 만듭니다. `npm run release hello-mcp` 는 이 파일을 먼저 돌리고 나온 `build/hello-mcp.zip` 을 그대로 올립니다.

`--dir` 을 주면 zip 대신 같은 내용을 `build/hello-mcp/` 폴더로 냅니다. 원본 폴더는 묶기 전이라 앱이 그대로 띄울 수 없어서, 앱의 개발 모드에서는 이 폴더를 연결합니다([7. 고치면서 바로 확인하기](#7-고치면서-바로-확인하기)). MCP 서버가 있는 플러그인의 build.mjs 는 `--dir` 을 꼭 받아야 합니다(표준 17번).

`plugins/hello-mcp/build.mjs`

```js
// `node plugins/hello-mcp/build.mjs [--dir]` → build/hello-mcp.zip (--dir 이면 같은 내용을 build/hello-mcp/ 폴더로)
// 서버(server/index.mjs)를 MCP SDK 째 server/hello-mcp.mjs 한 파일로 묶는다. zip 에는 plugin.json · server/hello-mcp.mjs · skills/
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), 'hello-mcp-'))
await build({
  entryPoints: [path.join(here, 'server/index.mjs')],
  outfile: path.join(stage, 'server/hello-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
for (const name of ['plugin.json', 'skills']) cpSync(path.join(here, name), path.join(stage, name), { recursive: true })
const out = path.join(root, 'build', process.argv.includes('--dir') ? 'hello-mcp' : 'hello-mcp.zip')
mkdirSync(path.dirname(out), { recursive: true })
rmSync(out, { recursive: true, force: true })
if (process.argv.includes('--dir')) cpSync(stage, out, { recursive: true, verbatimSymlinks: true })
else execFileSync('zip', ['-qry', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log(`✓ ${path.relative(root, out)}`)
```

터미널 (저장소 맨 위에서)

```sh
npm ci                                      # 처음 한 번
node plugins/hello-mcp/build.mjs            # → build/hello-mcp.zip
node plugins/hello-mcp/build.mjs --dir      # → build/hello-mcp/ (개발 모드에서 연결할 폴더)
```

묶기 전에 서버만 따로 확인하려면 MCP Inspector 로 띄워 봅니다: `HELLO_GREETING=안녕 npx @modelcontextprotocol/inspector node plugins/hello-mcp/server/index.mjs` (망 밖 PC 에서).

## 6. 설치하고 써 보기

1. **설정 › 기능 › 플러그인 › [플러그인 추가 (zip)]** 으로 `build/hello-mcp.zip` 을 고릅니다.
2. 범위를 고릅니다 — 써 보는 중이면 **이 프로젝트**.
3. 설정 폼에 인사말(예: `반갑습니다`)과 말투를 넣고 **[연결 확인]** — `status` 의 결과 글이 그대로 보입니다.
4. 새 대화에서 "홍길동에게 인사해 줘" — AI 가 스킬을 따라 `litecode_hello-mcp_greet` 를 부르는지 봅니다.

값은 나중에 플러그인 카드의 **[고치기]** 로 바꿉니다. 바꾸면 다음 호출에서 서버가 새 env 로 다시 뜹니다.

## 7. 고치면서 바로 확인하기

6번처럼 고칠 때마다 version 을 올려 zip 으로 다시 설치하지 않아도 됩니다. 앱의 **개발 모드**에 폴더를 연결해 두면, 폴더가 바뀔 때마다 zip 설치와 같은 검사를 거쳐 다시 설치하고, 서버를 내리고 도구 목록을 새로 묻습니다. 개발 모드가 어떻게 도는지는 [패널 가이드의 4번](first-panel.md#4-고치면서-바로-확인하기)에 있습니다.

MCP 플러그인은 원본 폴더를 앱이 그대로 띄울 수 없으니, 원본 대신 **빌드한 폴더**를 연결합니다.

1. `node plugins/hello-mcp/build.mjs --dir` 로 `build/hello-mcp/` 를 만듭니다.
2. 설정 › 기능 › 플러그인 › **개발 중 › [폴더 연결]** 에서 `build/hello-mcp/` 를 고릅니다. `plugins/hello-mcp/` 원본 폴더가 아닙니다.
3. 원본을 고칠 때마다 1번 명령을 다시 돌립니다. 앱이 바뀐 폴더를 보고 다시 설치하고, 행에 "… 설치됨" 이 보입니다.

개발 실행은 설치본과 저장 공간이 따로라, 설정 폼 값(연결 정보 · 비밀 값)은 개발 실행에서 한 번 다시 넣어야 합니다.

## 패널을 같이 두려면

`entry` 를 더하고 zip 에 `index.html` 을 넣으면(build.mjs 의 복사 목록에 추가) 같은 플러그인이 패널도 가집니다. 패널은 앱 통로로 자기 서버를 부를 수 있습니다.

`index.html 안에서`

```html
const result = await call('mcp.call', { tool: 'status', args: {} })   // 서버의 도구 결과
const summary = await call('settings.summary')   // 지금 설정 값 (secret 값은 빼고)
await call('settings.open')                       // 설정 폼 띄우기
await call('settings.check')                      // [연결 확인] 과 같은 결과
```

진행률 · 멈추기처럼 패널만 쓰는 도구는 `mcp.panelTools` 에 적어 AI 목록에서 뺍니다. 실제 예: [ui-test](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/ui-test) (`progress` · `stop` · `shot`).

## 정리

MCP 서버 · 설정 칸 · [연결 확인] · 스킬을 담은 플러그인을 만들고, 앱의 Node 로 돌도록 한 파일로 묶었습니다. 더 큰 예는 [sql-tuning](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/sql-tuning)(DB 드라이버를 같이 묶음, `settingsPer: "project"`, secret 칸)과 [ui-test](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/ui-test)(묶이지 않는 패키지를 `server/node_modules` 로 옆에 싣기)입니다.

## 다음

- [저장소로 내보내기](publish.md) — build.mjs 가 있는 플러그인 올리기
- [언어 팩 · 문법 팩](locale-grammar.md) — 코드 없는 플러그인
