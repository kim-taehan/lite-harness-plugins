import { describe, expect, it } from 'vitest'
import { OracleAdapter, oracleConfig, oraclePlanSteps, placeholderBinds, withPlanStatsHint, type OracleConnection } from '../server/adapters/oracle.ts'
import { blankLiterals } from '../server/guard.ts'
import { RowChecksum } from '../server/checksum.ts'
import { schemaName } from '../server/types.ts'

// SQL 튜닝 MCP 의 DB 어댑터 (#1051) — 가짜 드라이버로 보내는 SQL 과 결과 바꾸기를 본다 (실물 DB 는 쓰지 않는다)

describe('Oracle', () => {
  it('oracle://user:pass@host:port/service → 접속 설정', () => {
    expect(oracleConfig('oracle://tuner:p%40ss@db.local:1522/FREEPDB1')).toEqual({ user: 'tuner', password: 'p@ss', connectString: 'db.local:1522/FREEPDB1' })
    expect(oracleConfig('oracle://tuner:x@db/FREEPDB1').connectString).toBe('db:1521/FREEPDB1')
    expect(() => oracleConfig('oracle://db:1521/')).toThrow('oracle://user:password@host:1521/service')
  })

  it('PLAN_TABLE 행 → 단계 (연산 + 옵션, 소유자.이름)', () => {
    expect(oraclePlanSteps([[0, null, 0, 'SELECT STATEMENT', null, null, null, 120, 5, null, null], [1, 0, 1, 'TABLE ACCESS', 'FULL', 'SHOP', 'CUSTOMERS', 118, 5, null, '"EMAIL"=:1']])).toEqual([
      { id: 0, parentId: null, depth: 0, operation: 'SELECT STATEMENT', cost: 120, rows: 5 },
      { id: 1, parentId: 0, depth: 1, operation: 'TABLE ACCESS FULL', object: 'SHOP.CUSTOMERS', cost: 118, rows: 5, filter: '"EMAIL"=:1' },
    ])
  })

  it('EXPLAIN PLAN 의 빈 바인드 — 이름은 한 번씩, 숫자는 순서대로, 문자열 속 :는 건너뛴다', () => {
    const named = "SELECT * FROM t WHERE id = :id AND n BETWEEN :first + 1 AND :first + :size AND d = TO_DATE('10:30', 'HH24:MI')"
    expect(placeholderBinds(named, blankLiterals(named))).toEqual({ id: null, first: null, size: null })
    const positional = 'SELECT * FROM t WHERE a = :1 AND b = :2'
    expect(placeholderBinds(positional, blankLiterals(positional))).toEqual([null, null])
    expect(placeholderBinds('SELECT 1 FROM dual', 'SELECT 1 FROM dual')).toEqual({})
  })

  it('GATHER_PLAN_STATISTICS 힌트는 주석 뒤 첫 SELECT 에', () => {
    const sql = '/* select */ SELECT * FROM t'
    expect(withPlanStatsHint(sql, blankLiterals(sql))).toBe('/* select */ SELECT /*+ GATHER_PLAN_STATISTICS */ * FROM t')
    // 사용자 힌트가 있으면 같은 주석 안에 — 두 번째 힌트 주석은 Oracle 이 무시한다 (#1076)
    const hinted = 'SELECT /*+ FULL(a) */ COUNT(*) FROM t a'
    expect(withPlanStatsHint(hinted, blankLiterals(hinted))).toBe('SELECT /*+ GATHER_PLAN_STATISTICS FULL(a) */ COUNT(*) FROM t a')
  })

  function fakeOracle(): { connection: OracleConnection; sent: string[]; rolledBack: () => number } {
    const sent: string[] = []
    let rollbacks = 0
    const connection: OracleConnection = {
      callTimeout: 0,
      async execute(sql) {
        sent.push(sql.replace(/\s+/g, ' ').trim())
        if (sql.includes('FROM plan_table')) return { rows: [[0, null, 0, 'SELECT STATEMENT', null, null, null, 10, 1, null, null]] }
        if (sql.includes('DBMS_XPLAN')) return { rows: [['Plan hash value: 1'], ['| 0 | SELECT STATEMENT |']] }
        return { rows: [['A', 1]], metaData: [{ name: 'GRADE' }, { name: 'N' }] }
      },
      async rollback() {
        rollbacks++
      },
      async close() {},
    }
    return { connection, sent, rolledBack: () => rollbacks }
  }

  it('explain — EXPLAIN PLAN → PLAN_TABLE → DBMS_XPLAN, 끝나면 ROLLBACK · 접속은 한 번 열고 다시 쓴다', async () => {
    const fake = fakeOracle()
    let opened = 0
    const adapter = new OracleAdapter(async () => ({ getConnection: async () => (opened++, fake.connection) }), 'oracle://tuner:x@db:1521/FREEPDB1', { timeoutMs: 7000 })
    const plan = await adapter.explain('SELECT * FROM shop.orders')
    expect(fake.sent[0]).toMatch(/^EXPLAIN PLAN SET STATEMENT_ID = 'lc_\w+' FOR SELECT \* FROM shop\.orders$/)
    expect(fake.sent[1]).toContain('FROM plan_table WHERE statement_id = :id')
    expect(fake.sent[2]).toContain("DBMS_XPLAN.DISPLAY('PLAN_TABLE', :id, 'TYPICAL')")
    expect(plan.steps).toHaveLength(1)
    expect(plan.text).toBe('Plan hash value: 1\n| 0 | SELECT STATEMENT |')
    expect(fake.rolledBack()).toBe(1)
    expect(fake.connection.callTimeout).toBe(7000)
    await adapter.explain('SELECT 1 FROM dual')
    expect(opened).toBe(1)
  })

  it('query — ROLLBACK · SET TRANSACTION READ ONLY 뒤에 실행, 행 수 +1 로 잘림을 안다', async () => {
    const fake = fakeOracle()
    const adapter = new OracleAdapter(async () => ({ getConnection: async () => fake.connection }), 'oracle://tuner:x@db:1521/FREEPDB1', { timeoutMs: 7000 })
    expect(await adapter.query('SELECT grade, 1 n FROM shop.customers', 1)).toEqual({ columns: ['GRADE', 'N'], rows: [['A', 1]], truncated: false })
    expect(fake.sent[0]).toBe('SET TRANSACTION READ ONLY')
    expect(fake.rolledBack()).toBe(2) // 앞에 열린 트랜잭션을 닫고(SET TRANSACTION 은 첫 문장), 끝나고 한 번 더
  })

  it('접속에 실패하면 다음 호출에서 다시 잇는다', async () => {
    let tries = 0
    const fake = fakeOracle()
    const adapter = new OracleAdapter(
      async () => ({
        getConnection: async () => {
          if (++tries === 1) throw new Error('ORA-12541: no listener')
          return fake.connection
        },
      }),
      'oracle://tuner:x@db:1521/FREEPDB1',
      { timeoutMs: 1000 },
    )
    await expect(adapter.explain('SELECT 1 FROM dual')).rejects.toThrow('ORA-12541')
    await expect(adapter.explain('SELECT 1 FROM dual')).resolves.toMatchObject({ steps: [{ id: 0 }] })
  })
})

