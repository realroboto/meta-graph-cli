# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. **Single-context repo.**

## Before exploring, read these

- **`README.md`** at the repo root — the orientation doc. `CLAUDE.md` and `AGENTS.md` are symlinks to it, so all three are one file; edit `README.md`.
- **`CONTRIBUTING.md`** — the procedure for every change, plus the **Standing rules**: one seam, the error contract, no build step. Those three are invariants, not preferences.
- **`docs/SPEC.md`** — behavior source of truth, once it exists.
- **`CONTEXT.md`** at the repo root and **`docs/adr/`** — neither exists yet. If a file named here is absent, **proceed silently**. `/domain-modeling` creates them lazily when terms or decisions actually get resolved; don't scaffold them upfront.

## File structure

```
/
├── README.md              ← AGENTS.md and CLAUDE.md symlink here
├── CONTRIBUTING.md
├── CONTEXT.md             ← lazily created
├── docs/
│   ├── SPEC.md
│   ├── adr/               ← lazily created
│   └── agents/
├── bin/fbg.ts
└── src/run.ts             ← the one seam
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary avoids. If the concept isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

Terms this repo already leans on, defined in `README.md` until a `CONTEXT.md` exists: **seam** (the single injected-`fetch` entry point), **error contract** (a Graph `error` body, including under HTTP 200, exits non-zero), **track** (Graph API and Marketing API are separately versioned).

## Flag decision conflicts

If your output contradicts a Standing rule in `CONTRIBUTING.md` or a decision in `docs/SPEC.md`, surface it explicitly rather than silently overriding:

> _Contradicts the "no build step" standing rule — but worth reopening because…_
