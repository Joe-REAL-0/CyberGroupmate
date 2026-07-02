# CyberGroupmate — Agent Guidelines

Project-level guidelines for AI coding agents (Claude, Codex, Cursor, Copilot, etc.) working on this codebase.

CyberGroupmate is a CodeAct-based autonomous group-chat social agent (TypeScript / Node.js 22+ / pnpm / ESM). See [README.md](README.md) for the project overview and [docs/architecture_v4.md](docs/architecture_v4.md) for the full architecture.

## Commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Run (prod) | `pnpm start` → `tsx src/main.ts` |
| Run (dev, watch) | `pnpm dev` |
| CLI entrypoint | `pnpm cli` → `tsx src/cli.ts` |
| Run tests | `pnpm test` (runs `scripts/run-tests.ts`) |
| Sandbox tests only | `pnpm test:sandbox` |
| Single test file | `tsx --test tests/<file>.test.ts` |
| Dashboard UI dev | `pnpm dashboard:dev` |
| Dashboard UI build | `pnpm dashboard:build` |

- **No `pnpm build` script exists** — don't assume one. There is no compile step; `tsx` runs TS directly.
- `pnpm test` collects `tests/**/*.test.ts` but **excludes files matching `sandbox`** in the filename. Use `pnpm test:sandbox` for sandbox changes.
- Tests use Node's built-in runner (`node:test` + `node:assert/strict`) under `tsx`. See [Testing Philosophy](#testing-philosophy) below.

## Code Conventions

- **ESM-first — `.js` imports are mandatory.** `package.json` is `"type": "module"`, `moduleResolution: "bundler"`. All relative imports inside `.ts` files MUST use a `.js` extension, e.g. `import { createLogger } from "../core/logger.js"`. Omitting it breaks under the current module settings.
- **Strict TypeScript.** `strict: true`, `target: ES2022`, `module: ESNext`. **No path aliases** (`baseUrl`/`paths`) — use relative paths only.
- **No linter or formatter is configured.** Match surrounding style: 4-space indent, named exports, class-based modules with `start()`/`stop()` lifecycle where applicable.
- **Logging.** Use `createLogger("<scope>")` from [src/core/logger.ts](src/core/logger.ts). Levels: `debug` / `info` / `warn` / `error`. Controlled by env vars `LOG_LEVEL` (default `info`), `LOG_FORMAT` (`text` | `json`), `NO_COLOR`.
- **Config.** YAML in `config.yaml` (copy from [config.example.yaml](config.example.yaml)). Config YAML uses **snake_case** (`llm_profiles`, `mention_keywords`); the TypeScript types in [src/core/config.ts](src/core/config.ts) use **camelCase** (`llmProfiles`, `mentionKeywords`). Top-level config keys: `llm_profiles`, `llm_routing`, `persona`, `notification`, `telegram` / `discord` / `onebot`, `reflection`, `embedding`, `privacy`, `dashboard`, `metrics`, `subagent`, `mcp_servers`, `recording_pipeline`, `env_vars`, `background_agent`.

## Architecture (link, don't re-derive)

Full design in [docs/architecture_v4.md](docs/architecture_v4.md). Quick map of `src/`:

| Folder | Responsibility |
|--------|----------------|
| `adapter/` | Platform abstraction (Telegram, Discord, OneBot) implementing a shared `PlatformAdapter` |
| `context-engine/` | Structured prompt assembly with typed delta / cache strategies |
| `core/` | Shared primitives: config, logger, chat IDs, safety, LLM plumbing |
| `dashboard/` | HTTP / WebSocket monitoring & control surface |
| `event/` | In-memory event bus |
| `harness/` | External agent harness launchers (Claude Code / Copilot CLI) |
| `main-agent/` | Meta Agent control plane: main loop, global state, wake conditions |
| `mcp-server/` | Exposes internal capabilities as MCP tools (Streamable HTTP, token auth) |
| `memory-v2/` | SQLite-backed three-layer memory: recall, reflection, embeddings |
| `meta-sandbox/` | VM sandbox for the Meta Agent's higher-level orchestration API |
| `metrics/` | Prometheus collectors & exporter |
| `pipeline/` | Recording pipeline & topic registry |
| `sandbox/` | Worker runtime: sandbox pool, host-call modules, skill loader |
| `subagent/` | Per-chat subagents: CodeAct execution, callbacks, task dispatch |
| `tools/` | Repo utility scripts (doc generators, converters) |
| `types/` | Ambient `.d.ts` for untyped external packages |

