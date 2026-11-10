// store · reindex 시험용 — SDK 가짜 host 의 host.db(진짜 앱과 같은 처리기)를 서버용 Db 모양으로 맞춘다
import { createFakeHost } from '../../../sdk/litecode-service-testing.mjs'
import type { Db, DbOp } from '../server/store.ts'

const DIR = '/work/shop'

export function fakeDb(limits?: Record<string, number>): { db: Db; calls: { method: string }[] } {
  const fake = createFakeHost({ id: 'ui-test', scope: 'project', ...(limits && { dbLimits: limits }) })
  fake.enableProject(DIR)
  const host = fake.host.db!
  const options = { directory: DIR }
  const calls: { method: string }[] = []
  const track = <T>(method: string, run: () => Promise<T>): Promise<T> => (calls.push({ method }), run())
  const db: Db = {
    get: (c, id) => track('get', () => host.get(c, id, options)),
    set: (c, id, doc) => track('set', () => host.set(c, id, doc, options)),
    delete: (c, id) => track('delete', () => host.delete(c, id, options)),
    list: (c, params) => track('list', () => host.list(c, params, options)),
    batch: (ops: DbOp[]) => track('batch', () => host.batch(ops, options)),
    usage: () => track('usage', () => host.usage(options)),
  }
  return { db, calls }
}
