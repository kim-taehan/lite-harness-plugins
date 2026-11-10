// 기록 저장소 클라이언트 — 앱이 서버를 띄우며 준 환경변수(LITECODE_DB_URL · LITECODE_DB_TOKEN)로 만든다. 없으면(앱 밖 직접 실행 · CI · 옛 앱) undefined.
// 클라이언트 원본은 저장소 루트 sdk/ 의 사본(`npm run sync:sdk`)이다 — 서버 번들(server/ui-test.mjs)에만 묶이고 서비스 번들(service.mjs)에는 들어가지 않는다.
export { createDbClient } from '../../../sdk/litecode-db-client.mjs'
