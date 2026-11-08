# java-lsp — Java 언어 서버

## 역할

동봉한 Java 런타임과 Eclipse JDT LS 로, 인터넷 없이 Java 프로젝트의 오류 · 정의 · 참조 · 설명 · 심볼을 앱(파일 미리보기)과 AI 도구에 줍니다.
언어 서버는 desktop 이 프로젝트 폴더마다 하나 띄워 화면과 AI 가 같이 씁니다 (desktop #1262 의 manifest `lsp` 자리).

- 앱에 닿는 자리: 언어 서버(`lsp`) — 파일 보기의 오류 밑줄 · 마우스 풍선 · 문제 목록, AI 의 `code_*` 도구, 코드 탐색의 정의 · 참조.
- 범위: `"project"` — Java 프로젝트에서만 켜 둔다(언어 서버 하나가 수백 MB~1GB).
- 권한: `lsp` — 앱이 이 선언대로 언어 서버를 띄운다.

## 구성

| 자리 | 무엇 | 어디서 |
|---|---|---|
| `plugin.json` | manifest — `lsp[0]` 선언(아래 "선언") · `lsp` 권한 · `scope` | 이 폴더 |
| `runtime/` | Temurin 25.0.5+8 로 jlink 한 런타임 (Temurin JRE 모듈 전부, 압축) | `fetch-runtime.mjs` 가 Adoptium 에서 받음 (버전 · sha256 고정) |
| `jdtls/` | Eclipse JDT LS 1.63.0 (그 타깃의 `config_*` 만) | `fetch-runtime.mjs` 가 download.eclipse.org 에서 받음 (sha256 고정) |
| `server/jdtls.mjs` | 실행기 — 동봉 런타임으로 JDT LS 를 stdio 로 띄움 | 이 폴더 |
| `fetch-runtime.mjs` · `build.mjs` | 런타임 · JDT LS 받기, 플랫폼별 묶기 | 이 폴더 (zip 에는 안 들어감) |
| `tests/launcher.test.ts` | 실행기 인자 · 오프라인 설정 · 선언 테스트 | 이 폴더 (zip 에는 안 들어감) |

- **Java 25 가 필요합니다.** JDT LS 1.63 의 번들이 `osgi.ee JavaSE 25` 를 요구해 Java 21 로는 뜨지 않습니다.
- JRE 를 그대로 담으면 `lib/modules` 하나가 앱의 플러그인 상한(파일 하나 50MB)을 넘어서 jlink 로 압축합니다. 모듈을 빼지 않는 이유: JDT LS 는
  따로 설정하지 않으면 자기를 띄운 런타임을 프로젝트의 JDK 로도 써서, 빼면 사용자 코드에 가짜 오류가 납니다.
- 크기(darwin-arm64): 풀어서 약 122MB · 항목 440 · zip 약 97MB. 앱 상한(zip 100MB · 항목 2000 · 합 200MB · 파일 하나 50MB)에 가깝습니다 —
  `build.mjs` 가 넘으면 멈춥니다. mac-x64 · win-x64 는 아직 묶어 보지 않았습니다.

## 개발

### 묶기 · 배포

```sh
node plugins/java-lsp/fetch-runtime.mjs                       # 망 밖에서 — build/vendor/java-lsp/<타깃>/
node plugins/java-lsp/build.mjs --platform darwin-arm64        # → build/java-lsp-darwin-arm64.zip
node plugins/java-lsp/build.mjs --platform darwin-arm64 --dir  # → build/java-lsp-darwin-arm64/ (개발 모드에서 연결)
```

플랫폼 전용이라 `npm run release -- java-lsp --platform <p>` 로 올립니다(sonarqube 와 같음).

### 테스트

`npm test -- --project java-lsp` — 실행기(인자 · `JAVA_OPTS` · Gradle 캐시)와 `plugin.json` 의 선언. 언어 서버 동작은 아래 "확인한 것" 처럼 LSP 클라이언트 · 앱에서 본다.

## 실행기

`server/jdtls.mjs -data <작업 공간>` — 앱이 `${lspWorkspaceDir}`(폴더 · worktree · 언어마다 따로)를 줍니다. 같은 작업 공간을 두 JDT LS 가 쓰면 잠금이 충돌합니다.

- JVM 옵션은 `JAVA_OPTS`(없으면 `-Xmx1g`).
- JDT LS 의 `config_*` 는 플러그인 안의 것을 읽기 전용 공유 설정으로 쓰고, 쓰는 설정은 작업 공간 아래 `.jdtls-config` 에 둡니다(플러그인 폴더는 여러 프로젝트가 같이 쓰고 업데이트 때 바뀜).
- **Gradle 버전 목록 요청 막기** — Buildship 은 Gradle 가져오기를 꺼도 시작할 때 `services.gradle.org` 에서 버전 목록을 받습니다(작업 공간의 캐시가 없거나 하루 지났을 때).
  실행기가 띄우기 전에 그 캐시(`<작업 공간>/.metadata/.plugins/org.eclipse.buildship.core/gradle/versions.json`)를 빈 목록으로 두고 날짜를 지금으로 바꿔 바깥 요청이 나가지 않게 합니다(표준 7번).

## 오프라인 설정 (`plugin.json` 의 `lsp[0].initializationOptions` · `settings`)

| 설정 | 값 | 이유 |
|---|---|---|
| `java.import.maven.offline.enabled` | `true` | 로컬 저장소(`~/.m2`)에 있는 것만 씀 — 없는 의존성은 받지 않고 오류로 보임 |
| `java.import.gradle.enabled` | `false` | Gradle 가져오기는 프로젝트의 빌드 스크립트를 **실행**하고, 래퍼가 Gradle 배포판을 내려받으려 함 — 폐쇄망에서 멈추거나 실패하고, 남의 스크립트를 돌리는 일이라 기본으로 끔 |
| `java.import.gradle.offline.enabled` · `wrapper.enabled` | `true` · `false` | Gradle 을 켜는 사용자를 위한 안전값 |
| `java.maven.downloadSources` · `java.eclipse.downloadSources` | `false` | 소스 · javadoc 을 받지 않음 |
| `java.import.generatesMetadataFilesAtProjectRoot` | `false` | `.project` · `.classpath` 를 사용자 프로젝트 폴더에 쓰지 않고 작업 공간에 둠 |

**Maven 프로젝트는 의존성이 없어도** 기본 빌드 플러그인(`maven-resources-plugin` · `maven-compiler-plugin` 등)이 로컬 저장소에 있어야 프로젝트로 구성됩니다.
없으면 JDT LS 가 "Could not calculate build plan" 으로 그 프로젝트를 Java 프로젝트로 못 만들어 오류 · 정의가 하나도 오지 않습니다.
폐쇄망 PC 는 사내 저장소(Nexus 등)로 한 번 `mvn` 빌드해 두면 됩니다 — 사용자 `~/.m2/settings.xml` 을 그대로 씁니다.

## 선언 (`plugin.json`)

`permissions: ["lsp"]` · `scope: "project"` · `lsp[0]` — `languageId: "java"`, `extensions: ["java"]`, `command: "server/jdtls.mjs"`,
`args: ["-data", "${lspWorkspaceDir}"]`(폴더 · 언어마다 따로인 작업 공간), `env.JAVA_OPTS: "-Xmx1g"`, 위 오프라인 설정, `idleMs: 600000`(쉬면 10분 뒤 내림).
`.java` 파일을 파일 보기에서 열거나 AI 가 `code_*` 도구를 부르면 앱이 띄웁니다(그 프로젝트에서 켜졌을 때만).

## 확인한 것 (darwin-arm64)

확인용 LSP 클라이언트(desktop #1262 의 앱 동작 범위: Full 동기화, `didChangeWatchedFiles`, `workspace/configuration` · `registerCapability` · `workDoneProgress/create` 에 답, `applyEdit` 거절)로:

- Maven 예제 두 개(의존성 없음 · commons-lang3 의존성) — 오프라인, 새 작업 공간에서 `publishDiagnostics` · `definition` · `references` · `hover` · `workspace/symbol` 이 답하고, 고친 내용을 Full 로 보내면 오류가 사라짐.
- 시작 → ServiceReady 약 2~3.5초(작은 프로젝트), java RSS 준비 직후 약 380~410MB · 빌드 · 색인 뒤 약 0.9GB(`-Xmx1g`).
- java 프로세스의 바깥 연결: Gradle 버전 목록 캐시를 두기 전에는 `services.gradle.org` 로 한 번, 둔 뒤로는 없음(lsof 로 확인).