describe('결과 체크섬', () => {
  it('행 순서와 상관없고, 값이 다르면 달라진다', () => {
    const sum = (rows: unknown[][]) => {
      const checksum = new RowChecksum()
      for (const row of rows) checksum.add(row)
      return checksum.value()
    }
    expect(sum([[1, 'a'], [2, 'b']])).toBe(sum([[2, 'b'], [1, 'a']]))
    expect(sum([[1, 'a'], [2, 'b']])).not.toBe(sum([[1, 'a'], [2, 'c']]))
    expect(sum([[new Date(0), 10n]])).toHaveLength(16)

    // 드라이버 객체(순환 참조) · 바이트도 깨지지 않는다
    class Lob { self = this }
    expect(sum([[new Lob(), Buffer.from('ab')]])).toHaveLength(16)
  })

  it('ordered() 는 순서까지 본다 — 같은 행 · 다른 순서면 달라진다', () => {
    const ordered = (rows: unknown[][]) => {
      const checksum = new RowChecksum()
      for (const row of rows) checksum.add(row)
      return checksum.ordered()
    }
    expect(ordered([[1, 'a'], [2, 'b']])).toBe(ordered([[1, 'a'], [2, 'b']]))
    expect(ordered([[1, 'a'], [2, 'b']])).not.toBe(ordered([[2, 'b'], [1, 'a']]))
  })
})

describe('Oracle measure', () => {
  it('행을 끝까지 읽어 수 · 체크섬, 논리 읽기는 앞뒤 차이, 상한에서 멈추면 partial', async () => {
    let reads = 100
    const batches = [[[1], [2], [3]], []]
    const connection: OracleConnection = {
      callTimeout: 0,
      async execute(sql) {
        if (sql.includes('v$mystat')) return { rows: [[(reads += 50)]] }
        let i = 0
        return { resultSet: { getRows: async () => batches[i++] ?? [], close: async () => undefined } }
      },
      async rollback() {},
      async close() {},
    }
    const adapter = new OracleAdapter(async () => ({ getConnection: async () => connection }), 'oracle://tuner:x@db:1521/FREEPDB1', { timeoutMs: 1000 })
    expect(await adapter.measure('SELECT id FROM t', undefined, 10)).toMatchObject({ rows: 3, buffers: 50 })
    expect(await adapter.measure('SELECT id FROM t', undefined, 2)).toMatchObject({ rows: 2, partial: true })
  })
})

describe('기본 스키마 (SQL_TUNING_SCHEMA)', () => {
  it('평범한 이름만 받는다', () => {
    expect(schemaName('COM')).toBe('COM')
    expect(schemaName(undefined)).toBeUndefined()
    expect(() => schemaName('com; drop')).toThrow('not a plain schema name')
  })

  it('Oracle 은 접속 때 CURRENT_SCHEMA', async () => {
    const sent: string[] = []
    const connection: OracleConnection = { callTimeout: 0, execute: async (sql) => (sent.push(sql.replace(/\s+/g, ' ').trim()), { rows: [] }), rollback: async () => undefined, close: async () => undefined }
    await new OracleAdapter(async () => ({ getConnection: async () => connection }), 'oracle://tuner:x@db:1521/FREEPDB1', { timeoutMs: 1000, schema: 'COM' }).query('SELECT 1 FROM dual', 1)
    expect(sent[0]).toBe('ALTER SESSION SET CURRENT_SCHEMA = COM')
  })
})
