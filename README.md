# lite-harness-plugins

**English** · [한국어](README.ko.md)

**The distribution repository for Lite Harness — app installers and extensions in one place.**

This repository ships two things:

| What | Where |
|---|---|
| App installers (mac arm64 · mac x64 · win x64) | GitHub Releases tagged `app-v<version>` |
| Extensions | Sources in `plugins/<id>/`; published to the **litecode-deploy server** (see [Layout](#layout)) |

Extensions for Lite Harness (the desktop app) are installed from the litecode-deploy server. Once the app has the update server address, it reads the server's `catalog.json`, lists the extensions under [Browse plugins], installs one on click, and offers an update when a new version lands. Installing from a zip file (Settings › Features › Add plugin (zip)) still works as before.

## The problem

Extensions change far more often than the app. Bundle them into the app and every fix to a game or a language pack means rebuilding and redistributing the app. Stand up a separate extension marketplace server instead and it can't be reached from a closed network — and it's one more service to run. Hand zips around manually and nobody knows who runs which version or whether the file they got is the right one.

## The idea

Keep the sources in this repository and publish zips to a small server (litecode-deploy) that serves the catalog.

1. **The server makes the catalog** — `catalog.json` (id, version, zip path, sha256, changes), the sequence number and the signature are all produced by the server when a zip is published. That's all the app needs to browse, install and update.
2. **Read-only server** — the app only issues `GET`s. There is no admin screen or write API; publishing is a CLI run on the server PC.
3. **Sources here, outputs on the server** — `npm run release` builds zips from `plugins/<id>/` and hands them to `litecode-deploy plugin publish`. Extensions that need a build step (bundling an MCP server, shipping a runtime) go out with the same command.
4. **Trust the hash and the version** — a downloaded zip is installed only if it matches the catalog's sha256, and updates are offered only for higher versions. If permissions grow, the user is asked again. The server can sign entries (ed25519) so the app can verify them.
5. **Rollback and take-down on the server** — `plugin rollback` restores the catalog as of an earlier sequence; `plugin remove` takes an id off the catalog. The server keeps at most 3 zips per id (and platform).

## Install & use

**Install the app** — download the installer from the `app-v<version>` [Releases](https://github.com/kim-taehan/lite-harness-plugins/releases) (macOS Apple Silicon / Intel, Windows). How to use the app is in [lite-harness-desktop](https://github.com/kim-taehan/lite-harness-desktop/blob/dev/README.md).

**Install extensions** — point the app at the update server (the macOS install script writes it for you; otherwise enter it in the app's settings) and pick from [Browse plugins]. To install a single zip without the server, add one via Settings › Features › Add plugin (zip).

### Using it in a closed network

A closed network has no server to reach directly, so carry an **offline bundle** in.

1. Outside, on the PC that publishes: `litecode-deploy export --out litecode-bundle.tar.gz [--sign-key … --key-id …]` — packs the published desktop and plugin catalog into one file (`--only plugins` for the extensions alone). Send the printed sha256 by a different route.
2. Move the bundle in (USB, file share, …).
3. On the company mirror server: `litecode-deploy import litecode-bundle.tar.gz --sha256 <value> --data <folder>`, then `litecode-deploy serve --data <folder>`. Point the app at that server.

Details (bundle layout, replay protection, trusted keys) are in the litecode-deploy README, "오프라인 반입".

### How the app reads it

- The app reads `GET /plugins/catalog.json` and `GET /plugins/dist/<id>-<version>[-<platform>].zip` from the server. Nothing is requested if no server address is set.
- A downloaded zip is installed only if it matches the `sha256` in `catalog.json`; after that it goes through the same checks as a zip install (size · paths · manifest · app version · permission confirmation).
- If the server can't be reached, the app keeps showing the last list it fetched and shows a notice on the browse screen only. Installed extensions keep running.

## Completed plugins

Introductions to plugins whose development is complete: [Index](docs/completed-plugins.md)

## Publishing extensions

### Layout

```
plugins/<id>/            Extension source — extension.json (plugin.json for plugins) + entry file (index.html · locale.json …). One folder per id, no category folders
plugins/<id>/build.mjs   Only for extensions that need a build — produces build/<id>[-<platform>].zip (see below)
categories.json          Extension id → category (game · dev-tool · locale), or unlisted for "this repo doesn't publish it". release passes it as --category
plugins/<id>/changes.txt What changed, one line each — release passes it as --changes-file
scripts/grammar-pack.mjs Packing shared by the grammar packs' build.mjs
scripts/release.mjs      Builds the zip (system zip; runs build.mjs first if present) and calls `litecode-deploy plugin publish`
package.json             Dependencies used by build.mjs (esbuild · MCP SDK · DB drivers · playwright-core) — pinned versions. Run npm ci before building
```

`catalog.json` and `dist/` are no longer the source of truth — the server writes the catalog and keeps the zips.

### Releasing a new version

1. Edit the files in `plugins/<folder>/`.
2. Bump `version` in `extension.json` (`1.2.3` form). To show what changed in the update dialog, put a `changes.txt` in that folder with one change per line (optional — it isn't put in the zip; release hands it to the server. Don't put it in `extension.json`: the app rejects the install over an unknown field).
3. Merge through a PR into `dev`, then publish **from the server PC, after the user (leader) confirms** — publishing reaches users.

```bash
npm run release -- <id> --dry-run   # builds the zip and prints the publish command, without calling the server
npm run release -- <id>             # litecode-deploy plugin publish <zip> --category … --changes-file …
npm run release -- <id> --sign-key ~/keys/release.key --key-id release-1   # sign (keep the private key outside the repo)
```

For a new extension, create a folder under `plugins/` and follow the same steps. Roll back or take down with `litecode-deploy plugin rollback <sequence>` / `plugin remove <id>` — see [publish guide](docs/guides/publish.md).

### Versioning rules

- Versions are three numbers, `major.minor.patch`. The app compares them numerically and offers an update **only when it's higher than the installed one**; it never downgrades.
- Never re-publish different content under the same version — PCs that already installed it won't notice. If you change something, bump the version.
- If an update adds permissions (`permissions`), the app asks the user again. If not, it updates without asking.

### Extensions that need a build

If a folder has a `build.mjs`, `npm run release <id>` runs it first and publishes the resulting `build/<id>[-<platform>].zip` as is. Run `npm ci` once first to install dependencies.

| Extension | What the build does | How to publish |
|---|---|---|
| `sql-tuning` | Bundles the MCP server together with its drivers (oracledb · pg) into one file | `npm run release sql-tuning` |
| `ui-test` | Bundles the MCP server and ships playwright-core next to it (the browser is the PC's Chrome · Edge) | `npm run release ui-test` |
| `chrome-browser` | Fetches Playwright MCP from the registry at a pinned version · sha512 and ships it | `npm run release chrome-browser` |
| `rust-grammar` · `csharp-grammar` · `kotlin-grammar` | Extracts the wasm from the grammar package (aliased as `code-grammar-*` in package.json) and packs it with plugin.json (older packs: extension.json) · LICENSE (`scripts/grammar-pack.mjs`) | `npm run release rust-grammar` |
| `sonarqube` | Fetches the analyzer (Java runtime + SonarScanner, ~100 MB unpacked) per platform and ships it | `npm run release -- sonarqube --platform darwin-arm64` |

- For extensions with an MCP server (`sql-tuning` · `ui-test` · `chrome-browser`), `node plugins/<id>/build.mjs --dir` writes the same contents to the folder `build/<id>/` instead of a zip. The source folder isn't runnable before the build, so the app's plugin dev mode (desktop #1348) connects this folder. chrome-browser keeps the fetched packages in `build/cache/` and reuses them after checking sha512 again.
- To include a company SQL standard in sql-tuning, bundle with `node plugins/sql-tuning/build.mjs --standard <standard.md>` and then `npm run release -- --zip build/sql-tuning.zip`.
- sonarqube is platform-specific, so `--platform` (`darwin-arm64` · `darwin-x64` · `win32-x64`) is required, and  The analyzer is fetched outside the closed network by `plugins/sonarqube/fetch-runtime.mjs`, pinned by version · sha256, into `build/vendor/` (not committed to git — several GB once fetched). Only the mac (Apple silicon) build is verified so far.
- To add a grammar pack: one folder (plugin.json · LICENSE · the same one-line build.mjs as the other packs) + `npm i -D -E code-grammar-<language>@npm:<grammar package>@<version>` + one line in categories.json. The app rejects installing a pack for file extensions it already supports.
- Bumping chrome-browser's Playwright MCP version may rename tools — re-check `DENIED` in `server.mjs` against the new `tools/list`.
- Tests for extensions that need a build live in `plugins/<id>/tests/`. Each plugin is its own vitest project named after its id: `npm test -- --project <id>` runs just that plugin, `npm run test:changed` runs the plugins changed since `origin/main` plus the repo checks (the merge hook uses this), and `npm test` runs everything. They aren't put in the zip (build.mjs ships only the files it picks, and release leaves `tests/` out).
- release checks the category of every target before building. If any is missing, it stops before calling the server.

### `category`

Write one category per extension id in `categories.json`. The value is one of `game` · `dev-tool` · `locale`; if it's missing or anything else, release stops. Add the line here before publishing a new extension.
Don't put it in `extension.json` (the app rejects the install over an unknown field). Folders aren't split by category either — keep one `plugins/<id>/`.

**`unlisted`** means "this repository doesn't publish it" (release skips it); it does not change the server. To take something already published off the list, run `litecode-deploy plugin remove <id>` on the server and mark it `unlisted` so it isn't published again. PCs that already installed it keep it — the app never removes an extension that disappeared from the catalog.

### `platform`

A catalog entry without `platform` is shown on every PC. With one, it's shown only on PCs whose `<os>-<cpu>` (Node's `process.platform`-`process.arch`) matches. The same id may have one entry per platform.

## Related repositories

Lite Harness is three repositories that ship together:

```
 lite-harness-plugins (this repo) ──(extension zips)──▶ litecode-deploy server ──(catalog · zips)──▶ lite-harness-desktop
                                                                                         │  OpenAI-compatible API
                                                                                         │  (API key or company SSO)
                                                                                         ▼
                                                                                 lite-harness-gateway ──▶ LLMs (vLLM · Ollama · cloud …)
```

| Repository | Role | Relationship to this repo |
|---|---|---|
| [lite-harness-desktop](https://github.com/kim-taehan/lite-harness-desktop) | The desktop app (Electron) and the Android app (`mobile/`) | Installs extensions from the litecode-deploy server (not from this repo): the app reads the server's catalog to list, install and update. Zip install still works without it. App installers are published here as `app-v<version>` releases. |
| **lite-harness-plugins** (this repo) | Extension sources, and app installers (`app-v<version>` releases). Extensions are published to the litecode-deploy server | — Extension sources moved here from `extensions/` in desktop #1282. |
| [lite-harness-gateway](https://github.com/kim-taehan/lite-harness-gateway) | LLM gateway — a [LiteLLM](https://github.com/BerriAI/litellm) fork for the closed-network stack (SSO via Keycloak, key/team budgets, usage limits) | No direct relationship. It is the app's **model provider**: add it in Settings → Models with an API key, or use **SSO login** to sign in with a company account and fetch the models that account may use. |

## Scope & philosophy

- **A small read-only server.** The catalog, sha256, sequence and signatures come from litecode-deploy; in a closed network you carry an offline bundle in.
- **Decouple app builds from extension releases.** Fixing an extension never requires redistributing the app.
- **Reproducible from source.** zips can always be rebuilt with `npm run release` from the `plugins/` sources and pinned dependencies.
- **No silent changes.** A version is never re-published, and the user is asked again when permissions grow.
