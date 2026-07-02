---
description: "Use when editing the CodeAct sandbox runtime, host-call modules, or authoring TS Skills under workspace/skills/. Covers the host-module vs TS-skill boundary, progressive disclosure (.d.ts injection), hot-reload, and the separate sandbox test runner."
applyTo: ["src/sandbox/**", "workspace/skills/**"]
---

# Sandbox & TS Skills Guidelines

Applies to: [src/sandbox/](../../src/sandbox/) (worker runtime + host-coupled modules) and [workspace/skills/](../../workspace/skills/) (pure worker TS skills).

## Two boundaries — don't blur them

| Type | Lives in | Couples to host? | Mechanism |
|------|----------|------------------|-----------|
| **Host modules** | `src/sandbox/modules/` | Yes — talks to main process via `callHost` IPC (DB, platform protocols, memory) | Hardcoded in framework |
| **TS Skills** | `workspace/skills/<name>/` | No — runs fully in the sandbox worker process (HTTP APIs, data scripts) | Discovered & loaded at worker startup |

When adding a capability: if it needs the main process (DB, Telegram client, cross-module state) → host module in `src/sandbox/modules/`. If it's a self-contained wrapper (REST API, local transform) → TS skill in `workspace/skills/`. See [docs/ts-skills-guide.md](../../docs/ts-skills-guide.md).

## TS Skill anatomy (`workspace/skills/<name>/`)

- `index.ts` — runtime. Must `export default` an object **or** `export const <name> = { ... }` (same name as the folder). Loaded via [src/sandbox/skill-loader.ts](../../src/sandbox/skill-loader.ts); loader prefers `index.ts` → `index.js`.
- `<name>.d.ts` — JSDoc-rich type definitions. **Not loaded eagerly.** Injected on-demand *after* a failed call (Pass 2 of progressive disclosure). Keep signatures minimal in the system prompt; put full docs here.
- Optional `SKILL.md` — for markdown-only (knowledge) skills; no `index.ts`.
- `package.json` at `workspace/skills/` root aggregates npm deps for all skills. If its hash changes, the loader auto-runs `npm install --omit=dev --no-audit --no-fund`. Declare skill deps there, not per-folder.

Skills hot-reload via `skills.reload()` (exposed to the agent). Changing `index.ts`/`.d.ts` and reloading is enough — no full restart needed. See [docs/progressive-disclosure-in-codeact.md](../../docs/progressive-disclosure-in-codeact.md).

## ESM & TS conventions (still apply here)

- `.js` extensions on all relative imports inside `.ts` (host modules in `src/sandbox/modules/` importing other `src/` code).
- Strict TS, no path aliases — relative paths only.
- **Host modules** may use `createLogger("<scope>")` from [src/core/logger.ts](../../src/core/logger.ts).
- **TS Skills** cannot import host code (`../../src/...`) — they run in a separate worker process. Use only Node.js globals (`process.env`, `fetch`, `console.*`) and skills' own npm deps (declared in `workspace/skills/package.json`).

## Testing sandbox changes

Default `pnpm test` **excludes** files matching `*sandbox*` in the filename. For sandbox behavior changes, run:

```
pnpm test:sandbox
```

(Single file: `tsx --test tests/<file>.test.ts`.) Per repo Testing Philosophy, only add tests for genuinely tricky edge cases — not happy-path flows.
