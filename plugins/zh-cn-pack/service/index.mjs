// 中文(简体) 언어 팩 서비스 (0.2.0) — 번역(locale.json)을 번들에 넣어 앱에 올린다. 서비스를 끄거나 지우면 등록한 번역도 같이 걷힌다.
// 앱은 내장 사전에 없는 키 · 너무 긴 값을 말없이 버린다(옛 언어 팩과 같은 거름).
import messages from '../locale.json'

export default (host) =>
  class ZhCnPack extends host.Service {
    constructor(ctx) {
      super(ctx)
      host.locale.register({ language: 'zh-CN', label: '中文(简体)', messages })
    }
  }
