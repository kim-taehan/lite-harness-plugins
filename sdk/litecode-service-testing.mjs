// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
// 앱 없이 서비스 번들을 시험하는 가짜 host — 사용법은 docs/plugin-sdk/README.md. Node 도 cordis 도 쓰지 않는다.

// --- shared/extensions/channel.ts
// shared/extensions/ 의 조각 — 확장 ↔ 앱 통로 — 호출 · 알림 · 패널 이벤트. 쓰는 쪽은 이 조각 파일에서 바로 가져온다
/** 플러그인 알림의 종류 (#1337) */
const EXTENSION_NOTICE_LEVELS = ['info', 'success', 'warning', 'error'];
/** 패널이 받을 수 있는 앱 소식 → 필요한 권한 (null: 권한 없이) (#1336). 패널은 events.subscribe 로 고른다 */
const PANEL_EVENT_PERMISSIONS = {
    /** 이 프로젝트의 대화에서 AI 턴이 끝났다 — { conversationId, outcome } */
    'chat.turnEnded': 'chat',
    /** AI 가 이 프로젝트의 파일을 쓰거나 고쳤다 — { paths, truncated? } (0.5초 묶음) */
    'project.filesChanged': 'project',
    /** 이 프로젝트 오른쪽 패널에 연 파일 탭이 바뀌었다 — { paths } */
    'project.openTabsChanged': 'project',
    /** 사용량 장부가 늘었다 — {} (숫자는 usage.summary) */
    'usage.changed': 'usage',
    /** 이 플러그인의 설정 값이 저장됐다 — {} */
    'settings.saved': null,
    /** 사용자가 지금 보는 대화를 바꿨다 — { current: { conversationId, title } | null } (#1338). 화면이 보낸다 */
    'chat.currentChanged': 'chat',
    /** 파일 우클릭 메뉴로 이 탭에 파일이 넘어왔다 — { path } (프로젝트 기준). 같은 값은 panel.args 로도 읽는다 (#1341) */
    'panel.args': 'project',
};
function isPanelEventName(value) {
    return typeof value === 'string' && Object.hasOwn(PANEL_EVENT_PERMISSIONS, value);
}
const SERVICE_PANEL_EVENT_PREFIX = 'service.';
/** 서비스가 정하는 이름(접두어 뒤) — 글자로 시작하고 64자 안 */
const SERVICE_PANEL_EVENT_SUFFIX = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
function isServicePanelEventName(value) {
    return typeof value === 'string' && value.startsWith(SERVICE_PANEL_EVENT_PREFIX) && SERVICE_PANEL_EVENT_SUFFIX.test(value.slice(SERVICE_PANEL_EVENT_PREFIX.length));
}
/** events.subscribe 로 받을 수 있는 이름 — 앱 소식 또는 서비스 소식 */
function isSubscribableEventName(value) {
    return isPanelEventName(value) || isServicePanelEventName(value);
}
/** 그 소식을 받으려면 플러그인이 가져야 하는 권한 (null: 권한 없이) */
function panelEventPermission(name) {
    return isPanelEventName(name) ? PANEL_EVENT_PERMISSIONS[name] : 'service';
}
function isAppPanelEvent(event) {
    return isPanelEventName(event.event);
}
/** 통로 메서드의 성공 결과를 화면 동작으로 — 화면이 해야 하는 메서드가 아니거나 모양이 틀리면 undefined */
function uiActionOf(method, result) {
    if (method === 'chat.current')
        return { kind: 'current-conversation' };
    if (method === 'project.openTabs')
        return { kind: 'open-tabs' };
    if (typeof result !== 'object' || result === null)
        return undefined;
    if (method === 'chat.compose') {
        const text = Reflect.get(result, 'text');
        return typeof text === 'string' ? { kind: 'compose', text, send: Reflect.get(result, 'send') === true } : undefined;
    }
    if (method === 'chat.open') {
        const conversationId = Reflect.get(result, 'conversationId');
        return typeof conversationId === 'string' ? { kind: 'open-conversation', conversationId } : undefined;
    }
    if (method === 'project.openFile') {
        const path = Reflect.get(result, 'path');
        const line = Reflect.get(result, 'line');
        if (typeof path !== 'string' || (line !== undefined && typeof line !== 'number'))
            return undefined;
        return { kind: 'open-file', path, ...(line !== undefined && { line }) };
    }
    return undefined;
}

