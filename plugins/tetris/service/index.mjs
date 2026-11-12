// 테트리스 서비스 — 최고 점수를 들고 있다. 패널을 닫아도 남고, 앱을 다시 켜도 이어진다.
// 패널은 service.call 로 `best` 를 읽고 게임이 끝나면 `submit` 으로 점수를 알린다.
// cordis 를 가져오지 않는다: 앱이 넘겨 주는 host 로 만든다(표준 24번).
const STORAGE_KEY = 'best'

/** 패널이 보낸 값을 0 이상의 정수로 — 아니면 null */
const asScore = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null)

export default (host) =>
  class Tetris extends host.Service {
    best = { score: 0, lines: 0 }

    constructor(ctx) {
      super(ctx)
      this.loaded = this.load()
      this.expose('best', async () => {
        await this.loaded
        return { best: this.best.score }
      })
      this.expose('submit', async (params) => {
        await this.loaded
        const score = asScore(params?.score)
        if (score === null) throw new Error('score-invalid')
        if (score > this.best.score) {
          this.best = { score, lines: asScore(params?.lines) ?? 0 }
          await host.call('storage.set', { key: STORAGE_KEY, value: this.best })
          return { best: score, record: true }
        }
        return { best: this.best.score, record: false }
      })
    }

    async load() {
      try {
        const saved = await host.call('storage.get', { key: STORAGE_KEY })
        const score = asScore(saved?.score)
        if (score !== null) this.best = { score, lines: asScore(saved.lines) ?? 0 }
      } catch {
        /* 저장 칸을 못 읽으면 0 에서 다시 시작한다 */
      }
    }
  }
