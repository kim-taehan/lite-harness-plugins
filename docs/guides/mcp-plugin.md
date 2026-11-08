[← 가이드 목록](../README.md)

# MCP 플러그인 만들기

오래 걸리는 일 · 비밀 · 네이티브 드라이버는 **별도 프로세스 MCP 서버**로 돌리고, 서비스가 그 서버를 앱에 등록합니다. 설치 때 받는 설정 칸, [연결 확인], 같이 설치되는 스킬, 그리고 한 파일로 묶는 빌드까지.

*약 30분 · 권한: service · 빌드: build.mjs*

## 언제 MCP 서버인가

코드를 가진 플러그인은 **서비스**(앱 안에서 도는 코드)가 기본입니다. 그런데 서비스는 앱과 같은 프로세스에서 같은 권한으로 돌아서, 아래 일은 서비스에 넣지 않고 서비스가 **별도 프로세스로 띄운 MCP 서버**에 맡깁니다.

| 이런 일이면 | 이유 |
|---|---|
| 오래 걸리는 일 (DB 쿼리 · 브라우저 조작 · 큰 분석) | 서비스에서 동기로 오래 돌면 앱 전체가 멈춥니다. 서버가 멈추는 것은 그 서버만입니다 |
| 비밀을 쓰는 일 (DB 비밀번호 · 토큰) | 서비스는 비밀을 **읽지 못합니다.** 비밀은 서버의 환경 변수로만 갑니다 |
| 네이티브 드라이버 · 큰 라이브러리 (oracle · playwright …) | 서비스 번들은 4MB 이하 한 파일이고, 되올림마다 메모리가 남습니다 |
| AI 에 가벼운 도구 몇 개 | MCP 서버가 필요 없습니다 — 서비스의 `host.tools.register` ([서비스 가이드의 7번](service-plugin.md#7-ai-도구--hosttools-와-hostmcp)) |

서비스 자체(소식 받기 · 상태 · 패널과 말하기)는 [서비스 플러그인 만들기](service-plugin.md)에 있습니다. 이 가이드는 **서버를 등록하고 쓰는 쪽**을 다룹니다.

## 만들 것

**인사 도구** 플러그인 `hello-mcp` 를 만듭니다.

- AI 가 부를 수 있는 도구 `greet` — 이름을 받아, 설치 때 정한 인사말로 인사합니다.
- 설치 뒤 **설정 폼**(인사말 · 말투)과 **[연결 확인]** 이 값이 제대로 들어갔는지 보여 줍니다.
- 같이 설치되는 **스킬**이 "인사해 줘" 같은 말에 AI 가 이 도구를 쓰도록 이끕니다.
- 서비스가 MCP 서버를 앱에 등록합니다.

패널은 없습니다 — `entry` 를 빼면 `+` 메뉴에 나오지 않는 도구 전용 플러그인이 됩니다. 패널을 같이 두는 법은 [끝에서](#서비스와-패널이-서버를-쓰는-법) 다룹니다.

## 준비물

- [서비스 플러그인](service-plugin.md)과 [첫 패널 플러그인](first-panel.md)을 읽었으면 좋습니다 (manifest 규칙 · zip 설치)
- Node.js 22+ 와 이 저장소 (`git clone` 후 `npm ci` — esbuild · MCP SDK 가 버전 고정으로 들어 있습니다)
- [MCP](https://modelcontextprotocol.io) 의 도구(tools/list · tools/call) 개념

## 앱이 MCP 서버를 다루는 법

- 서비스가 `host.mcp.register` 를 부르면, AI 가 그 플러그인 도구를 **처음 부를 때** 앱이 `command` 를 띄워 stdio 로 MCP 를 주고받고, 한동안(`idleMs`, 기본 10분) 부르지 않으면 내립니다. 서비스가 내려가면 서버 선언도 걷힙니다.
- `.mjs` · `.js` 는 **앱 자신의 Node** 로 돕니다. 사용자 PC 에 Node 가 없어도 되지만, `node_modules` 도 없으니 의존성은 한 파일로 묶어 싣습니다 — 그래서 `build.mjs` 가 필요합니다(표준 11번).
- 작업 폴더는 도구를 부른 **프로젝트 폴더**이고, 프로젝트마다 서버가 하나씩 뜹니다. 플러그인에 서버는 하나입니다.
- 도구 목록은 서버에 묻고(tools/list) **플러그인 버전마다 한 번** 기억합니다. 도구를 더하거나 바꾸면 버전을 올리세요(표준 13번).
- AI 에게는 기본으로 `litecode_<플러그인 id>_<도구>` 이름으로 보입니다 — 여기선 `litecode_hello-mcp_greet`. 별도 서버로 붙이면(`attach: "server"`) `hello-mcp_greet` 입니다 — 아래 [엔진에 붙이는 방식 고르기](#엔진에-붙이는-방식-고르기).
- 서비스가 서버를 올리는 데는 **`service` 권한만** 있으면 됩니다. manifest 의 `mcp` 선언도 `mcp` 권한도 필요 없습니다.
- 켜지는 곳은 `scope` 로 정합니다. 이 예제는 프로젝트마다 인사말을 다르게 둘 수 있게 `"project"` — 설치할 때 모든 프로젝트, 또는 이 프로젝트만(`<프로젝트>/.litecode/settings.local.json` 에 적히고 git 에서 처음부터 빠집니다 — 내 PC 에만)을 고릅니다. 앱 전체에서 늘 켜 둘 도구면 `"app"`. 프로젝트별 플러그인의 주의점은 [플러그인 구조 · 적용 범위](../architecture.md#적용-범위).

## 1. 폴더 구조

`plugins/hello-mcp/`

```
plugin.json              manifest
service/index.mjs        서비스 원본 — MCP 서버를 등록한다 (빌드가 service.mjs 한 파일로 묶는다)
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
  "details": "설치한 뒤 인사말과 말투를 넣고 [연결 확인] 으로 값을 봅니다.\n대화에서 \"홍길동에게 인사해 줘\" 라고 하면 AI 가 greet 도구를 씁니다.",
  "version": "0.1.0",
  "scope": "project",
  "permissions": ["service"],
  "settings": [
    { "key": "greeting", "label": "인사말", "type": "text", "required": true },
    { "key": "tone", "label": "말투", "type": "select", "options": ["존댓말", "반말"] }
  ],
  "settingsCheck": "status",
  "service": { "main": "service.mjs", "api": 1 },
  "skills": ["skills/hello-mcp"]
}
```

| 필드 | 규칙 |
|---|---|
| `service` · `permissions` | `service` 선언과 `service` 권한은 같이만. `main` 은 zip 안의 `.mjs` 한 파일 |
| `settings` | 칸 종류 `text` · `number` · `select`(`options` 필수) · `secret`. 일반 값은 `${storage:키}`, `secret` 은 이 기기에 암호화돼 `${secret:키}` 로만 나갑니다 |
| `settingsCheck` | [연결 확인] 에 부를 도구 이름. `service` 선언이 있으면 manifest `mcp` 없이도 쓸 수 있고, AI 에게는 보이지 않습니다 |
| `settingsPer` | `"project"` 면 설정 값을 늘 프로젝트마다 따로 둡니다 (DB 연결처럼 프로젝트마다 다른 값) |
| `skills` | 스킬 폴더 경로 목록. 폴더 이름(소문자 · 숫자 · `-`)이 스킬 이름이고 그 안에 `SKILL.md` |
| `agents` | 서브에이전트 `.md` 파일 경로 목록(최대 20개) — 아래 [에이전트를 같이 싣기](#에이전트를-같이-싣기) |

서버의 환경 변수 · 실행 파일 · 기한은 manifest 가 아니라 **서비스 코드**(다음 번)에서 적습니다.

## 3. 서비스 — 서버 등록

서비스는 서버를 `host.mcp.register` 로 올립니다. 모양은 옛 manifest `mcp` 와 같습니다.

`plugins/hello-mcp/service/index.mjs`

```js
export default (host) =>
  class HelloMcp extends host.Service {
    constructor(ctx) {
      super(ctx)
      host.mcp.register({
        command: 'server/hello-mcp.mjs',
        env: {
          HELLO_GREETING: '${storage:greeting}',
          HELLO_TONE: '${storage:tone}',
        },
      })
    }
  }
```

| 필드 | 규칙 |
|---|---|
| `command` | 설치 폴더 기준 실행 파일(빌드 결과 경로) |
| `args` | `${extensionDir}` · `${dataDir}` · `${projectDataDir}`(프로젝트별 자료 폴더) 만 — 비밀 값은 프로세스 목록에 보이는 args 에 넣지 않습니다 |
| `env` | 위 자리표시에 `${storage:<키>}` · `${secret:<키>}`. 설정 칸에 선언된 키면 설정 값을, 아니면 패널 저장 칸 값을 넣습니다. 값이 바뀌면 다음 호출에 새 값으로 서버를 다시 띄웁니다 |
| `idleMs` · `timeoutMs` | 쉬면 내리는 시간(기본 10분) · 호출 한 번의 기한(기본 5분) |
| `panelTools` | AI 목록에 올리지 않고 패널(서비스)만 부르는 도구 |
| `attach` | `"litecode"`(기본) · `"server"` — 아래 [엔진에 붙이는 방식 고르기](#엔진에-붙이는-방식-고르기) |

**비밀 값**은 서비스가 읽지 않습니다 — `host.call('secrets.get')` 은 서비스에서 `method-unknown` 입니다. 비밀을 쓰는 유일한 길은 `settings` 에 `type: "secret"` 칸을 선언하고 서버 `env` 에 `${secret:키}` 를 적어 자식 프로세스에만 넘기는 것입니다. sql-tuning 의 DB 비밀번호가 이 모양입니다.

`plugins/sql-tuning/plugin.json` · `service/index.mjs` (발췌 — 서비스 이전 PR 기준)

```json
{ "key": "password", "label": "비밀번호", "type": "secret" }
```

```js
host.mcp.register({
  command: 'server/sql-tuning.mjs',
  env: {
    SQL_TUNING_HOST: '${storage:host}',
    SQL_TUNING_USER: '${storage:user}',
    SQL_TUNING_PASSWORD: '${secret:password}',
    SQL_TUNING_POOL: '4',
  },
  idleMs: 600000,
})
```

서버 `env` 의 `${secret:}` 키와 `secret` 설정 칸의 키는 패널에서도 `secrets.get` 으로 읽지 못합니다(`secret-write-only`). 같은 이름의 키를 패널이 읽던 코드가 있으면 이 방식으로 옮기면서 깨질 수 있고, 그것이 의도입니다.

## 4. MCP 서버

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

## 5. 스킬

스킬은 플러그인이 켜져 있는 동안 앱 스킬로 보입니다. 언제 어떤 도구를 쓰는지, 도구가 없을 때 어떻게 할지를 적습니다. 도구 이름은 [붙이는 방식](#엔진에-붙이는-방식-고르기)에 맞게 적습니다.

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

## 6. build.mjs 로 묶기

esbuild 로 서비스와 서버를 각각 한 파일로 묶고(서버는 SDK 째), manifest · 스킬과 함께 zip 을 만듭니다. 서비스는 cordis 를 가져오지 않으니 external 설정이 필요 없습니다. `npm run release hello-mcp` 는 이 파일을 먼저 돌리고 나온 `build/hello-mcp.zip` 을 그대로 올립니다.

`--dir` 을 주면 zip 대신 같은 내용을 `build/hello-mcp/` 폴더로 냅니다. 원본 폴더는 묶기 전이라 앱이 그대로 띄울 수 없어서, 앱의 개발 모드에서는 이 폴더를 연결합니다([8. 고치면서 바로 확인하기](#8-고치면서-바로-확인하기)). 서비스나 MCP 서버가 있는 플러그인의 build.mjs 는 `--dir` 을 꼭 받아야 합니다(표준 17번).

`plugins/hello-mcp/build.mjs`

```js
// `node plugins/hello-mcp/build.mjs [--dir]` → build/hello-mcp.zip (--dir 이면 같은 내용을 build/hello-mcp/ 폴더로)
// 서비스(service/index.mjs)를 service.mjs 로, 서버(server/index.mjs)를 MCP SDK 째 server/hello-mcp.mjs 로 묶는다. zip 에는 plugin.json · service.mjs · server/hello-mcp.mjs · skills/
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')
const stage = mkdtempSync(path.join(tmpdir(), 'hello-mcp-'))
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' }
await build({ ...common, entryPoints: [path.join(here, 'service/index.mjs')], outfile: path.join(stage, 'service.mjs') })
await build({ ...common, entryPoints: [path.join(here, 'server/index.mjs')], outfile: path.join(stage, 'server/hello-mcp.mjs') })
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

묶기 전에 서버만 따로 확인하려면 MCP Inspector 로 띄워 봅니다: `HELLO_GREETING=안녕 npx @modelcontextprotocol/inspector node plugins/hello-mcp/server/index.mjs` (망 밖 PC 에서). 서비스는 앱 없이 [가짜 host](service-plugin.md#10-앱-없이-시험하기)로 시험하고, `fake.mcpServers()` 로 올린 서버 선언(command · env)을 확인합니다(서버는 띄우지 않습니다).

## 7. 설치하고 써 보기

1. **설정 › 기능 › 플러그인 › [플러그인 추가 (zip)]** 으로 `build/hello-mcp.zip` 을 고릅니다.
2. 설치 확인창에서 출처를 확인하고 동의한 뒤 범위를 고릅니다 — 써 보는 중이면 **이 프로젝트**. 서비스 플러그인은 동의하고 설치하면 그 자리에서 켜집니다.
3. 설치 뒤 **설정 화면**(플러그인 카드의 **[고치기]**)에서 인사말(예: `반갑습니다`)과 말투를 넣고 **[연결 확인]** — `status` 의 결과 글이 그대로 보입니다.
4. 새 대화에서 "홍길동에게 인사해 줘" — AI 가 스킬을 따라 `litecode_hello-mcp_greet` 를 부르는지 봅니다.

값은 나중에 **[고치기]** 로 바꿉니다. 바꾸면 다음 호출에서 서버가 새 env 로 다시 뜹니다.

> **설치 2단계 폼의 [연결 확인] 은 안 됩니다.** 서비스가 등록한 서버는 서비스가 떠야 알 수 있는데, 설치 중에는 서비스가 아직 안 떠 있어서입니다. 설치를 끝낸 뒤 설정 화면에서 누릅니다.

## 8. 고치면서 바로 확인하기

7번처럼 고칠 때마다 version 을 올려 zip 으로 다시 설치하지 않아도 됩니다. 앱의 **개발 모드**에 폴더를 연결해 두면, 폴더가 바뀔 때마다 zip 설치와 같은 검사를 거쳐 다시 설치하고, 서비스를 다시 올리고 서버를 내리고 도구 목록을 새로 묻습니다. 개발 모드가 어떻게 도는지는 [패널 가이드의 4번](first-panel.md#4-고치면서-바로-확인하기)에 있습니다. 개발 모드는 재동의 없이 이어 갑니다.

서비스 · MCP 플러그인은 원본 폴더를 앱이 그대로 띄울 수 없으니, 원본 대신 **빌드한 폴더**를 연결합니다.

1. `node plugins/hello-mcp/build.mjs --dir` 로 `build/hello-mcp/` 를 만듭니다.
2. 설정 › 기능 › 플러그인 › **개발 중 › [폴더 연결]** 에서 `build/hello-mcp/` 를 고릅니다. `plugins/hello-mcp/` 원본 폴더가 아닙니다.
3. 원본을 고칠 때마다 1번 명령을 다시 돌립니다. 앱이 바뀐 폴더를 보고 다시 설치하고, 행에 "… 설치됨" 이 보입니다.

개발 실행은 설치본과 저장 공간이 따로라, 설정 폼 값(연결 정보 · 비밀 값)은 개발 실행에서 한 번 다시 넣어야 합니다. 서비스를 자주 다시 올리면 메모리가 조금씩 남으니([서비스 가이드의 8번](service-plugin.md#8-정리와-크기)) 가끔 앱을 다시 띄웁니다.

## 엔진에 붙이는 방식 고르기

플러그인 MCP 서버를 엔진(AI)에 붙이는 방식은 두 가지이고, `host.mcp.register` 의 `attach` 로 고릅니다. 어느 쪽이든 서버는 앱이 띄우고 쥡니다 — 처음 부를 때 띄우기 · 쉬면 내리기, 비밀 값을 앱 안에만 두기, 서비스(패널)가 `host.call('mcp.call')` 로 같은 서버를 쓰기, 프로젝트 범위, 부른 대화 `_meta` 는 같습니다.

| | `"litecode"` (기본) | `"server"` |
|---|---|---|
| 붙는 모양 | 앱 MCP `litecode` 안의 도구 | 플러그인 id 이름의 MCP 서버 하나 |
| AI 에게 보이는 이름 | `litecode_<id>_<도구>` | `<id>_<도구>` (서버가 준 도구 이름 그대로) |
| MCP 팝업 | 도구를 하나씩 고를 수 없음 | 서버 한 줄로 보이고 도구를 하나씩 켜고 끔 |
| 어울리는 플러그인 | 도구가 몇 개뿐인 플러그인 (hello-mcp) | 도구가 많거나, 사용자가 필요한 도구만 골라 쓰게 할 플러그인 (chrome-browser 12개 등) |

```js
host.mcp.register({ command: 'server/hello-mcp.mjs', attach: 'server' })
```

- 다른 값은 거절됩니다. id 가 `litecode` 이면 `server` 로 붙일 수 없습니다(예약 이름, 같은 거절).
- **스킬의 도구 이름을 방식에 맞게** 적습니다. `server` 로 바꾸면 `litecode_hello-mcp_greet` 가 `hello-mcp_greet` 가 됩니다.
- 사용자가 저장한 MCP 서버(모든 프로젝트 · 이 프로젝트 · 개인 설정)와 이름이 같으면 사용자 서버가 이깁니다. 그 플러그인은 `litecode` 방식으로 붙고 플러그인 목록에 "MCP 이름 겹침" 이 뜹니다 — 그때 도구 이름이 `litecode_` 로 바뀌니, 스킬에 "도구가 없으면 다른 이름도 찾아본다" 고 적어 두면 안전합니다.
- 어떤 프로젝트의 `.mcp.json` 에만 같은 이름이 있으면 그 프로젝트에서만 사용자 서버가 이기고, 거기서는 플러그인 도구를 쓸 수 없습니다.
- `panelTools` 와 `settingsCheck` 도구는 AI 에 안 보입니다.

## 서비스와 패널이 서버를 쓰는 법

서비스는 **자기가 등록한 서버**의 도구를 `host.call('mcp.call')` 로 부릅니다(`service` 권한만으로 됩니다. 다른 플러그인의 서버는 부를 수 없고, 서버를 올리기 전에는 `permission-missing` 입니다). `mcp.call` 은 서버의 어느 도구든 부르고(`panelTools` 와 무관), 결과는 `{ text, isError }` 입니다.

ui-test 의 서비스가 이렇게 합니다 (발췌 — 서비스 이전 PR 기준).

```js
host.mcp.register({ command: 'server/ui-test.mjs', env: { … }, panelTools: ['progress', 'stop', 'shot'] })

// 서버 도구 하나를 부른다 — 실패(isError)면 던진다
async tool(name, args, { directory }) {
  const result = await host.call('mcp.call', { tool: name, args }, { directory })
  if (result?.isError) throw new Error(result.text)
  return result?.text ?? ''
}

this.expose('stop', (_params, call) => this.tool('stop', {}, call))   // 패널이 service.call 로 부르면 서버의 stop 도구로
```

- **패널은 서비스를 거칩니다.** 패널이 `service.call` 로 `expose` 한 메서드를 부르고, 서비스가 서버 도구를 부릅니다. 진행률 · 멈추기처럼 패널만 쓰는 도구는 `panelTools` 에 적어 AI 목록에서 뺍니다.
- **진행은 밀어 보냅니다.** 수행이 오래 걸리면 서비스가 서버의 `progress` 를 읽어 `host.panel.emit('progress', …)` 로 보내고, 패널은 `events.subscribe(['service.progress'])` 로 받습니다 — 폴링이 필요 없습니다. 값은 64KB 이하, 초당 20번을 넘으면 버려지니 모아서 보냅니다([서비스 가이드의 6번](service-plugin.md#6-패널과-말하기--servicecall--panelemit)).
- 설정 폼 · [연결 확인] 은 앱이 그립니다. 서비스가 `host.call('settings.check')`(연결 확인)나 `host.call('settings.summary')`(비밀 값은 뺀 현재 설정 값)로 읽고, `settings.open` 은 그 플러그인 탭이 보일 때 폼을 띄웁니다.

## 알림을 띄우려면

**MCP 서버의 도구 결과로는 앱 알림을 보낼 수 없습니다**(`panel.notify` 도 MCP 서버에서는 못 부릅니다). 도구 결과가 엔진을 거쳐 AI 에게 가서, 앱이 중간에서 꺼낼 자리가 없기 때문입니다. 대신 두 길이 있습니다.

- **서비스(패널)에서** — 서버 도구 결과를 받은 뒤 서비스가 `host.call('panel.notify', …)` 를 부릅니다(패널이면 `panel.notify`). 모양과 상한은 [패널 가이드의 알림](first-panel.md#알림)을 따릅니다.
- **`tools` 도구에서** — 한 번 실행하는 도구(`tools` 선언)는 stdout 결과 JSON 에 `notify` 를 같이 실을 수 있습니다. AI 가 부를 때도, 패널의 `tools.run` 으로 부를 때도 같은 검사 · 상한(60초에 5개)을 거치고, AI 에게는 `text` 만 갑니다.

```json
{ "text": "분석이 끝났습니다", "notify": { "title": "분석 끝", "body": "느린 쿼리 3개", "level": "success" } }
```

새 manifest 필드나 권한은 필요 없습니다.

## 에이전트를 같이 싣기

검토 · 작성처럼 역할이 정해진 일을 AI 가 서브에이전트에게 맡기게 하려면, 에이전트 파일을 플러그인에 담고 manifest 의 `agents` 에 적습니다. 권한은 필요 없습니다.

`plugins/hello-mcp/plugin.json` (일부)

```json
"agents": ["agents/greeting-reviewer.md"]
```

`plugins/hello-mcp/agents/greeting-reviewer.md`

```md
---
name: greeting-reviewer
description: Reviews a greeting for tone before it is sent. Use when the user asks to check a greeting.
mode: subagent
permission:
  edit: deny
---

You review greetings written in Korean. Point out anything rude or too casual, and suggest one better line.
```

- 파일 형식은 프로젝트의 `.litecode/agents/*.md` 와 같습니다. frontmatter 에 `name` · `description` · `mode: subagent`(다른 mode 는 거절) · `permission`, 본문이 시스템 프롬프트입니다. `name` 이 없으면 파일 이름을 씁니다.
- 경로는 플러그인 폴더 기준 상대 경로이고 소문자 `.md` 로 끝납니다. 규칙은 `entry` 와 같습니다(폴더 밖 · 절대 경로 · `..` 안 됨). 최대 20개, 파일 하나 256KB 까지입니다. 언어 팩 · 문법 팩에는 넣을 수 없습니다.
- 파일이 없거나 크기를 넘거나 형식이 틀리면 `agents-invalid`(그 경로)로 설치가 거절됩니다.
- 이름이 겹치면 프로젝트 > 사용자 > 플러그인 순으로 이깁니다. 플러그인끼리는 id 순으로 앞의 것이 이기고, 진 쪽은 경고로 남습니다.
- 에이전트도 `scope` 를 따릅니다. `project` 플러그인의 에이전트는 켜지지 않은 프로젝트에서 숨겨집니다.
- 켜기 · 끄기 · 설치 뒤 다음 턴 전에 엔진이 다시 읽습니다. 에이전트 설명은 매 턴 오가니 짧게 씁니다.

## 옛 방식 — manifest `mcp` 선언

서비스를 모르는 옛 플러그인(chrome-browser 등)은 `plugin.json` 에 `mcp` 선언을 직접 적어 서버를 싣습니다. **병행 기간의 옛 방식이고 서비스로 옮기는 중**입니다. 새 플러그인은 위처럼 서비스로 만드세요.

```json
{
  "permissions": ["mcp"],
  "mcp": { "command": "server/hello-mcp.mjs", "env": { "HELLO_GREETING": "${storage:greeting}" } }
}
```

- `mcp` 선언과 `mcp` 권한은 **같이만** 있어야 합니다. `command` · `args` · `env` · `idleMs` · `timeoutMs` · `panelTools` · `attach` 의 규칙은 위 [서비스 등록](#3-서비스--서버-등록)과 같습니다.
- 패널은 앱 통로의 `mcp.call` · `mcp.status` 로 부르고, `settingsCheck` 는 `mcp` 선언이 있어야 [연결 확인] 에 쓸 수 있습니다.
- 같은 플러그인에 manifest `mcp` 와 서비스의 `host.mcp.register` 를 둘 다 둘 수는 없습니다(서버는 플러그인에 하나).
- 서비스로 옮길 때는 `mcp` 선언과 `mcp` 권한을 지우고 `service` 권한과 서비스 코드를 더합니다. 서버 코드는 그대로입니다.

## 정리

설정 칸 · [연결 확인] · 스킬을 담고, 서비스가 MCP 서버를 등록하는 플러그인을 만들었고, 서비스와 서버를 각각 한 파일로 묶었습니다. 비밀 값은 서비스가 읽지 않고 서버 환경 변수로만 갔습니다. 더 큰 예는 [sql-tuning](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/sql-tuning)(DB 드라이버를 같이 묶음, `settingsPer: "project"`, secret 칸)과 [ui-test](https://github.com/kim-taehan/lite-harness-plugins/tree/main/plugins/ui-test)(묶이지 않는 패키지를 `server/node_modules` 로 옆에 싣기, 진행을 `host.panel.emit` 으로 밀어 보내기)입니다. 두 플러그인의 서비스 이전이 저장소에 머지되면 원본이 이 가이드와 같은 모양입니다.

## 다음

- [서비스 플러그인 만들기](service-plugin.md) — 소식 받기 · 상태 · 패널과 말하기
- [저장소로 내보내기](publish.md) — build.mjs 가 있는 플러그인 올리기
- [언어 팩 · 문법 팩](locale-grammar.md) — 코드 없는 플러그인