// --- shared/extensions/serviceApi.ts
// shared/extensions/ 의 조각 — 설치형 서비스의 호스트 API 허용 목록 (#1614, 설계 5·6장). 설치 검사 · 호스트 · 계약 테스트가 모두 이 파일 하나를 본다.
// 같은 프로세스에서 앱과 같은 권한으로 도는 코드라 이 목록은 실수를 막는 가드레일이지 보안 경계가 아니다(보안은 출처 확인 · 기본 꺼짐 · 동의 · 해시)
/** 이 앱이 아는 호스트 API 버전 — manifest `service.api` 는 1 이상 이 값 이하의 정수. 큰 값이면 설치를 거절한다(service-incompatible) */
const SERVICE_API_LATEST = 1;
/** 서비스가 `inject` · `ctx.get` 으로 받을 수 있는 앱 서비스 키 (api 1) — 바탕 서비스 중 읽기용만.
 *  넣지 않는 것: 기능 묶음 서비스(꺼지면 사라진다 — 규칙 27 과 같은 이유) · settings · providers · engine · sso · account(키·토큰에 닿는다 — 규칙 15) · remote · extensions · 다른 플러그인의 ext_* */
const SERVICE_INJECT_ALLOWLIST = ['projects', 'usage'];
/** 서비스가 구독할 수 있는 소식 — 이름은 패널 소식(PANEL_EVENT_PERMISSIONS)과 한 벌이고, 필요한 권한도 그 표를 쓴다(Cordis 이벤트 이름은 서비스에 내주지 않는다).
 *  project: 앱 안의 출처에서 프로젝트를 알아내는 방법(소식에 directory 가 실린다) — 프로젝트를 모르면 호스트는 프로젝트별 서비스에 주지 않고 버린다 · 'app': 프로젝트 정보가 없어 scope: "app" 서비스만 받는다.
 *  source: 앱 안의 출처 이름(작성 안내 · .d.ts 의 이름 짝) · data: 서비스가 받는 값의 모양(TypeScript 글 — .d.ts 가 그대로 쓴다, 생성: scripts/generate-plugin-sdk.mjs).
 *  이 표에 적지 않은 소식은 허용하지 않는다. llm/tool-done 은 도구 인자·결과가 새므로 직접 주지 않고 project.filesChanged 로만 */
const SERVICE_EVENTS = {
    /** 앱의 chat/turn-ended — 대화가 있으면 그 작업 폴더(패널 소식과 같은 방식) */
    'chat.turnEnded': { project: 'conversation', source: 'chat/turn-ended', data: "{ directory?: string; conversationId: string; outcome: 'done' | 'interrupted' | 'failed' }" },
    /** 쓰기·고치기 도구의 끝을 0.5초 묶음으로 — 등록 경로(projectsAt, worktree 포함) */
    'project.filesChanged': { project: 'registered-path', source: 'llm/tool-done (쓰기·고치기)', data: '{ directory?: string; paths: string[]; truncated?: boolean }' },
    /** 앱의 usage/changed — 인자가 없어 프로젝트를 모른다 */
    'usage.changed': { project: 'app', source: 'usage/changed', data: '{}' },
};
function isServiceEventName(value) {
    return typeof value === 'string' && Object.hasOwn(SERVICE_EVENTS, value);
}
/** 그 소식을 받으려면 플러그인이 가져야 하는 권한 — 패널과 같은 표 */
function serviceEventPermission(event) {
    return PANEL_EVENT_PERMISSIONS[event];
}
/** 프로젝트를 모르는 소식인가 — scope: "app" 서비스만 받을 수 있다 */
function isAppOnlyServiceEvent(event) {
    return SERVICE_EVENTS[event].project === 'app';
}
/** 서비스가 host.call 로 부를 수 있는 통로 메서드 — 패널의 호출 표(CALL_TABLE)와 같은 이름이고, 권한 검사도 그 표가 한다(manifest permissions).
 *  빠진 것은 서비스에 뜻이 없는 것뿐이다: panel.fullscreen(보이는 패널 탭의 전체 화면 — 서비스에는 탭이 없다) · panel.args(파일 메뉴로 그 탭에 넘어온 값) ·
 *  settings.open(그 탭 위에 설정 폼을 띄우고 저장했나를 기다린다) · events.subscribe(서비스는 ctx.on) · service.call · service.list(자기 자신).
 *  화면이 해야 끝나는 것(SERVICE_UI_METHODS)도 허용한다 — 메인이 그 프로젝트 폴더의 창에 화면 동작을 보내고 답을 받는다. project.pickPath 는 부모 없는 고르기 창을 띄운다.
 *  호출 표에 메서드가 늘면 여기에 넣을지 빼놓을지 정해야 한다 — tests/unit/arch/pluginServiceApi.test.ts */
