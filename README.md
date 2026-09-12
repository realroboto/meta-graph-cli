# meta-graph-cli (`fbg`)

`fbg` is a passthrough CLI for the Meta Graph API. It is the `gh api` that Meta's official Ads CLI lacks.

- No endpoint table, no domain model, no state. The route **is** the URL, so it covers 100% of the Graph API — including endpoints that do not exist yet.
- Zero runtime dependencies. All network calls use native `fetch`.
- TypeScript 7 (strict), Node 24. Node runs `.ts` directly (type-stripping) — no build step in dev. Biome for lint + format. pnpm 12 (corepack-pinned) for package management.
- It fills the gap Meta's official `meta` CLI leaves: Business Manager, system users, asset assignment, ad account creation, custom audiences, lookalikes, activity logs, Pages/IG, webhooks.

Command shape: `fbg <VERB> <path> [--k=v] [--paginate] [--api-version=vNN.0]`

```bash
fbg GET /me/businesses --fields=id,name
fbg GET /<business-id>/owned_ad_accounts --paginate
fbg POST /act_123/customaudiences --name=X --subtype=LOOKALIKE
fbg DELETE /<id>
```

Flags become query params on `GET`, form body on every other verb.

## Install

```
npm i -g meta-graph-cli    # installs the `fbg` bin
```

Needs **Node ≥ 24**. Dev runs the `.ts` sources directly on Node's native type-stripping — no build step, no bundle. The **published** package ships compiled `.js` (emitted at publish time by `prepack`, never committed), because [Node refuses to strip types under `node_modules`](https://nodejs.org/api/typescript.html) — "To discourage package authors from publishing packages written in TypeScript" — so a raw-`.ts` dependency cannot run once installed. Zero runtime dependencies still holds; the tarball carries only `dist/`.

Type-stripping is unflagged from 22.18 onward, so 22.x would technically run the sources in dev. The floor is 24 anyway: that is the only version CI tests and the only one the downstream image runs, and an advertised floor we never test is a promise we cannot keep.

## Auth

The credential is a Meta **system-user token**. Supply it either way — the env var wins over the saved file, so CI stays unchanged:

```bash
export META_ACCESS_TOKEN=...   # Meta system user token (same token the official `meta` CLI reads)
```

or save it once with the guided command:

```bash
fbg auth login     # prompts for the token (hidden), validates it, saves it 0600
fbg auth status    # shows the current token: identity, app, scopes, expiry
fbg auth logout    # removes the saved token
```

`fbg auth login` prompts with the echo muted, validates the token live against `/debug_token` + `/me`, and only saves it on success to `$XDG_CONFIG_HOME/fbg/credentials.json` (default `~/.config/fbg/credentials.json`, file `0600`). An invalid token writes nothing.

