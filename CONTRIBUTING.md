# Contributing

The procedure for every change. Run all steps in order, every session. One path — do not skip a step, do not add one, do not pick an alternative. One branch, one change, one issue.

## Steps

1. **Branch.** Start from a clean tree, then run:
   ```bash
   git checkout main && git pull --ff-only && git checkout -b <type>/<slug>
   ```
   `<type>` is a commit type (table below); `<slug>` is 2–4 dash-joined words.
   **Done when:** `git status --porcelain` was empty before you branched, and `git branch --show-current` prints your new branch, not `main`.

2. **Change.** Edit only the files the task names.
   **Done when:** the task's acceptance criteria are met and nothing outside the named files changed.

3. **Verify.** Run all three gates:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
   Fix the code a lint rule flags — never `biome --unsafe`, never disable a rule to clear it. Do not go to step 4 on a failure.
   **Done when:** `tsc --noEmit` is clean, `biome check` reports 0 diagnostics, and all `node:test` cases pass.

4. **Commit.** Stage each file by its explicit path (`git add <path> <path>`) — never `git add -A` or `git add .`. Then write one commit in the format below.
   **Done when:** `git log -1 --format=%s` matches `<type>(<scope>): <subject>`, and `git status --porcelain` shows nothing you did not name.

5. **Open a PR** against `main`, with the title copied from your commit subject.
   **Done when:** the PR is open and step 3's checks are green in CI.

6. **Merge** with **Squash & merge**, delete the branch, then run `git fetch --prune`.
   **Done when:** `main` has one new commit and `git branch -r` no longer lists your branch.

## Standing rules

Three invariants this repo is built on. A change that breaks one is a design change, not a fix — raise it as an issue first.

- **One seam.** Tests go through `run(argv, { fetch, env, io?, fs? })` with injected I/O. No test touches the network, the tty, or the disk. `bin/fbg.ts` stays the composition root: it builds the real `io`/`fs` adapters, streams out, exits with the code — no branching business logic.
- **The error contract.** A Graph response carrying an `error` body — including one with HTTP 200 — exits non-zero with the `error` on stderr. Every change to response handling keeps a test on that case.
- **Buildless dev, publish-time compile.** Dev edits and runs `.ts` directly on Node type-stripping — no dev build, no bundle. Only `prepack` compiles `src`/`bin` to `dist/*.js` (`tsconfig.build.json`) for the tarball, because Node refuses to strip types under `node_modules`, so a raw-`.ts` dependency will not run once installed. `tsconfig.json` still sets `erasableSyntaxOnly`, so write only erasable syntax: `enum`, `namespace`, and parameter properties pass typecheck and fail at runtime. `dist/` is git-ignored — a committed `dist/` means someone built in dev.

## Commit format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** — one row from the table. Pick the one that matches the change.
- **scope** — one lowercase noun for the area touched, e.g. `run`, `bin`, `docs`, `deps`, `ci`. Omit the `(...)` if none fits.
- **subject** — imperative ("add", not "added"), lowercase, ≤72 chars, no trailing period.
- **body** — omit it, unless step "breaking change" below applies.
- **footer** — always add `Co-Authored-By: <agent> <noreply@…>`. If the change closes an issue, add `Closes #N`.

| Type | Use when the change is |
|---|---|
| `feat` | a new feature |
| `fix` | a bug fix |
| `refactor` | same behavior, cleaner code |
| `perf` | a speedup, same behavior |
| `docs` | docs only |
| `test` | tests only |
| `build` | the build system or deps |
| `chore` | anything else |
| `ci` | CI config |
| `style` | formatting only, no logic |
| `revert` | undoing a prior commit |

**Breaking change:** put `!` before the `:` and add a `BREAKING CHANGE: <what breaks>` footer (those two words uppercase).

### Examples

```
fix(run): exit non-zero on a 200 response carrying an error body

Co-Authored-By: <agent> <noreply@…>
Closes #128
```

```
feat(run)!: rename the pagination flag

BREAKING CHANGE: what breaks and the migration path.
Co-Authored-By: <agent> <noreply@…>
```

## Release

The consumer is [realroboto/vmCODE](https://github.com/realroboto/vmCODE), which installs this package as a global npm binary at image-build time and pins it as `latest`. A published break reaches it on the next rebuild, so bump the major for anything that changes the command shape, the exit codes, or the error contract.