const SERVICE_CALL_METHODS = [
    'storage.get',
    'storage.set',
    'storage.delete',
    'secrets.get',
    'secrets.set',
    'secrets.delete',
    'network.fetch',
    'network.connection',
    'network.setConnection',
    'project.info',
    'project.readFile',
    'project.openFile',
    'project.openTabs',
    'project.pickPath',
    'project.changedFiles',
    'project.listDir',
    'project.findFiles',
    'project.countFiles',
    'project.fileInfo',
    'project.writeFile',
    'project.removeFile',
    'settings.summary',
    'settings.check',
    'chat.compose',
    'chat.open',
    'chat.current',
    'chat.exists',
    'chat.titles',
    'tools.run',
    'mcp.call',
    'mcp.status',
    'usage.summary',
    'panel.notify',
    'skills.readFile',
    'skills.writeFile',
    'skills.deleteFile',
];
/** 호출이 통과하면 그 프로젝트의 창이 해야 끝나는 것 — 메인이 화면 동작(ExtensionUiAction)을 보내고 창의 답을 기다린다. 답이 없으면(창이 없다) no-window.
 *  new 대화 · 대화 열기 · 파일 열기는 null, chat.current · project.openTabs 는 화면이 준 값을 돌려준다 */
const SERVICE_UI_METHODS = ['chat.compose', 'chat.open', 'project.openFile', 'chat.current', 'project.openTabs'];
function isServiceCallMethod(value) {
    return typeof value === 'string' && SERVICE_CALL_METHODS.some((method) => method === value);
}
/** 근거: 진행 상황 · 상태 요약 같은 작은 값이 목적이다. 큰 자료는 service.call 로 당겨 가게 */
const PANEL_PUSH_MAX_BYTES = 64 * 1024;
/** 근거: 화면 갱신이 1초에 몇 번이면 충분하다 — 넘으면 말없이 버린다(마지막 값이 필요하면 서비스가 모아 보낸다) */
const PANEL_PUSH_MAX_PER_SECOND = 20;

// --- shared/extensions/serviceHostCore.ts
/** 이 서비스가 받기로 한 소식의 받는 곳 — 호스트가 deliver 로 넣는다. 핸들러가 던져도(비동기 포함) 서비스 밖으로 새지 않는다 */
class ServiceEvents {
    handlers = new Map();
    /** 소식 하나를 받는다 — 돌려준 함수로 그만 받는다 */
    on(name, handler) {
        const set = this.handlers.get(name) ?? new Set();
        set.add(handler);
        this.handlers.set(name, set);
        return () => void set.delete(handler);
    }
    deliver(name, data) {
        for (const handler of [...(this.handlers.get(name) ?? [])]) {
            try {
                Promise.resolve(handler(data)).catch((error) => console.error(`[pluginServices] ${name} 처리 실패`, error));
            }
            catch (error) {
                console.error(`[pluginServices] ${name} 처리 실패`, error);
            }
        }
    }
}
/** manifest 의 service.events 에 적은 소식인가 */
function isDeclaredEvent(declared, name) {
    return isServiceEventName(name) && (declared ?? []).includes(name);
}
/** 번들의 ctx.on — 선언하지 않은 소식은 던진다(올리는 쪽이 그 서비스를 실패로 처리) */
function subscribeDeclared(events, declared, name, handler) {
    if (!isDeclaredEvent(declared, name))
        throw new Error(`service event not declared: ${name}`);
    return events.on(name, handler);
}
/** 앱이 낸 소식 하나를 이 서비스에 줄 값으로 — 줄 것이 아니면 undefined.
 *  프로젝트를 모르는 소식은 scope: "app" 서비스만 · 프로젝트별 서비스는 소식의 폴더를 모르거나(닫힌 채 실패) 그 폴더에서 안 켜졌으면 받지 못한다 */
