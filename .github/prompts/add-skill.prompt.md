---
description: "Scaffold a new TS Skill under workspace/skills/ with index.ts + .d.ts + package.json wiring, following the progressive-disclosure pattern."
name: "add-skill"
argument-hint: "<skill-name> [one-line purpose]"
agent: "agent"
---

# Add a TS Skill

Scaffold a new progressive-disclosure TS Skill named **{{skill-name}}**.

## What to create

Create these files under `workspace/skills/<skill-name>/`:

1. **`index.ts`** — runtime entry. `export default` an object exposing the skill's API, OR `export const <skill-name> = { ... }` (same name as the folder). Use `process.env` for secrets. Follow ESM conventions: `.js` extensions on relative imports, strict TS, no path aliases.

2. **`<skill-name>.d.ts`** — JSDoc-rich type definitions for every exported method. This file is injected on-demand *after* a failed call (Pass 2), so include full parameter/return docs and usage examples in JSDoc. This is the primary documentation surface for the LLM.

3. If the skill needs npm dependencies, add them to `workspace/skills/package.json` (the aggregated dependency root). The loader auto-runs `npm install --omit=dev` when that file's hash changes — do **not** create a per-skill package.json unless the skill is meant to be standalone.

## Conventions to follow

- One skill per folder. Folder name = binding variable name = the name used in `export const <name>`.
- Pure worker module: no `callHost`, no direct DB/main-process access, and **no imports from `../../src`** — the worker cannot resolve host-framework modules. Use only Node.js globals (`process.env`, `fetch`, `console.*`). If the capability needs the main process, it belongs in `src/sandbox/modules/` instead — ask the user to confirm.
- For logging, use `console.*` (e.g. `console.debug("[<skill-name>] ...")`) — skills run in a separate worker and cannot import the host's `createLogger`.
- Reference: [docs/ts-skills-guide.md](../../docs/ts-skills-guide.md) and [docs/progressive-disclosure-in-codeact.md](../../docs/progressive-disclosure-in-codeact.md).

## After creating

- If you added deps to `workspace/skills/package.json`, mention that the user (or the loader) should run the install so they're available.
- Remind the user that skills hot-reload via `skills.reload()` — no full restart required.
- Do NOT register the skill anywhere else; discovery is automatic from the folder.

## Purpose context

The user described this skill's purpose as: **{{one-line purpose}}** (optional — infer a reasonable API surface from the name if omitted, and confirm with the user before generating the full implementation).
