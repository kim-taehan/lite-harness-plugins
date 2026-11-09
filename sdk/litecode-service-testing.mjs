// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
// 앱 없이 서비스 번들을 시험하는 가짜 host — 사용법은 docs/plugin-sdk/README.md. Node 도 cordis 도 쓰지 않는다.

// --- shared/extensions/channel.ts
// shared/extensions/ 의 조각 — 확장 ↔ 앱 통로 — 호출 · 알림 · 패널 이벤트. 쓰는 쪽은 이 조각 파일에서 바로 가져온다
// --- 확장 ↔ 앱 통로 (이슈 #536) ---
// 패널 → parent.postMessage({ litecode: 1, id, method, params }) → 화면의 확장 탭 → IPC extensions:call → 패널이 부를 수 있는 메서드(PANEL_CALL_METHODS)만 ctx.extensions 가 권한 검사 후 처리.
// 확장 id 는 메시지 내용이 아니라 어느 iframe 에서 왔나로 화면이 정한다. 앱 기능(파일 · 대화 · 네트워크 …)은 패널이 직접 부르지 않고 서비스의 host.call 로 부른다 (#1642)
/** 패널이 부를 수 있는 통로 메서드 (#1642) — 서비스 부르기와 UI 전용 표면뿐이다. 나머지 호출 표 메서드(storage · project · chat · network …)는 서비스의 host.call 만 부른다.
 *  이 밖의 이름은 호출 표에 있어도 패널에는 method-unknown */