async function valueFor(scope, name, event, enabledIn) {
    if (isAppOnlyServiceEvent(name))
        return scope === 'app' ? event.data : undefined;
    if (scope !== 'app' && (event.directory === undefined || !(await enabledIn(event.directory))))
        return undefined;
    return { ...(event.directory !== undefined && { directory: event.directory }), ...event.data };
}
/** host.call 이 실패하면 던지는 오류 — code 는 패널 통로와 같은 오류 코드(ExtensionCallError), origin 은 network 오류가 알려 주는 주소 */
class ServiceCallError extends Error {
    code;
    origin;
    constructor(code, origin) {
        super(`service call failed: ${code}`);
        this.code = code;
        this.origin = origin;
        this.name = 'ServiceCallError';
    }
}
/** host.call 의 앞문 — 허용 목록 밖은 method-unknown, 프로젝트별 서비스는 폴더가 있고 그 프로젝트에서 켜졌어야 한다(아니면 not-on). 통과하면 undefined.
 *  진짜 호스트와 가짜 host 가 같은 판정을 쓴다 */
async function serviceCallGate(scope, method, directory, enabledIn) {
    if (!isServiceCallMethod(method))
        return 'method-unknown';
    if (directory === undefined)
        return scope === 'app' ? undefined : 'not-on';
    return (await enabledIn(directory)) ? undefined : 'not-on';
}
/** expose 한 이름 → 함수. 번들의 Service 바탕이 들고, 호스트가 부른다 */
class ServiceBaseCore {
    ctx;
    exposed = new Map();
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** 패널 · 호스트가 부를 수 있는 메서드를 낸다 — 서비스가 내려가면 같이 사라진다 */
    expose(name, fn) {
        this.exposed.set(name, fn);
    }
}
/** expose 한 메서드를 부른다 — 낸 적 없는 이름은 던진다 */
function callExposed(exposed, name, params, call) {
    const fn = exposed.get(name);
    if (!fn)
        throw new Error(`service method unknown: ${name}`);
    return fn(params, call);
}
/** 지금 projectOn 을 불러 둔 프로젝트와 그 해제 함수 — projectOn 이 던져도 서비스 밖으로 새지 않고, 해제 함수가 던져도 나머지는 해제한다 */
class ProjectSet {
    id;
    projectOn;
    released = new Map();
    constructor(id, projectOn) {
        this.id = id;
        this.projectOn = projectOn;
    }
    list() {
        return [...this.released.keys()];
    }
    enable(directory) {
        if (this.released.has(directory))
            return;
        let release = () => undefined;
        try {
            const given = this.projectOn(directory);
            if (typeof given === 'function')
                release = given;
        }
        catch (error) {
            console.error(`[pluginServices] ${this.id} projectOn 실패`, error);
        }
        this.released.set(directory, release);
    }
    disable(directory) {
        const release = this.released.get(directory);
        if (!release)
            return;
        this.released.delete(directory);
        try {
            release();
        }
        catch (error) {
            console.error(`[pluginServices] ${this.id} 프로젝트 해제 실패`, error);
        }
    }
    disableAll() {
        for (const directory of this.list())
            this.disable(directory);
    }
    /** 켜진 프로젝트 집합을 맞춘다 — 늘어난 곳은 projectOn, 줄어든 곳은 해제 함수 */
    sync(now) {
        for (const directory of this.list())
            if (!now.has(directory))
                this.disable(directory);
        for (const directory of now)
            this.enable(directory);
    }
}
/** manifest tools 의 도구 이름 규칙(extensions/tools/toolDeclaration.ts)과 같다 */
const SERVICE_TOOL_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const SERVICE_TOOL_DESCRIPTION_MAX = 4_000;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** AI 에 보이는 도구 이름 — manifest tools 와 같은 `<플러그인 id>_<이름>` */
function serviceToolFullName(id, name) {
    return `${id}_${name}`;
}
/** host.tools.register 인자 검사 — 틀린 곳이 있으면 그 글, 맞으면 undefined (진짜 호스트와 가짜 host 가 같은 검사를 쓴다) */
function serviceToolProblem(spec) {
    if (!isPlainObject(spec))
        return 'tool must be an object';
    const { name, description, inputSchema, run } = spec;
    if (typeof name !== 'string' || !SERVICE_TOOL_NAME.test(name))
        return 'tool.name must be lowercase letters, digits, "-" or "_" (start with a letter, up to 40 characters)';
    if (typeof description !== 'string' || description.trim() === '' || description.length > SERVICE_TOOL_DESCRIPTION_MAX)
        return 'tool.description must be a non-empty string (up to 4000 characters)';
    if (!isPlainObject(inputSchema) || inputSchema['type'] !== 'object' || (inputSchema['properties'] !== undefined && !isPlainObject(inputSchema['properties'])))
        return 'tool.inputSchema must be an object schema (type: "object")';
    if (typeof run !== 'function')
        return 'tool.run must be a function';
    return undefined;
}
/** host.panel.emit 의 앞문 — 이름은 `service.` 를 붙여 검사하고, 값은 JSON 으로 오갈 수 있게 복사한다(못 직렬화하거나 상한을 넘으면 던진다). 진짜 호스트와 가짜 host 가 같이 쓴다 */
function buildPanelPush(name, data, directory) {
    const event = `${SERVICE_PANEL_EVENT_PREFIX}${name}`;
    if (!isServicePanelEventName(event))
        throw new Error(`invalid panel event name: ${name}`);
    if (directory !== undefined && (typeof directory !== 'string' || directory === ''))
        throw new Error('panel.emit directory must be a non-empty string');
    let text;
    try {
        text = JSON.stringify(data);
    }
    catch {
        throw new Error('panel.emit data must be JSON-serializable');
    }
    if (text === undefined)
        throw new Error('panel.emit data must be JSON-serializable');
    if (new TextEncoder().encode(text).length > PANEL_PUSH_MAX_BYTES)
        throw new Error(`panel.emit data is too big (limit ${PANEL_PUSH_MAX_BYTES} bytes)`);
    return { event, data: JSON.parse(text), ...(directory !== undefined && { directory }) };
}
/** 지난 1초 안에 PANEL_PUSH_MAX_PER_SECOND 번을 넘으면 버린다 — 시계는 부르는 쪽이 준다 */
class PanelPushLimiter {
    recent = [];
    allow(now) {
        for (let first = this.recent[0]; first !== undefined && now - first >= 1000; first = this.recent[0])
            this.recent.shift();
        if (this.recent.length >= PANEL_PUSH_MAX_PER_SECOND)
            return false;
        this.recent.push(now);
        return true;
    }
}
/** host.fetch (#1614) — host.call('network.fetch') 를 Response 모양으로 감싼 것뿐이라 규칙이 그대로다: network 권한 · 사용자가 허용한 주소(없으면 network-denied — 서비스에는 동의를 물을 화면이 없다) ·
 *  앱 자신의 주소 거절 · http/https 만 · 기한 · 응답 크기 상한 · 같은 origin 리다이렉트만. 실패는 host.call 과 같은 ServiceCallError.
 *  서비스는 앱과 같은 프로세스라 직접 fetch·node:http 는 호스트가 못 막는다 — 설치 검사가 번들 글자로 그 흔적을 찾는다(serviceBundleScan.ts, 완전하지 않다) */
