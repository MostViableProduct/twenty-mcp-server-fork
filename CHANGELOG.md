# Changelog

All notable changes to Twenty MCP Server will be documented in this file.

## [1.3.0-entrylvl.1] - 2026-05-05 (MostViableProduct fork)

Fork of upstream `1.3.0` published as `MostViableProduct/twenty-mcp-server-fork`.
Fixes the integration against Twenty v2.x and adds drift-tracking CI.

### 🐛 Fixes against Twenty v2.x

- **`list_all_objects`**: queries now go to the `/metadata` endpoint
  (object metadata moved out of `/graphql`) and use `paging: CursorPaging`
  on the connection (`totalCount` was removed).
- **`get_object_schema`**: dropped the non-existent `ObjectFilterInput`
  type. UUID lookups use the singular `object(id:)` query; name lookups
  list active objects and filter client-side because v2.x's `ObjectFilter`
  has no `nameSingular` / `namePlural` fields.
- **`get_field_metadata`**: per-object path delegates to the rebuilt
  `getObjectSchema`; all-fields path uses the metadata API's top-level
  `fields(paging:)` connection.
- **`create_note` / `create_task` / `getTasks`**: replaced the removed
  plaintext `body` field with v2.x's `bodyV2: RichText { markdown }`.
  Callers can still pass `{ body: "…" }` — the client normalises to
  `{ bodyV2: { markdown: "…" } }` on input and lifts back to a flat
  `body` string on output.

### 🐛 Fixes to the CLI wrapper

- **`twenty-mcp start --stdio`**: resolves `dist/index.js` from the
  package directory (via `import.meta.url`) instead of `process.cwd()`,
  so global / npx / Docker installs no longer trip on the missing
  `./dist`. The build fallback also targets the package root.
- **No more required `.env`**: env vars passed by the parent process
  (Claude Code's MCP `env` block, exported shell env, etc.) now satisfy
  the configuration check. A `.env` file is honoured if present but
  optional.
- **stdio-safe logging**: chatty CLI output goes to stderr in stdio mode
  so the MCP framing on stdout stays clean.

### 🧪 Testing

- New `scripts/spin-up-twenty.sh` / `tear-down-twenty.sh` plus
  `scripts/integration-twenty.compose.yml` to launch a clean Twenty
  workspace, sign up an admin, and mint an Admin-role API key.
- `scripts/integration-test.mjs` drives the bundled stdio server via the
  MCP client SDK, exercises every registered tool with synthetic data,
  and exits non-zero on any *required* tool regression. JSON output via
  `--json` for CI consumption.
- Pinned Twenty tag committed at `scripts/twenty-tag` (currently `v2.2.0`).

### ⚙️ CI

- New `.github/workflows/integration.yml`:
  - PRs / pushes verify against the pinned tag.
  - Daily cron + `workflow_dispatch` also run against the latest
    `twentyhq/twenty` release. On regression: opens a `drift,upstream`
    issue with the failing-tool report. On a clean run with a newer tag
    available: opens a tag-bump PR.

## [1.3.0] - 2026-01-12

### 🎉 Added
- **Docker MCP Support**: Now available on [Docker Hub MCP Registry](https://hub.docker.com/mcp)!
  - Install via Docker Desktop MCP Catalog
  - Or use `docker mcp install twenty-mcp`
  - Configuration files in `docker-mcp/` directory

### 🔒 Security
- Updated MCP SDK to latest version (security fixes)
- Fixed all npm audit vulnerabilities (was 7, now 0)
- Updated body-parser, js-yaml, qs, and tmp dependencies

### 📚 Documentation
- Added Docker MCP installation option to README
- Updated installation comparison table

### 🔧 Technical Improvements
- Repository unarchived and refreshed for continued maintenance

## [1.2.0] - 2025-06-24

### 🎉 Added
- **npx Support**: Try Twenty MCP Server instantly without installation!
  - Run `npx twenty-mcp-server setup` to get started immediately
  - No global installation required - perfect for evaluation
  - Configuration automatically persists between npx runs
  - Smart context detection for npx vs global installation
  
### 🚀 Features
- Execution context detection system (npx/global/local)
- Context-aware CLI messaging and headers
- npx-specific welcome messages and onboarding
- Performance tips for first-time npx users
- Clear migration path from npx to global installation
- Optimized package size (114.5 KB) for fast npx downloads

### 📚 Documentation
- README now prominently features npx as the quickest way to try
- Added npx examples throughout documentation
- IDE configuration notes for npx users
- Installation comparison table with npx option

### 🔧 Technical Improvements
- Created `src/cli/utils/execution-context.ts` for context detection
- Created `src/cli/utils/npx-helpers.ts` for npx-specific utilities
- Updated CLI entry point with context awareness
- Enhanced setup wizard with npx-specific guidance
- Smart postinstall script that detects execution context

### 🐛 Bug Fixes
- None in this release

### 💔 Breaking Changes
- None - full backward compatibility maintained

## [1.1.0] - Previous Release

- Initial OAuth 2.1 implementation
- IP address protection features
- Enhanced setup wizard
- Cross-platform compatibility improvements