Mint the token in Business Suite → Settings → Users → System Users → Admin → Generate Token, with the app added as App Admin. Scopes: `business_management`, `ads_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `catalog_management`, `read_insights`.

The token alone is enough — it is a discovery root, so a fresh session finds everything by walking the graph: `fbg GET /me`, `/me/businesses`, `/me/accounts`, `/me/adaccounts` → `/act_<id>/campaigns`. No ids are stored.

**Not OAuth, on purpose.** Meta's only CLI-shaped OAuth (Device Login) hands back a ~60-day *expiring* user token; the non-expiring system-user token is the right credential for unattended automation. The saved file is plaintext at `0600` — stick to `META_ACCESS_TOKEN` if you would rather keep no token on disk.

## Why this is not an alias for `curl`

**The Graph API returns HTTP 200 with an `error` object in the body.** An agent piping raw `curl` treats that failure as success. `fbg` exits non-zero on any `error` body or status ≥ 400 and puts the `error` on stderr; success is compact JSON on stdout, exit 0. That contract is the reason the project exists — it is load-bearing, not a nicety.

It also injects the token, fixes the API version in one place, and follows `paging.next`.

## Two API tracks

Graph API and Marketing API are versioned on **separate changelogs with different expiry dates for the same number**. Conflating them is the easy mistake here.

| Track | Latest | Note |
|---|---|---|
| [Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/) | v26.0 (2026-07-29) | what `fbg` targets: businesses, system users, assets, audiences, webhooks |
| [Marketing API](https://developers.facebook.com/docs/marketing-api/marketing-api-changelog) | v25.0 (2026-02-18) | no v26.0 changelog published; expiries are far shorter (v24.0 ends 2026-10-06) |

Paths under `/act_<id>/…` are Marketing API. **Measured (2026-09-12): `/act_<id>/campaigns` answers under `v26.0`, read and write** — `GET` returned a normal (empty) campaign list and `POST` (create) then `DELETE` on the returned campaign all succeeded against a live ad account under the default version, even though no v26.0 Marketing changelog is published. Only `/campaigns` was exercised; other Marketing paths are unverified but resolve through the same `/v26.0/` namespace. The global constant stays `v26.0` and no `--api-version` override was needed — it stays available per call if a Marketing path ever diverges. See `docs/SPEC.md`.

`v26.0` also removed `pretty`, `debug`, `date_format`, legacy `If-None-Match`, and root `GET /?ids=`. `fbg` depends on none of them. Those removals reach **every** still-supported version on 2026-10-27, so pinning an older version buys nothing.

## Flow

One seam. Everything else is a shell around it.

| Part | File | Function |
|---|---|---|
| **seam** | `src/run.ts` | `run(argv, { fetch, env, io?, fs? })` → `{ stdout, stderr, code }`. Pure: argv parsing, URL building, token injection, pagination, the error contract, and the auth credential orchestration. All I/O is injected — network (`fetch`), tty (`io`), disk (`fs`) — so the whole CLI is testable with no network, tty, or disk. `io`/`fs` are optional; only the `auth` subcommands need them. |
| **bin** | `bin/fbg.ts` | Constructs the real `io` (muted-echo tty prompt) and `fs` (credential-file adapter), calls `run`, writes the two streams, exits with the code. The only impure layer; no branching business logic. |

Splitting the seam into `buildRequest` + `renderResponse` was considered and rejected: pagination couples them, and testing them apart leaves that coupling uncovered.

## Where to look

| For | Read |
|---|---|
| What the CLI does, decisions, the error contract, risks | **[docs/SPEC.md](docs/SPEC.md)** — behavior source of truth |
| Who consumes this | [realroboto/vmCODE#267](https://github.com/realroboto/vmCODE/issues/267) — bakes `fbg` into the container image, retires the two Meta MCPs |
| Ready-made commands for the Business-side gap | [skills/fbg/SKILL.md](skills/fbg/SKILL.md) — task→command gap map, each row grounded in Meta's reference |
| Real commands and scripts | `package.json`, `fbg --help` |

## Contributing

- Test through the seam. Inject a fake `fetch` and `env`. Use no real network.
- Cover the error contract explicitly: a 200 response carrying an `error` body must exit non-zero.
- `tsconfig.json` sets **`erasableSyntaxOnly`** — write only syntax type-stripping can erase. It bars `enum`, `namespace`, and parameter properties, which would otherwise pass typecheck and fail at runtime.
- Dev is buildless: edit and run `.ts` directly. The publish step (`prepack`) compiles `src`/`bin` to `dist/*.js` via `tsconfig.build.json` (`rewriteRelativeImportExtensions` turns the `.ts` import specifiers into `.js`); `dist/` is git-ignored and only the tarball carries it. This is forced — Node will not type-strip under `node_modules`. Don't commit `dist/`, and don't add a dev build.
- Before commit: `pnpm typecheck` (tsc --noEmit) · `pnpm lint` (biome) · `pnpm test`.
- Fix lint by fixing the code it flags — never `biome --unsafe`, never disable a rule to clear it.

## Agent skills

| Topic | Rule | Detail |
|---|---|---|
| Issue tracker | GitHub issues via `gh` | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Triage labels | 5 canonical labels (string == role) | [docs/agents/triage-labels.md](docs/agents/triage-labels.md) |
| Domain docs | Single-context (`CONTEXT.md`) | [docs/agents/domain.md](docs/agents/domain.md) |

## Status

Writes landed (#6). `src/run.ts` is the seam and `bin/fbg.ts` is its shell; `fbg GET <path>` reads and `fbg POST`/`DELETE <path>` write the Graph API end to end under the error contract. Non-GET verbs send flags as an `application/x-www-form-urlencoded` body, so the query string stays empty. Pagination landed (#7): `--paginate` follows `paging.next` to the end, one JSON document per page, each through the `renderResponse` checkpoint. The toolchain is scaffolded (#4) and the three gates run green. Guided auth landed (#17): `fbg auth login|status|logout` save/introspect/remove a system-user token, env winning over a `0600` credential file, all through the seam with injected `io`/`fs`. The spec is [issue #1](https://github.com/realroboto/meta-graph-cli/issues/1). Published (#9): `meta-graph-cli@1.0.0` is live on npm (tag `latest`), installs clean, and runs `fbg --help` plus a live `GET` under the error contract — `prepack` emits `dist/` and `bin` maps `fbg` to the compiled entry. A companion gap-map skill ships at `skills/fbg/` (#20). The CLI is feature-complete against the spec.
