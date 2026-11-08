// 턴 세기 서비스 — chat.turnEnded 가 올 때마다 그 프로젝트(directory)의 횟수를 올린다.
// cordis 를 import 하지 않는다: 앱이 넘겨 주는 Service 로 클래스를 만든다(설치형 서비스 호스트 API, api 1).
export default ({ Service }) =>
  class TurnCounter extends Service {
    turns = new Map()

    constructor(ctx) {
      super(ctx)
      ctx.on('chat.turnEnded', ({ directory }) => {
        if (typeof directory === 'string') this.turns.set(directory, (this.turns.get(directory) ?? 0) + 1)
      })
      // 패널이 service.call { name: 'count' } 로 묻는다 — 두 번째 인자 { directory? } 는 호출한 프로젝트, 폴더를 모르면 directory 가 없다
      this.expose('count', (_params, { directory } = {}) => ({ turns: directory === undefined ? 0 : (this.turns.get(directory) ?? 0) }))
    }
  }