**Meta → Subagent flow:** incoming adapter events → `subagentManager.getOrCreate(chatId)` → `subagent.onMessage()`. Meta dispatch: [src/meta-sandbox/meta-api/dispatch.ts](src/meta-sandbox/meta-api/dispatch.ts) enqueues a `CodeActReplyTask` on a target subagent. The subagent executes in [src/subagent/code-act-executor.ts](src/subagent/code-act-executor.ts), emits a `SubagentCallback` → post-task window → `callback-queue` (Q5) → drained by `MainAgentLoop.tick()`. Details in [docs/Meta_CodeAct.md](docs/Meta_CodeAct.md) and [docs/subagent.md](docs/subagent.md).

## Adding Skills (Progressive Disclosure)

Agent skills are TS modules, **not** JSON-schema tool definitions. To add one, drop a folder into `workspace/skills/<name>/` containing:

- `index.ts` — entry point (default export, or a same-name export)
- `<name>.d.ts` — full type docs, injected on-demand *after* a failed call (Pass 2)

The loader ([src/sandbox/skill-loader.ts](src/sandbox/skill-loader.ts)) prefers `index.ts` → `index.js`. Markdown-only skills use `SKILL.md`. Skills hot-reload via `skills.reload()`. If `workspace/skills/package.json`'s hash changes, deps auto-install with `npm install --omit=dev`. See [docs/ts-skills-guide.md](docs/ts-skills-guide.md) and [docs/progressive-disclosure-in-codeact.md](docs/progressive-disclosure-in-codeact.md).

## Gotchas

- **Native modules.** `better-sqlite3`, `node-pty`, `sqlite-vec`, `@napi-rs/canvas`, `@napi-rs/webcodecs` need platform binaries / a build toolchain. `postinstall` chmods a `node-pty` helper on `darwin-arm64` only — setup is not uniform across platforms.
- **`patches/@mtcute__core.patch`** modifies `@mtcute/core` spoiler handling. Dependency refreshes must keep this patch applied.
- **Sandbox tests run separately.** Default `pnpm test` skips `*sandbox*` files; run `pnpm test:sandbox` for sandbox behavior changes.
- **Host modules vs TS skills.** Host-coupled modules live in `src/sandbox/modules/`; pure TS skills live in `workspace/skills/`. Don't blur these boundaries.
- **`AGENTS.md` and `CLAUDE.md` are gitignored** (local-only). This tracked file is `agents.md` (lowercase) — keep editing this one so changes are committed.

## Key Files

- [src/main.ts](src/main.ts) — top-level wiring: adapters, memory, subagents, meta sandbox, shutdown
- [src/core/config.ts](src/core/config.ts) — config loader & typed definitions
- [src/core/logger.ts](src/core/logger.ts) — structured logger factory
- [src/main-agent/main-agent-loop.ts](src/main-agent/main-agent-loop.ts) — Meta Agent attention / decision loop
- [src/main-agent/global-state.ts](src/main-agent/global-state.ts) — scheduler / memo / digest / task persistence
- [src/subagent/code-act-executor.ts](src/subagent/code-act-executor.ts) — per-chat CodeAct execution & callbacks
- [src/subagent/callback-queue.ts](src/subagent/callback-queue.ts) — Q5 callback queue drained by the main loop
- [src/sandbox/sandbox.ts](src/sandbox/sandbox.ts) — sandbox worker runtime
- [src/sandbox/skill-loader.ts](src/sandbox/skill-loader.ts) — skill discovery & hot-reload
- [src/meta-sandbox/meta-api/dispatch.ts](src/meta-sandbox/meta-api/dispatch.ts) — cross-group task dispatch
- [src/memory-v2/index.ts](src/memory-v2/index.ts) — memory system export surface
- [src/context-engine/index.ts](src/context-engine/index.ts) — structured context assembly
- [src/dashboard/dashboard-server.ts](src/dashboard/dashboard-server.ts) — dashboard HTTP / WS server
- [src/mcp-server/index.ts](src/mcp-server/index.ts) — MCP tool registration

