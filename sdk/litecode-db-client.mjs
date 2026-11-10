// 생성물 — 직접 고치지 않는다. 원본: desktop 의 shared/extensions/serviceApi.ts · serviceHostCore.ts · serviceHostFake.ts · serviceDb.ts · dbClient.ts · docQuery.ts · docStore.ts · docMemory.ts · docCall.ts, 만드는 곳: scripts/generate-plugin-sdk.mjs
// 서비스가 올린 MCP 서버 프로세스에서 host.db 를 쓰는 클라이언트 — 사용법은 docs/plugin-sdk/README.md. 의존성이 없고 Node 22 의 fetch 를 쓴다. 서비스 번들(service.main)에는 넣지 않는다 — 설치 검사가 직접 fetch 를 거절한다.

// --- shared/extensions/docQuery.ts
// host.db 의 이름 · 조건 검사와 조건 계산 (참조 평가기) — Node 도 SQLite 도 모른다.
// 가짜 host(메모리)가 이 함수로 조건을 계산하고, 진짜 저장소(src/lib/docStore)는 같은 조건을 SQL 로 번역한다. 둘이 어긋나지 않게
// 같은 사례 표를 양쪽에 돌려 확인한다(tests/unit/lib/docStore/sqliteDocStore.test.ts). 그래서 여기의 규칙이 "정답"이다:
//  · 필드가 없거나 null · 객체 · 배열이면 어떤 조건에도 맞지 않는다(`!=` 도). 값의 종류(글 · 숫자 · 참거짓)가 조건 값과 다르면 맞지 않는다.
//  · 글은 코드 포인트 순(SQLite 의 BINARY 비교와 같다)으로, 숫자는 크기로 비교한다. 참거짓은 `=` `!=` `in` 만 쓴다.
//  · 정렬: 값이 없는 문서(없음 · null · 객체 · 배열) → 숫자·참거짓(거짓 < 참) → 글 순이고, 같으면 id 순. 내림차순은 통째로 뒤집는다.
/** 근거: 컬렉션 이름은 사람이 읽는 몇 마디(runs · tuning.history) — 64자면 넉넉하다 */
const DOC_COLLECTION_MAX_LENGTH = 64;
/** 근거: id 는 UUID · 시각 · 해시 같은 키 — 128자면 넉넉하다 */
const DOC_ID_MAX_LENGTH = 128;
/** 근거: 점 경로 깊이 5 — `meta.size` 같은 한두 단이 보통이다 */
const FIELD_MAX_DEPTH = 5;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
// 마디는 글자나 _ 로 시작한다 — 숫자만 있는 마디(`a.0`)는 SQLite JSON 경로에서 배열 순번과 헷갈린다
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
/** 근거: cursor 는 마지막 문서의 정렬 값(글이면 글 그대로)과 id 를 담는다 — 정렬 값이 긴 글이면 커진다. 4096자면 정렬 필드로 쓰는 글(이름 · 시각 · 상태)에 넘치고, 넘는 문서는 이어 보기를 못 하므로 params-invalid 로 알린다 */
const DOC_CURSOR_MAX_LENGTH = 4096;
const DOC_OPS = ['=', '!=', '<', '<=', '>', '>=', 'in', 'prefix'];
const isDocCollection = (value) => typeof value === 'string' && value.length <= DOC_COLLECTION_MAX_LENGTH && NAME_PATTERN.test(value);
const isDocId = (value) => typeof value === 'string' && value.length <= DOC_ID_MAX_LENGTH && NAME_PATTERN.test(value);
const isDocField = (value) => typeof value === 'string' && FIELD_PATTERN.test(value) && value.split('.').length <= FIELD_MAX_DEPTH;
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 값의 종류 — 조건에 쓰는 것(글 · 숫자 · 참거짓)만. 나머지(없음 · null · 객체 · 배열 · 무한대)는 undefined */
function scalarKind(value) {
    if (typeof value === 'string')
        return 'string';
    if (typeof value === 'boolean')
        return 'boolean';
    return typeof value === 'number' && Number.isFinite(value) ? 'number' : undefined;
}
const isScalar = (value) => scalarKind(value) !== undefined;
/** 문서를 JSON 글로 — JSON 으로 못 바꾸는 값(순환 · BigInt · 함수만 있는 값)이면 undefined. 객체여야 한다 */
function docJson(doc) {
    if (!isJsonObject(doc))
        return undefined;
    try {
        return JSON.stringify(doc);
    }
    catch {
        return undefined;
    }
}
/** 점 경로를 따라 읽는다 — 자기 속성만(상속된 constructor 같은 것은 없는 것) */
function readField(doc, field) {
    let current = doc;
    for (const part of field.split('.')) {
        if (!isJsonObject(current) || !Object.hasOwn(current, part))
            return undefined;
        current = current[part];
    }
    return current;
}
/** 코드 포인트 순 비교 — UTF-16 순서(`<`)는 이모지와 U+E000 이상 글자에서 UTF-8 순서와 갈린다 */
function compareText(a, b) {
    const left = Array.from(a, (char) => char.codePointAt(0) ?? 0);
    const right = Array.from(b, (char) => char.codePointAt(0) ?? 0);
    for (let at = 0; at < left.length && at < right.length; at++) {
        const diff = (left[at] ?? 0) - (right[at] ?? 0);
        if (diff !== 0)
            return diff;
    }
    return left.length - right.length;
}
function compareScalar(a, b) {
    if (typeof a === 'string' && typeof b === 'string')
        return compareText(a, b);
    return Number(a) - Number(b);
}
function conditionHolds(doc, condition) {
    const actual = readField(doc, condition.field);
    const kind = scalarKind(actual);
    if (kind === undefined || !isScalar(actual))
        return false;
    const { op, value } = condition;
    if (op === 'in')
        return Array.isArray(value) && value.some((item) => scalarKind(item) === kind && compareScalar(actual, item) === 0);
    if (Array.isArray(value) || scalarKind(value) !== kind)
        return false;
    if (op === 'prefix')
        return typeof actual === 'string' && typeof value === 'string' && actual.startsWith(value);
    const diff = compareScalar(actual, value);
    if (op === '=')
        return diff === 0;
    if (op === '!=')
        return diff !== 0;
    if (op === '<')
        return diff < 0;
    if (op === '<=')
        return diff <= 0;
    if (op === '>')
        return diff > 0;
    return diff >= 0;
}
/** 조건이 모두 맞나 (AND) */
function docMatches(doc, where) {
    return where.every((condition) => conditionHolds(doc, condition));
}
/** 정렬 값 — rank 0: 값 없음, 1: 숫자 · 참거짓(거짓 0 · 참 1), 2: 글 */
function sortKey(doc, field) {
    const actual = readField(doc, field);
    const kind = scalarKind(actual);
    if (kind === 'string' && typeof actual === 'string')
        return { rank: 2, value: actual };
    if (kind === 'number' && typeof actual === 'number')
        return { rank: 1, value: actual };
    if (kind === 'boolean')
        return { rank: 1, value: actual === true ? 1 : 0 };
    return { rank: 0, value: 0 };
}
/** 문서의 정렬 위치 — 이어 보기 cursor 에 담는다. 정렬이 없으면 id 만 */
function docPosition(entry, field) {
    const key = field === undefined ? { rank: 0, value: 0 } : sortKey(entry.doc, field);
    return { ...key, id: entry.id };
}
function comparePosition(a, b) {
    return a.rank - b.rank || (a.rank === 0 ? 0 : compareScalar(a.value, b.value)) || compareText(a.id, b.id);
}
/** 위치 → cursor 글 (JSON 을 URL 글자로) — 너무 길면 undefined */
function encodeDocCursor(position) {
    const text = encodeURIComponent(JSON.stringify([position.rank, position.value, position.id]));
    return text.length <= DOC_CURSOR_MAX_LENGTH ? text : undefined;
}
function decodeDocCursor(cursor) {
    if (cursor.length > DOC_CURSOR_MAX_LENGTH)
        return undefined;
    try {
        const raw = JSON.parse(decodeURIComponent(cursor));
        if (!Array.isArray(raw) || raw.length !== 3)
            return undefined;
        const [rank, value, id] = raw;
        if (!isDocId(id))
            return undefined;
        if (rank === 0 && value === 0)
            return { rank, value, id };
        if (rank === 1 && typeof value === 'number' && Number.isFinite(value))
            return { rank, value, id };
        if (rank === 2 && typeof value === 'string')
            return { rank, value, id };
        return undefined;
    }
    catch {
        return undefined;
    }
}
/** 조건 · 정렬 · 쪽 나누기 — 참조 평가기. 정렬이 없으면 id 순. more: limit 뒤에 문서가 더 있다 */
function queryDocEntries(entries, query) {
    const field = query.orderBy?.field;
    const sign = query.orderBy?.dir === 'desc' ? -1 : 1;
    const keyed = entries.filter((entry) => docMatches(entry.doc, query.where)).map((entry) => ({ entry, position: docPosition(entry, field) }));
    keyed.sort((a, b) => sign * comparePosition(a.position, b.position));
    const { after } = query;
    const rest = after ? keyed.filter((item) => sign * comparePosition(item.position, after) > 0) : keyed;
    const page = rest.slice(0, query.limit + 1);
    return { docs: page.slice(0, query.limit).map((item) => item.entry), more: page.length > query.limit };
}
const bad = { ok: false };
function parseCondition(raw, limits) {
    if (!isJsonObject(raw) || !isDocField(raw.field))
        return bad;
    const op = DOC_OPS.find((candidate) => candidate === raw.op);
    if (op === undefined)
        return bad;
    const field = raw.field;
    const value = raw.value;
    if (op === 'in') {
        if (!Array.isArray(value) || value.length === 0 || value.length > limits.inValues)
            return bad;
        const first = scalarKind(value[0]);
        const items = value.filter(isScalar);
        // 한 종류만 — 섞으면 SQL 쪽 비교 규칙(종류가 다르면 절대 같지 않음)과 설명이 길어진다
        return first !== undefined && items.length === value.length && items.every((item) => scalarKind(item) === first) ? { ok: true, value: { field, op, value: items } } : bad;
    }
    if (!isScalar(value))
        return bad;
    if (op === 'prefix' && typeof value !== 'string')
        return bad;
    if (typeof value === 'boolean' && op !== '=' && op !== '!=')
        return bad;
    return { ok: true, value: { field, op, value } };
}
function parseOrderBy(raw) {
    if (raw === undefined)
        return { ok: true, value: undefined };
    if (!isJsonObject(raw) || !isDocField(raw.field))
        return bad;
    if (raw.dir !== undefined && raw.dir !== 'asc' && raw.dir !== 'desc')
        return bad;
    return { ok: true, value: { field: raw.field, dir: raw.dir ?? 'asc' } };
}
/** list · query 의 인자 — where · orderBy 는 filters 일 때만(list 는 조건이 없다). 모양이 틀리면 ok: false */
function parseDocQuery(params, limits, filters) {
    const { limit = limits.pageDefault, cursor, where = [], orderBy } = params;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > limits.pageMax)
        return bad;
    const after = cursor === undefined ? undefined : typeof cursor === 'string' ? decodeDocCursor(cursor) : undefined;
    if (cursor !== undefined && !after)
        return bad;
    if (!filters)
        return { ok: true, value: { where: [], limit, ...(after && { after }) } };
    if (!Array.isArray(where) || where.length > limits.conditions)
        return bad;
    const conditions = [];
    for (const raw of where) {
        const parsed = parseCondition(raw, limits);
        if (!parsed.ok)
            return bad;
        conditions.push(parsed.value);
    }
    const order = parseOrderBy(orderBy);
    if (!order.ok)
        return bad;
    return { ok: true, value: { where: conditions, ...(order.value && { orderBy: order.value }), limit, ...(after && { after }) } };
}

