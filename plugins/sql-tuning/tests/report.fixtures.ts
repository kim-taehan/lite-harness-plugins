// 결과서 시험용 입력 — 시안(sql-tuning-report.html)의 두 시나리오
import type { ReportInput } from '../server/report.ts'

export const win: ReportInput = {
  verdict: 'ok',
  target: 'OrderMapper.selectRecentOrders',
  kind: 'MyBatis 매퍼',
  project: 'shop-api',
  db: 'oracle',
  schema: 'SHOP',
  source: { file: 'src/main/resources/mapper/OrderMapper.xml', line: 42 },
  original_sql: 'SELECT o.*,\n       c.customer_name\n  FROM orders o\n  JOIN customers c\n    ON c.customer_id = o.customer_id\n WHERE TRUNC(o.ordered_at) >= TRUNC(SYSDATE) - :days\n   AND o.status = :status\n ORDER BY o.ordered_at DESC',
  candidate_sql: 'SELECT o.order_id,\n       o.ordered_at,\n       c.customer_name\n  FROM orders o\n  JOIN customers c\n    ON c.customer_id = o.customer_id\n WHERE o.ordered_at >= TRUNC(SYSDATE) - :days\n   AND o.status = :status\n ORDER BY o.ordered_at DESC',
  diff_note: 'WHERE — 날짜 열에 TRUNC() 를 씌우면 인덱스를 못 씁니다.',
  cost: { before: 4210, after: 380 },
  plan: [
    { what: 'orders 를 읽는 방식', before: { op: 'TABLE ACCESS FULL ORDERS', detail: '1,800,000행 · 비용 3,940' }, after: { op: 'INDEX RANGE SCAN IX_ORDERS_ORDERED_AT', detail: '9,120행 · 비용 33' } },
    { what: '정렬', before: { op: 'SORT ORDER BY', detail: '같음' }, after: { op: 'SORT ORDER BY', detail: '같음' } },
  ],
  plan_full: { before: '| 4 | TABLE ACCESS FULL | ORDERS | 1800000 | 3940 |', after: '|* 4 | INDEX RANGE SCAN | IX_ORDERS_ORDERED_AT | 9120 | 33 |' },
  compare: [
    { label: '최근 7일 · 결제 완료', binds: { days: 7, status: 'PAID' }, original: { rows: 8904, checksum: '7c1e09a4', ms: 1206 }, candidate: { rows: 8904, checksum: '7c1e09a4', ms: 71 } },
    { label: '최근 30일 · 배송', binds: { days: 30, status: 'SHIPPED' }, original: { rows: 41380, checksum: '9b42d0f1', ms: 1842 }, candidate: { rows: 41380, checksum: '9b42d0f1', ms: 96 } },
    { label: '최근 90일 · 취소', binds: { days: 90, status: 'CANCELLED' }, original: { rows: 2617, checksum: 'e5a8316c', ms: 1611 }, candidate: { rows: 2617, checksum: 'e5a8316c', ms: 88 } },
  ],
  index: {
    ddl: 'CREATE INDEX IX_ORDERS_STATUS_ORDERED_AT\n  ON orders (status, ordered_at DESC);',
    write_load: { level: 'low', note: 'INSERT 약 48,000 · UPDATE 약 12,000 건.' },
    other_queries: { level: 'medium', note: '기록된 쿼리 14개 중 3개가 새 인덱스를 고를 수 있습니다.' },
    effect_verified: false,
  },
  standard: { file: '.litecode/sql-standard.md', rules_total: 12 },
  rules: [
    { id: 'SQL-03', text: 'SELECT * 대신 필요한 열만 적는다', status: 'applied', where: '고친 SQL 1~3줄' },
    { id: 'SQL-06', text: '날짜 비교는 범위로 쓴다', status: 'already' },
  ],
  unknown: ['운영과 같은 동시 접속 부하에서의 시간'],
}

export const hold: ReportInput = {
  verdict: 'hold',
  target: 'OrderRepository.findCouponOrders',
  kind: 'JPA @Query',
  project: 'shop-api',
  db: 'postgres',
  schema: 'public',
  original_sql: 'SELECT o.id\n  FROM orders o\n  LEFT JOIN order_coupons oc\n    ON oc.order_id = o.id\n WHERE o.status = :status',
  candidate_sql: 'SELECT o.id\n  FROM orders o\n  JOIN order_coupons oc\n    ON oc.order_id = o.id\n WHERE o.status = :status',
  cost: { before: 6880, after: 1150 },
  compare: [
    { label: '결제 완료', binds: { status: 'PAID' }, original: { rows: 6310, checksum: '31d8a07e', ms: 1402 }, candidate: { rows: 6310, checksum: '31d8a07e', ms: 380 } },
    { label: '결제 대기', binds: { status: 'PENDING' }, original: { rows: 1204, checksum: 'a9f1b6d3', ms: 1842 }, candidate: { rows: 1198, checksum: '5d02c8e7', ms: 412 } },
  ],
  cause: { title: '2번에서 원래에만 있는 6행이 고친 SQL 에서 빠졌습니다', text: 'LEFT JOIN 을 JOIN 으로 바꾸면 쿠폰이 없는 주문이 사라집니다. 어느 6행인지는 확인하지 못했습니다.' },
  rules: [{ id: 'SQL-09', text: '필요 없는 OUTER JOIN 은 INNER JOIN 으로 바꾼다', status: 'failed' }],
  standard: { file: '.litecode/sql-standard.md' },
}