## Deployment

Two supported run modes; pick based on environment:

- **Native (recommended for dev)** — `pnpm install` → `pnpm dashboard:build` → `pnpm start`. Data writes to `workspace/`. Requires Node.js 22+ and a native build toolchain (python3, make, g++) for `better-sqlite3` / `node-pty` / `sqlite-vec`. For production, run under systemd (`Type=simple`, set `LOG_LEVEL` via `Environment=`). See [README.md](README.md) "本机原生运行" for full steps.
- **Docker** — `docker compose up -d` (uses [Dockerfile](Dockerfile), multi-stage: deps → dashboard UI build → runtime). Config mounted at `/app/config.yaml`, persistent data in the `cybergroupmate-data` and `cybergroupmate-agent-env` volumes. **Telegram userbot first login is interactive** — `docker attach cybergroupmate` to enter OTP/2FA. `ENTRYPOINT` is `npx tsx src/main.ts`.

Variant images for agentic harnesses: `Dockerfile.agentic-with-cc` (adds Claude Code) and `Dockerfile.agentic-with-copilot` (adds Copilot CLI).

- **Dashboard UI** is a separate Vite + pnpm subproject under [src/dashboard/ui](src/dashboard/ui). Dev: `pnpm dashboard:dev`. The build (`pnpm dashboard:build`) emits static assets to `src/dashboard/public`, served by the runtime — always rebuild after UI changes before `pnpm start`.
- **Config & secrets.** Copy [config.example.yaml](config.example.yaml) → `config.yaml` (gitignored) and fill in platform/LLM/dashboard credentials. For Docker, use an `.env` file (see [docker-compose.yaml](docker-compose.yaml)).

## Testing Philosophy

This project deliberately minimizes automated tests. The testing strategy is:

1. **Only test edge cases and boundary conditions** — write tests for tricky logic where a subtle off-by-one or null-handling bug would be hard to catch manually (e.g. FTS query sanitization, timestamp clamping, privacy scrubbing edge cases).

2. **Do NOT test full flows** — end-to-end flow verification belongs in manual e2e testing, not in automated test suites. Avoid writing tests that exercise the happy path through multiple layers (adapter → sandbox → meta → subagent → response).

3. **Do NOT add tests for every change** — when fixing a bug or adding a feature, only add a test if the fix involves a genuinely tricky edge case. Most changes should be verified through manual e2e testing.

4. **Test files live in `tests/`** — use the existing `tsx --test` runner. Shared DB helpers live in `tests/helpers/`.

## Further Docs

- [docs/architecture_v4.md](docs/architecture_v4.md) — full system architecture
- [docs/Meta_CodeAct.md](docs/Meta_CodeAct.md) — Meta-CodeAct orchestration
- [docs/context_engine.md](docs/context_engine.md) — structured prompt assembly
- [docs/memory.md](docs/memory.md) — three-layer memory model
- [docs/ts-skills-guide.md](docs/ts-skills-guide.md) — writing TS skills
- [docs/progressive-disclosure-in-codeact.md](docs/progressive-disclosure-in-codeact.md) — progressive disclosure
- [docs/subagent.md](docs/subagent.md) — subagent workflow
- [docs/dashboard.md](docs/dashboard.md) — dashboard panels
- [docs/telemetry.md](docs/telemetry.md) — Prometheus metrics
- [docs/changelog.md](docs/changelog.md) — recent changes
- [docs/PERSONA.example.md](docs/PERSONA.example.md) — persona template

---

> Note: `.github/copilot-instructions.md` contains a separate behavioral override (a forced-interaction protocol) unrelated to project knowledge — it is intentionally left untouched here.