// --- shared/extensions/serviceDb.ts
function dbPage(result) {
    if (!isJsonObject(result) || !Array.isArray(result.docs))
        throw new Error('unexpected db reply');
    const docs = result.docs.flatMap((item) => (isJsonObject(item) && typeof item.id === 'string' && isJsonObject(item.doc) ? [{ id: item.id, doc: item.doc }] : []));
    return typeof result.cursor === 'string' ? { docs, cursor: result.cursor } : { docs };
}
function dbUsage(result) {
    if (!isJsonObject(result) || typeof result.bytes !== 'number' || typeof result.docs !== 'number' || typeof result.collections !== 'number' || !isJsonObject(result.limits))
        throw new Error('unexpected db reply');
    const { limits } = result;
    const field = (name) => {
        const value = limits[name];
        if (typeof value !== 'number')
            throw new Error('unexpected db reply');
        return value;
    };
    return {
        bytes: result.bytes,
        docs: result.docs,
        collections: result.collections,
        limits: { docBytes: field('docBytes'), collections: field('collections'), docsPerCollection: field('docsPerCollection'), totalBytes: field('totalBytes'), pageDefault: field('pageDefault'), pageMax: field('pageMax'), batchOps: field('batchOps'), conditions: field('conditions'), inValues: field('inValues') },
    };
}
/** host.db — host.call('db.*') 를 서비스가 쓰기 좋게 감싼 것뿐이다. 진짜 호스트와 가짜 host 가 같이 쓴다 */
function serviceDb(call) {
    return {
        async get(collection, id, options) {
            const result = await call('db.get', { collection, id }, options?.directory);
            if (result === null)
                return null;
            if (!isJsonObject(result))
                throw new Error('unexpected db reply');
            return result;
        },
        async set(collection, id, doc, options) {
            await call('db.set', { collection, id, doc }, options?.directory);
        },
        async delete(collection, id, options) {
            await call('db.delete', { collection, id }, options?.directory);
        },
        async list(collection, params = {}, options) {
            return dbPage(await call('db.list', { collection, ...params }, options?.directory));
        },
        async query(collection, params, options) {
            return dbPage(await call('db.query', { collection, ...params }, options?.directory));
        },
        async batch(ops, options) {
            await call('db.batch', { ops }, options?.directory);
        },
        async usage(options) {
            return dbUsage(await call('db.usage', {}, options?.directory));
        },
    };
}

