// Java 언어 서버 서비스 (0.2.0) — 앱에 JDT LS 언어 서버 하나를 올린다(host.lsp.register). 서버를 띄우고 LSP 로 잇는 일은 앱이 한다.
// 옛 manifest `lsp[0]` 선언과 같은 값이다(코드 상수로 옮김). 서비스가 켜지지 않은 프로젝트에서는 앱이 서버를 띄우지 않고, 서비스를 내리면 등록도 서버도 걷힌다.
// 자리표시: args 는 고정 자리표시만(${lspWorkspaceDir} — 폴더 · worktree · 언어마다 따로인 작업 공간), initializationOptions · settings 도 고정 자리표시만.

/** 오프라인 설정 — Maven 은 로컬 저장소(~/.m2)만, Gradle 가져오기는 끔(빌드 스크립트를 실행하므로), 소스 내려받기 끔, 프로젝트 폴더에 메타데이터를 쓰지 않음 */
const JAVA = {
  import: {
    maven: { enabled: true, offline: { enabled: true } },
    gradle: { enabled: false, offline: { enabled: true }, wrapper: { enabled: false } },
    generatesMetadataFilesAtProjectRoot: false,
  },
  maven: { downloadSources: false, updateSnapshots: false },
  eclipse: { downloadSources: false },
  configuration: { updateBuildConfiguration: 'automatic' },
  autobuild: { enabled: true },
  references: { includeDecompiledSources: false },
}

export const JAVA_SERVER = {
  languageId: 'java',
  extensions: ['java'],
  command: 'server/jdtls.mjs',
  args: ['-data', '${lspWorkspaceDir}'],
  env: { JAVA_OPTS: '-Xmx1g' },
  initializationOptions: { settings: { java: JAVA } },
  settings: { java: JAVA },
  /** 쉬면 10분 뒤 내림 */
  idleMs: 600_000,
}

export default (host) =>
  class JavaLsp extends host.Service {
    constructor(ctx) {
      super(ctx)
      host.lsp.register(JAVA_SERVER)
    }
  }