function serviceFetch(call) {
    return async (url, init = {}) => {
        const { directory, ...request } = init;
        const result = await call({ url: String(url), ...request }, directory);
        if (typeof result !== 'object' || result === null || !('status' in result) || !('body' in result) || typeof result.status !== 'number' || typeof result.body !== 'string')
            throw new Error('unexpected network.fetch reply');
        const headers = 'headers' in result && typeof result.headers === 'object' && result.headers !== null ? Object.fromEntries(Object.entries(result.headers).filter((entry) => typeof entry[1] === 'string')) : {};
        // 본문 없는 상태(204 · 205 · 304)는 body 를 주면 Response 가 던진다
        const noBody = result.status === 204 || result.status === 205 || result.status === 304;
        return new Response(noBody ? null : result.body, { status: result.status, headers });
    };
}

// --- shared/extensions/serviceHostFake.ts
export function createFakeHost(options = {}) {
    const id = options.id ?? 'fake-service';
    const scope = options.scope ?? 'project';
    const declaredEvents = options.events ?? [];
    const declaredInject = options.inject ?? [];
    const settings = { ...options.settings };
    const events = new ServiceEvents();
    const callLog = [];
    const cleanups = [];
    const enabled = new Set();
    let inner;
    let projectSet;
    const enabledIn = async (directory) => scope === 'app' || enabled.has(directory);
    const logger = Object.assign((_name) => logger, { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined });
    const injected = {};
    for (const key of declaredInject)
        injected[key] = options.services?.[key];
    const ctx = {
        ...injected,
        on: (name, handler) => {
            const off = subscribeDeclared(events, declaredEvents, name, handler);
            cleanups.push(off);
            return off;
        },
        get: (key) => (isInjectKey(key) && declaredInject.includes(key) ? options.services?.[key] : undefined),
        effect: (setup) => {
            const cleanup = setup();
            if (typeof cleanup === 'function')
                cleanups.push(cleanup);
        },
        logger,
    };
    const locales = [];
    const tools = new Map();
    const mcpServers = [];
    const pushed = [];
    const pushLimiter = new PanelPushLimiter();
    const skills = [];
    const agents = [];
    const servers = [];
    /** 목록에 넣고 빼는 함수를 돌려준다 — 서비스를 내릴 때도 빠진다 */
    const track = (list, item) => {
        list.push(item);
        const off = () => {
            const at = list.indexOf(item);
            if (at >= 0)
                list.splice(at, 1);
        };
        cleanups.push(off);
        return off;
    };
    const markdown = (kind, list, item) => {
        if (typeof item.name !== 'string' || item.name === '')
            throw new Error(`host.${kind}.register: name is required`);
        if (list.some((other) => other.name === item.name))
            throw new Error(`host.${kind}.register: duplicate name: ${item.name}`);
        return track(list, item);
    };
    const host = {
        Service: (ServiceBaseCore),
        id,
        enabledIn,
        projects: async () => (scope === 'app' ? [] : [...enabled]),
        settings: async () => ({ ...settings }),
        locale: {
            register: (pack) => {
                if (scope !== 'app')
                    throw new Error('host.locale.register is only for services with scope "app"');
                locales.push(pack);
                const off = () => {
                    const at = locales.indexOf(pack);
                    if (at >= 0)
                        locales.splice(at, 1);
                };
                cleanups.push(off);
                return off;
            },
        },
        skills: { register: (skill) => markdown('skills', skills, skill) },
        agents: { register: (agent) => markdown('agents', agents, agent) },
        lsp: {
            register: (server) => {
                if (servers.some((other) => other.languageId === server.languageId || other.extensions.some((ext) => server.extensions.includes(ext))))
                    throw new Error('host.lsp.register: languageId or extension already registered');
                return track(servers, server);
            },
        },
        async call(method, params, callOptions = {}) {
            const denied = await serviceCallGate(scope, method, callOptions.directory, enabledIn);
            if (denied)
                throw new ServiceCallError(denied);
            callLog.push({ method, params, ...(callOptions.directory !== undefined && { directory: callOptions.directory }) });
            const handler = isCallMethod(method) ? options.calls?.[method] : undefined;
            if (!handler)
                throw new ServiceCallError('io-failed');
            return handler(params, callOptions);
        },
        tools: {
            register: (tool) => {
                const problem = serviceToolProblem(tool);
                if (problem !== undefined)
                    throw new Error(`invalid tool: ${problem}`);
                const name = serviceToolFullName(id, tool.name);
                if (tools.has(name))
                    throw new Error(`tool name already in use: ${name}`);
                tools.set(name, tool);
                const off = () => {
                    if (tools.get(name) === tool)
                        tools.delete(name);
                };
                cleanups.push(off);
                return off;
            },
        },
        mcp: {
            register: (server) => {
                if (typeof server !== 'object' || server === null || typeof server.command !== 'string' || server.command === '')
                    throw new Error('invalid mcp declaration: mcp.command');
                if (mcpServers.length > 0)
                    throw new Error('this plugin already has an MCP server');
                mcpServers.push(server);
                const off = () => {
                    const at = mcpServers.indexOf(server);
                    if (at >= 0)
                        mcpServers.splice(at, 1);
                };
                cleanups.push(off);
                return off;
            },
        },
        panel: {
            emit: (name, data, emitOptions) => {
                const push = buildPanelPush(name, data, emitOptions?.directory);
                if (pushLimiter.allow(Date.now()))
                    pushed.push(push);
            },
        },
        fetch: serviceFetch((params, directory) => host.call('network.fetch', params, directory === undefined ? undefined : { directory })),
    };
    function running() {
        if (!inner)
            throw new Error('mount(factory) first');
        return inner;
    }
    return {
        host,
        ctx,
        /** 번들의 기본 내보내기(host => class)로 서비스를 만든다 — 이미 켜 둔 프로젝트에는 projectOn 을 부른다 */
        mount(factory) {
            const Bundle = factory(host);
            const service = new Bundle(ctx);
            inner = service;
            projectSet = new ProjectSet(id, (directory) => service.projectOn?.(directory));
            if (scope !== 'app')
                for (const directory of enabled)
                    projectSet.enable(directory);
            return service;
        },
        /** 그 프로젝트에서 서비스가 켜졌다 — projectOn 을 부른다(scope: "app" 은 안 부른다) */
        enableProject(directory) {
            enabled.add(directory);
            if (scope !== 'app')
                projectSet?.enable(directory);
        },
        /** 그 프로젝트에서 꺼졌다 — projectOn 이 돌려준 해제 함수를 부른다 */
        disableProject(directory) {
            enabled.delete(directory);
            projectSet?.disable(directory);
        },
        /** projectOn 을 불러 둔 프로젝트 */
        projectsOn: () => projectSet?.list() ?? [],
        /** 앱이 소식을 냈다 — 진짜 호스트처럼 받기로 선언한 서비스에, 켜진 프로젝트 것만 준다 */
        async emit(name, payload = {}) {
            if (!isServiceEventName(name))
                throw new Error(`unknown service event: ${name}`);
            if (!isDeclaredEvent(declaredEvents, name))
                return;
            const { directory, ...data } = payload;
            const value = await valueFor(scope, name, { ...(directory !== undefined && { directory }), data }, enabledIn);
            if (value !== undefined)
                events.deliver(name, value);
            // 핸들러는 비동기일 수 있다 — 한 박자 기다려 서비스 안의 일이 끝나게 한다
            await Promise.resolve();
        },
        /** 패널의 service.call 처럼 expose 한 메서드를 부른다 — 결과는 JSON 으로 오간 값(undefined 는 null) */
        async call(name, params, call = {}) {
            const result = await callExposed(running().exposed, name, params, call);
            return result === undefined ? null : JSON.parse(JSON.stringify(result));
        },
        /** expose 한 이름 */
        names: () => [...running().exposed.keys()],
        /** host.call 로 부른 것의 기록 — 허용 앞문을 지난 것만 */
        calls: callLog,
        /** host.panel.emit 으로 밀어 보낸 소식 — 이름은 `service.<이름>`, 값은 JSON 으로 복사된 것(상한을 넘은 것은 버려져 없다) */
        pushes: () => [...pushed],
        /** host.settings 가 돌려주는 값 — 바꾸면 다음 호출부터 반영 */
        settings,
        /** host.locale.register 로 올려 둔 언어 팩 — 해제하면 빠진다 */
        locales: () => [...locales],
        /** host.tools.register 로 올려 둔 AI 도구 — 해제하거나 서비스를 내리면 빠진다 */
        tools: () => [...tools].map(([name, { description, inputSchema }]) => ({ name, description, inputSchema })),
        /** AI 가 그 도구를 부른 것처럼 run 을 부른다 — 진짜 앱처럼 그 프로젝트에서 서비스가 켜져 있어야 보인다(아니면 없는 도구) */
        async callTool(name, args, call) {
            const tool = tools.get(name);
            if (!tool || !(await enabledIn(call.directory)))
                throw new Error(`tool not available: ${name}`);
            return tool.run(args, call);
        },
        /** host.mcp.register 로 선언해 둔 MCP 서버 — 가짜 host 는 띄우지 않는다(선언 모양만 본다) */
        mcpServers: () => [...mcpServers],
        /** host.skills.register · agents.register · lsp.register 로 올려 둔 것 — 해제하면 빠진다 */
        skills: () => [...skills],
        agents: () => [...agents],
        lspServers: () => [...servers],
        /** 서비스를 내린다 — 켜 둔 프로젝트의 해제 함수 · ctx.effect 의 정리 · 소식 구독 해제 */
        async dispose() {
            projectSet?.disableAll();
            for (const cleanup of cleanups.splice(0).reverse())
                await cleanup();
            inner = undefined;
        },
    };
}
function isCallMethod(method) {
    return isServiceCallMethod(method);
}
function isInjectKey(key) {
    return SERVICE_INJECT_ALLOWLIST.some((allowed) => allowed === key);
}
