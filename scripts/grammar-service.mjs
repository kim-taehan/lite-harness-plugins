// 문법 팩 서비스 (#1614) — 문법 팩 서비스가 같이 쓰는 한 줄짜리 본체. 각 팩의 service/index.mjs 가 자기 grammars.json 을 넘겨 부른다.
// 앱이 넘기는 host 로 만든 클래스를 돌려준다(cordis 를 가져오지 않는다). 올릴 때 선언한 문법을 파일 개요에 올리고, 서비스를 끄거나 지우면 걷힌다.
// wasm 은 manifest 때와 같이 "플러그인 폴더 기준 상대 경로" 를 준다 — 앱이 설치 폴더 안의 일반 파일인지 검사해 싣는다(host.dir 로 경로를 만들 필요 없다).
export function grammarService(grammars) {
  return (host) =>
    class GrammarPack extends host.Service {
      constructor(ctx) {
        super(ctx)
        for (const grammar of grammars) host.grammars.register(grammar)
      }
    }
}