// --- shared/extensions/dbClient.ts
// 서버(MCP) 프로세스용 host.db 클라이언트 — 앱이 서버를 띄우며 준 환경변수로 앱의 로컬 중계(src/services/extensions/db/relay.ts)에 `db.*` 를 보낸다.
// 서비스의 host.db 와 같은 모양(serviceDb.ts 를 같이 쓴다)이고 오류 코드도 같다. 환경변수가 없으면(옛 앱 · 앱 밖에서 직접 실행 · CI) undefined 라 부르는 쪽이 파일 같은 대체 길로 물러난다.
// 이 파일은 docs/plugin-sdk/litecode-db-client.mjs 로 생성된다(scripts/generate-plugin-sdk.mjs). Node 도 process 도 모른다 — 환경과 fetch 는 부르는 쪽이 준다
export const DB_URL_ENV = 'LITECODE_DB_URL';
export const DB_TOKEN_ENV = 'LITECODE_DB_TOKEN';
/** 서버 프로세스의 db 호출이 실패하면 던지는 오류 — code 는 서비스의 host.db 와 같은 코드(params-invalid · not-on · no-project · doc-too-big · collection-limit · collection-full · db-full · io-failed …).
 *  중계 자체의 실패는 unauthorized(번호표가 틀리거나 서버가 내려간 뒤) · rate-limited · request-too-large · unreachable(앱에 닿지 않음) · bad-reply */