const PANEL_CALL_METHODS = ['service.call', 'service.list', 'events.subscribe', 'panel.fullscreen', 'settings.open', 'panel.notify', 'panel.args', 'chat.current'];
function isPanelCallMethod(value) {
    return typeof value === 'string' && PANEL_CALL_METHODS.some((method) => method === value);
}
/** 플러그인 알림의 종류 (#1337) */
const EXTENSION_NOTICE_LEVELS = ['info', 'success', 'warning', 'error'];
/** 앱 소식 → 필요한 권한 (null: 권한 없이) (#1336). 패널에는 보내지 않고(#1642), 서비스가 SERVICE_EVENTS 로 고른 것만 받는다 */
const PANEL_EVENT_PERMISSIONS = {
    /** 이 프로젝트의 대화에서 AI 턴이 끝났다 — { conversationId, outcome } */
    'chat.turnEnded': 'chat',
    /** AI 가 이 프로젝트의 파일을 쓰거나 고쳤다 — { paths, truncated? } (0.5초 묶음) */
    'project.filesChanged': 'project',
    /** 사용량 장부가 늘었다 — {} (숫자는 usage.summary) */
    'usage.changed': 'usage',
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
function isAppPanelEvent(event) {
    return isPanelEventName(event.event);
}
/** 통로 메서드의 성공 결과를 화면 동작으로 — 화면이 해야 하는 메서드가 아니거나 모양이 틀리면 undefined */
function uiActionOf(method, result) {
    if (method === 'chat.current')
        return { kind: 'current-conversation' };
    if (method === 'project.openTabs')
        return { kind: 'open-tabs' };
    if (method === 'panel.open')
        return { kind: 'open-panel' };
    if (typeof result !== 'object' || result === null)
        return undefined;
    if (method === 'panel.fullscreen') {
        const on = Reflect.get(result, 'on');
        return typeof on === 'boolean' ? { kind: 'panel-fullscreen', on } : undefined;
    }
    if (method === 'settings.open') {
        const view = Reflect.get(result, 'view');
        const projectName = Reflect.get(result, 'projectName');
        if (!isSettingsView(view) || (projectName !== undefined && typeof projectName !== 'string'))
            return undefined;
        return { kind: 'open-settings', view, ...(projectName !== undefined && { projectName }) };
    }
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

// --- shared/extensions/limits.ts
// 확장 zip 검사의 상한 (이슈 #478) — 값은 여기 한 곳에만 둔다. 검사 함수는 시험용으로 다른 값을 받을 수 있다.
const MB = 1024 * 1024;
/** 근거: 확장은 JS·스킬 마크다운·작은 자산이라 보통 수 MB — 넉넉히 두되, 풀었을 때 디스크를 수 GB 채우는 zip bomb·수만 개 항목은 막는다 */
const EXTENSION_LIMITS = {
    /** skills.writeFile 로 덧씌우는 .md 파일 하나 (2026-11-03) — 사내 표준 같은 문서. 모델이 읽는 글이라 크게 두지 않는다 */
    skillFileBytes: 512 * 1024,
    /** project.writeFile 로 `.litecode/` 에 쓰는 .md 파일 하나 (#1232) — 팀이 커밋하는 표준 문서 같은 글. skillFileBytes 와 같은 근거 */
    projectWriteBytes: 512 * 1024,
    /** zip 파일 자체 크기 — 이보다 크면 목록도 읽지 않는다 */
    zipBytes: 100 * MB,
    /** 항목 수 (폴더 항목 포함) — 목록을 읽기 전에 zip 끝 레코드의 수로 본다 */
    entries: 2000,
    /** 선언된 해제 크기의 합 */
    totalBytes: 200 * MB,
    /** 항목 하나의 선언된 해제 크기 */
    fileBytes: 50 * MB,
    /** extension.json — 메모리로 읽는 유일한 항목이라 따로 작게 */
    manifestBytes: 64 * 1024,
    /** manifest 의 name·description 글자 수 — 카드 제목·설명 한 줄 */
    nameLength: 80,
    descriptionLength: 300,
    /** manifest 의 details(선택, 이슈 #519) — 카드를 펼친 상세에 여러 줄로 보이는 긴 설명. 근거: 게임 규칙·조작법 같은 몇 문단이면 충분하고,
     *  목록(ExtensionSummary)에 실려 확장마다 IPC 로 오가므로 manifestBytes(64KB) 보다 훨씬 작게 둔다 */
    detailsLength: 2000,
    /** 진입 HTML 을 읽어 화면에 보내는 크기 (이슈 #511, readEntry). 근거: 한 파일짜리 HTML(인라인 스크립트·스타일)은 보통 수백 KB 다 — 이 글은 IPC 로 한 번,
     *  iframe srcdoc 에 base64(약 1.33배)로 한 번 더 실리므로 파일 미리보기의 HTML 상한(1MB)의 두 배에서 멈춘다 */
    entryBytes: 2 * MB,
    /** 진입 HTML 이 상대 경로로 적은 같은 zip 의 스크립트 · 스타일시트 · 이미지 (#1339) — 수 · 하나 · 합. 근거: HTML 미리보기의 같은 폴더 자산과 같은 값
     *  (64개 · 하나 4MB · 합 32MB). 설치 검사의 fileBytes(50MB)보다 작게 둔 것은 이 글이 IPC 로 한 번, iframe srcdoc 에 base64 로 한 번 더 실리기 때문이다.
     *  넘는 자산은 패널 전체를 실패시키지 않고 빼기만 한다 */
    panelAssets: 64,
    panelAssetBytes: 4 * MB,
    panelAssetsBytes: 32 * MB,
    /** manifest fileActions (#1341) — 파일 우클릭 메뉴는 짧아야 한다(시안: 맞는 항목 3개까지 바로, 넘으면 하위 메뉴). 플러그인 하나가 메뉴를 채우지 않게
     *  항목 3개 · 메뉴 글 40자(언어 팩 이름 칸과 같은 폭) · 항목 하나의 파일 이름 패턴 10개 · 패턴 하나 64자 */
    fileActions: 3,
    fileActionLabelLength: 40,
    fileActionPatterns: 10,
    fileActionPatternLength: 64,
    // 언어 팩 (이슈 #525) — 번들(JSON)은 부팅·설치 검사·언어 전환 때 메모리로 읽고, 화면에 IPC 로 한 번 보낸다.
    // 근거(2026-10-20 실측): 내장 사전은 1309키, JSON 으로 ko 85KB·en 77KB, 가장 긴 값 745자(en). 한자는 UTF-8 3바이트라 같은 키 수의 중국어도 수백 KB 안이다
    /** 번들 맨 위 키 수 — 지금 키 수의 약 4배(키가 늘어날 여지). 넘으면 번들을 통째로 거절한다 */
    localeKeys: 5000,
    /** 값 하나의 글자 수 — 가장 긴 문구의 약 2.7배. 넘는 값은 버린다(그 키는 en 으로 보인다) */
    localeValueLength: 2000,
    /** 서비스 언어 팩의 label — 설정 > 일반 언어 드롭다운의 한 줄 */
    localeLabelLength: 40,
    // 확장 ↔ 앱 통로 (이슈 #536)
    /** storage 값 전체(확장 하나, JSON 글자 수). 근거: 서버 주소·고른 프로젝트 키·화면 상태 같은 설정이면 수 KB 다. 쓸 때마다 파일 전체를 다시 쓰고
     *  get 마다 IPC 로 오가므로 manifest 상한과 같은 크기에서 멈춘다 — 큰 자료(응답 캐시)는 담지 않는다 */
    storageBytes: 64 * 1024,
    /** secrets 파일 전체(봉한 값의 base64 포함). 근거: 토큰·비밀번호 몇 개 — 봉하면 base64 로 약 1.4배가 되어도 storage 와 같은 상한이면 넉넉하다 */
    secretsBytes: 64 * 1024,
    /** network.fetch 의 기한 — 요청부터 본문 끝까지. 근거: 사내 서버 API 는 보통 1초 안이고, 느린 검색 API 도 몇 초다. 패널이 오래 멈춰 보이지 않게 15초에서 끊는다 */
    fetchTimeoutMs: 15_000,
    /** network.fetch 응답 본문. 근거: JSON API 한 쪽(이슈 500개 페이지)이 수백 KB — 글로 IPC 두 번(메인→화면→iframe) 오가므로 5MB 에서 끊는다 */
    fetchBytes: 5 * MB,
    /** 같은 origin 리다이렉트를 따라가는 횟수 (브라우저는 20 — 로그인 리다이렉트 몇 번이면 충분하다) */
    fetchRedirects: 5,
    /** project.readFile. 근거: 설정 파일(sonar-project.properties 등)을 읽는 용도라 수 KB — 소스 파일 하나도 대부분 들어가는 256KB */
    projectFileBytes: 256 * 1024,
    /** project.pickPath (이슈 #538, QA 03_qa_538) — 고르기 창은 앱 창에 모달로 붙는다. 확장이 취소된 창을 곧바로 다시 띄우면 사용자가 그 확장을 끄러 갈
     *  틈이 없다. 이 사이에 두 번 연달아 취소하면 pickBlockMs 동안 열지 않는다. 근거: 사람이 실수로 취소하고 다시 고르는 데는 몇 초면 되고,
     *  되풀이를 알아채고 설정 > 기능에서 끄기에는 30초면 넉넉하다 */
    /** chat.compose 의 글 길이 (이슈 #557) — 이슈 여러 개를 담은 요청 글이 넉넉히 들어가고, 입력창이 버거워지지 않는 정도 */
    composeChars: 20_000,
    /** project.listDir 한 번에 돌려줄 항목 수 (이슈 #548) — 패널의 폴더 트리 한 단계. 그 이상은 truncated 로 알린다 */
    listDirEntries: 1000,
    /** project.findFiles · countFiles 가 한 번에 훑는 항목 수 (2026-11-03) — 큰 저장소에서 멈추지 않게. 넘으면 truncated */
    walkEntries: 200_000,
    /** project.findFiles 결과 수 — 기본 · 최대 */
    findFilesDefault: 200,
    findFilesMax: 500,
    /** project.countFiles 가 세는 최대 파일 수 */
    countFilesMax: 100_000,
    pickCancelWindowMs: 10_000,
    pickBlockMs: 30_000,
    /** panel.notify · 도구 결과의 notify (#1337) — 알림 한 장의 제목 · 본문 글자 수. 근거: 토스트는 몇 초 머무는 한두 줄이라 manifest 의 name·description 과 같은 길이 */
    noticeTitleLength: 80,
    noticeBodyLength: 300,
    /** 플러그인 하나가 noticeWindowMs 안에 낼 수 있는 알림 수 — 넘으면 notify-limit. 근거: "분석 끝" 같은 소식은 몇 분에 한 번이고, 되풀이해 화면을 덮지 못하게 */
    noticesPerWindow: 5,
    noticeWindowMs: 60_000,
    /** panel.open — 한 플러그인이 이 시간 안에 패널을 열 수 있는 것은 한 번(넘으면 panel-open-limit). 근거: 답이 연달아 와도 사용자가 보던 탭이 계속 바뀌지 않게, 몇 초면 한 번 본 탭을 읽을 만하다 */
    panelOpenWindowMs: 10_000,
};

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
/** 서비스가 host.call 로 부를 수 있는 통로 메서드 — 앱의 호출 표(CALL_TABLE)와 같은 이름이고, 권한 검사도 그 표가 한다(manifest permissions).
 *  llm.ask { prompt } → { text } 는 앱의 기본 모델에 한 번 묻는다(llm 권한 필요, 위 LLM_ASK_* 제한 — 횟수·동시 수 넘으면 llm-limit).
 *  빠진 것: secrets.get(서비스는 비밀을 읽지 않는다 — 비밀은 ${secret:}→mcp.env 로만 자식 프로세스에 전달된다, 쓰기·지우기 secrets.set · secrets.delete 는 된다), 그리고 서비스에 뜻이 없는 panel.args(파일 메뉴로 그 탭에 넘어온 값을 패널이 읽는 것) · events.subscribe(서비스는 ctx.on) · service.call · service.list(자기 자신).
 *  화면이 해야 끝나는 것(SERVICE_UI_METHODS — panel.fullscreen · panel.open · settings.open 포함)도 허용한다 — 메인이 그 프로젝트 폴더의 창에 화면 동작을 보내고 답을 받는다. 보이는 그 플러그인 탭이 없으면 no-window. project.pickPath 는 부모 없는 고르기 창을 띄운다.
 *  호출 표에 메서드가 늘면 여기에 넣을지 빼놓을지 정해야 한다 — tests/unit/arch/pluginServiceApi.test.ts */
const SERVICE_CALL_METHODS = [
    'storage.get',
    'storage.set',
    'storage.delete',
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
    'mcp.call',
    'mcp.status',
    'usage.summary',
    'panel.notify',
    'panel.fullscreen',
    'panel.open',
    'settings.open',
    'llm.ask',
];
/** 호출이 통과하면 그 프로젝트의 창이 해야 끝나는 것 — 메인이 화면 동작(ExtensionUiAction)을 보내고 창의 답을 기다린다. 답이 없으면(창이 없다) no-window.
 *  new 대화 · 대화 열기 · 파일 열기는 null, chat.current · project.openTabs 는 화면이 준 값을 돌려준다 */
const SERVICE_UI_METHODS = ['chat.compose', 'chat.open', 'project.openFile', 'chat.current', 'project.openTabs', 'panel.fullscreen', 'panel.open', 'settings.open'];
function isServiceCallMethod(value) {
    return typeof value === 'string' && SERVICE_CALL_METHODS.some((method) => method === value);
}
/** 근거: 진행 상황 · 상태 요약 같은 작은 값이 목적이다. 큰 자료는 service.call 로 당겨 가게 */
const PANEL_PUSH_MAX_BYTES = 64 * 1024;
/** 근거: 화면 갱신이 1초에 몇 번이면 충분하다 — 넘으면 말없이 버린다(마지막 값이 필요하면 서비스가 모아 보낸다) */
const PANEL_PUSH_MAX_PER_SECOND = 20;
// llm.ask (#1678) — 앱의 기본 모델에 한 번 묻고 답 글을 받는다. 남용 제한의 숫자
/** 근거: 한두 쪽 글을 요약·분류하기에 넉넉한 양(수천 토큰)이고, 큰 자료는 플러그인이 쪼개 묻게 한다 */
const LLM_ASK_MAX_PROMPT_BYTES = 32 * 1024;
/** 근거: 한 번 묻고 받는 답은 요약·분류·짧은 글 수준이다 — 질문 상한과 같게 두면 한 번에 나오는 글이 화면·저장에 부담이 되지 않는다 */
const LLM_ASK_MAX_ANSWER_BYTES = 32 * 1024;
/** 근거: 대화 제목(15초)보다 긴 답을 받지만, 한 번 묻기가 대화 턴처럼 오래 붙잡지 않게 1분에서 멈춘다 */
const LLM_ASK_TIMEOUT_MS = 60_000;
/** 근거: 사용자가 쓰는 대화와 같은 모델·게이트웨이를 나눠 쓰므로, 플러그인 하나가 1분에 열 번(6초에 한 번 꼴)이면 일반 쓰임에는 충분하고 반복문 폭주는 막힌다 */
const LLM_ASK_MAX_PER_WINDOW = 10;
const LLM_ASK_WINDOW_MS = 60_000;
/** 근거: 한 번이 최대 1분 가므로 횟수 제한만으로는 임시 세션이 열 개까지 겹친다 — 둘이면 "하나 돌리며 다음 준비"에 충분하고, 사용자 대화 턴이 엔진·게이트웨이에서 밀리지 않는다 */
const LLM_ASK_MAX_CONCURRENT = 2;

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
const OVERLAY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
/** 덧씌움 경로 — 스킬 폴더 안 하위 경로(`references/guide.md`): 글자·숫자·. _ - 로 된 2~4단, .md 로 끝난다. 폴더 밖(..)·절대 경로·SKILL.md(1단이라 못 온다)는 undefined */
function skillOverlayPath(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const parts = raw.split('/');
    if (parts.length < 2 || parts.length > 4 || !parts.every((part) => OVERLAY_SEGMENT.test(part) && part !== '..'))
        return undefined;
    return /\.md$/i.test(raw) ? raw : undefined;
}
/** 덧씌울 글 — 비어 있지 않은 글, 한 파일 상한(skillFileBytes) 이하. 아니면 ServiceCallError */
function skillOverlayText(raw) {
    if (typeof raw !== 'string' || raw.trim() === '')
        throw new ServiceCallError('params-invalid');
    if (new TextEncoder().encode(raw).length > EXTENSION_LIMITS.skillFileBytes)
        throw new ServiceCallError('file-too-large');
    return raw;
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
/** 도구 이름 규칙 — 소문자·숫자·`-`·`_`, 첫 글자 소문자 */
const SERVICE_TOOL_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const SERVICE_TOOL_DESCRIPTION_MAX = 4_000;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** AI 에 보이는 도구 이름 — `<플러그인 id>_<이름>` */
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
/** host.fetch (#1614) — host.call('network.fetch') 를 Response 모양으로 감싼 것뿐이라 규칙이 그대로다: network 권한 · 사용자가 허용한 주소(없으면 허용 대기에 올리고 consent-required, 거부했거나 대기가 가득 차면 network-denied — 사용자는 설정 > 플러그인 카드에서 정한다, #1642) ·
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
    const allowedOrigins = options.allowedOrigins === undefined ? undefined : new Set(options.allowedOrigins);
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
    const grammarList = [];
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
    /** host.skills 의 readFile · writeFile · deleteFile — 폴더(dir)로 올린 스킬에만, 얹은 글은 메모리에 둔다(스킬 폴더에 든 원래 파일은 읽지 않는다) */
    const overlays = new Map();
    const overlayKey = (skill, relativePath) => {
        const rel = skillOverlayPath(relativePath);
        if (rel === undefined || !skills.some((item) => item.name === skill && 'dir' in item))
            throw new ServiceCallError('params-invalid');
        return `${skill}/${rel}`;
    };
    const overlayGate = async (directory) => {
        if (scope !== 'app' && (directory === undefined || !(await enabledIn(directory))))
            throw new ServiceCallError('not-on');
    };
    const skillOverlay = {
        readFile: async (skill, relativePath) => overlays.get(overlayKey(skill, relativePath)),
        writeFile: async (skill, relativePath, content, options) => {
            const text = skillOverlayText(content);
            const key = overlayKey(skill, relativePath);
            await overlayGate(options?.directory);
            overlays.set(key, text);
        },
        deleteFile: async (skill, relativePath, options) => {
            const key = overlayKey(skill, relativePath);
            await overlayGate(options?.directory);
            overlays.delete(key);
        },
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
        dir: options.dir ?? '/fake/plugin',
        grammars: {
            register: (grammar) => {
                if (scope !== 'app')
                    throw new Error('host.grammars.register is only for services with scope "app"');
                if (grammarList.some((other) => other.id === grammar.id))
                    throw new Error(`host.grammars.register: duplicate grammar id: ${grammar.id}`);
                return track(grammarList, grammar);
            },
        },
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
        skills: {
            register: (skill) => markdown('skills', skills, skill),
            ...skillOverlay,
        },
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
            const origin = allowedOrigins && method === 'network.fetch' ? originOf(params) : undefined;
            if (allowedOrigins && origin !== undefined && !allowedOrigins.has(origin))
                throw new ServiceCallError('consent-required', origin);
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
        /** 사용자가 그 주소를 허용한 것처럼 목록에 더한다 — allowedOrigins 를 줬을 때, 다음 host.fetch 부터 통한다 */
        allowOrigin(origin) {
            allowedOrigins?.add(origin);
        },
        /** host.call 로 부른 것의 기록 — 허용 앞문을 지난 것만 */
        calls: callLog,
        /** host.panel.emit 으로 밀어 보낸 소식 — 이름은 `service.<이름>`, 값은 JSON 으로 복사된 것(상한을 넘은 것은 버려져 없다) */
        pushes: () => [...pushed],
        /** host.settings 가 돌려주는 값 — 바꾸면 다음 호출부터 반영 */
        settings,
        /** host.locale.register 로 올려 둔 언어 팩 — 해제하면 빠진다 */
        locales: () => [...locales],
        /** host.grammars.register 로 올려 둔 문법 — 해제하면 빠진다 */
        grammars: () => [...grammarList],
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
/** network.fetch 의 params.url 이 가리키는 origin — 주소가 아니면 undefined(그대로 handler 가 받는다) */
function originOf(params) {
    const url = typeof params === 'object' && params !== null && 'url' in params ? params.url : undefined;
    if (typeof url !== 'string')
        return undefined;
    try {
        return new URL(url).origin;
    }
    catch {
        return undefined;
    }
}
function isCallMethod(method) {
    return isServiceCallMethod(method);
}
function isInjectKey(key) {
    return SERVICE_INJECT_ALLOWLIST.some((allowed) => allowed === key);
}