export class DbClientError extends Error {
    code;
    constructor(code) {
        super(`db call failed: ${code}`);
        this.code = code;
        this.name = 'DbClientError';
    }
}
/** rate-limited 를 받으면 Retry-After(초, 상한 1.5초)만큼 기다렸다 최대 3번 다시 시도한다 — 서버는 토큰당 초당 1000번을 넘으면 거절한다 */
const RETRY_MAX = 3;
const RETRY_WAIT_CAP_MS = 1500;
const timerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 환경변수에 주소와 번호표가 다 있으면 클라이언트, 아니면 undefined. options(directory)는 받아도 쓰지 않는다 — 번호표가 프로젝트를 정한다 */
export function dbClientFrom(env, fetchFn, options = {}) {
    const base = env[DB_URL_ENV];
    const token = env[DB_TOKEN_ENV];
    if (!base || !token)
        return undefined;
    const root = base.replace(/\/+$/, '');
    const { signal } = options;
    const sleep = options.sleep ?? timerSleep;
    const send = async (method, params) => {
        if (signal?.aborted)
            throw new DbClientError('aborted');
        try {
            return await fetchFn(`${root}/${method.replace('.', '/')}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
                body: JSON.stringify(params),
                ...(signal && { signal }),
            });
        }
        catch {
            throw new DbClientError(signal?.aborted ? 'aborted' : 'unreachable');
        }
    };
    return serviceDb(async (method, params) => {
        let response = await send(method, params);
        for (let retry = 0; response.status === 429 && retry < RETRY_MAX; retry += 1) {
            const seconds = Number(response.headers.get('retry-after'));
            await sleep(Math.min(RETRY_WAIT_CAP_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RETRY_WAIT_CAP_MS));
            response = await send(method, params);
        }
        const reply = await response.json().catch(() => undefined);
        const error = isJsonObject(reply) && typeof reply.error === 'string' ? reply.error : undefined;
        if (response.status !== 200)
            throw new DbClientError(error ?? 'bad-reply');
        if (!isJsonObject(reply))
            throw new DbClientError('bad-reply');
        if (reply.ok === true)
            return reply.result;
        throw new DbClientError(error ?? 'bad-reply');
    });
}

// --- createDbClient (이 생성 스크립트가 덧붙인다 — 환경과 fetch 를 Node 에서 가져온다)
/** 서버(MCP) 프로세스에서 host.db 를 쓰는 클라이언트 — 앱이 준 환경변수(LITECODE_DB_URL · LITECODE_DB_TOKEN)가 없으면 undefined(앱 밖에서 직접 실행 · CI · 옛 앱 → 파일 같은 대체 길로) */
export function createDbClient(env = process.env, fetchFn = globalThis.fetch, options = {}) {
  return dbClientFrom(env, fetchFn, options)
}
