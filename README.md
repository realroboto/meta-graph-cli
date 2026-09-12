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

Needs **Node ≥ 22.18** — `fbg` ships as TypeScript and runs on Node's native type-stripping, so there is no build step and no bundle.

## Auth

One env var, no login command, no credential file:

```bash
export META_ACCESS_TOKEN=...   # Meta system user token
```

Deliberately the **same** token Meta's official `meta` CLI reads, so there is one credential for both. Mint it in Business Suite → Settings → Users → System Users → Admin → Generate Token, with the app added as App Admin. Scopes: `business_management`, `ads_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `catalog_management`, `read_insights`.

## Why this is not an alias for `curl`

**The Graph API returns HTTP 200 with an `error` object in the body.** An agent piping raw `curl` treats that failure as success. `fbg` exits non-zero on any `error` body or status ≥ 400 and puts the `error` on stderr; success is compact JSON on stdout, exit 0. That contract is the reason the project exists — it is load-bearing, not a nicety.

It also injects the token, fixes the API version in one place, and follows `paging.next`.

## Two API tracks

Graph API and Marketing API are versioned on **separate changelogs with different expiry dates for the same number**. Conflating them is the easy mistake here.

| Track | Latest | Note |
|---|---|---|
| [Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/) | v26.0 (2026-07-29) | what `fbg` targets: businesses, system users, assets, audiences, webhooks |
| [Marketing API](https://developers.facebook.com/docs/marketing-api/marketing-api-changelog) | v25.0 (2026-02-18) | no v26.0 changelog published; expiries are far shorter (v24.0 ends 2026-10-06) |

Paths under `/act_<id>/…` are Marketing API. Whether they answer under `/v26.0/` is **measured, not assumed** — see `docs/SPEC.md`. Use `--api-version` on those paths if they do not.

`v26.0` also removed `pretty`, `debug`, `date_format`, legacy `If-None-Match`, and root `GET /?ids=`. `fbg` depends on none of them. Those removals reach **every** still-supported version on 2026-10-27, so pinning an older version buys nothing.

## Flow

One seam. Everything else is a shell around it.

| Part | File | Function |
|---|---|---|
| **seam** | `src/run.ts` | `run(argv, { fetch, env })` → `{ stdout, stderr, code }`. Pure: argv parsing, URL building, token injection, pagination, the error contract. All I/O is injected, so the whole CLI is testable with no network. |
| **bin** | `bin/fbg.ts` | Writes the two streams, exits with the code. Nothing else. |

Splitting the seam into `buildRequest` + `renderResponse` was considered and rejected: pagination couples them, and testing them apart leaves that coupling uncovered.

## Where to look

| For | Read |
|---|---|
| What the CLI does, decisions, the error contract, risks | **[docs/SPEC.md](docs/SPEC.md)** — behavior source of truth |
| Who consumes this | [realroboto/vmCODE#267](https://github.com/realroboto/vmCODE/issues/267) — bakes `fbg` into the container image, retires the two Meta MCPs |
| Real commands and scripts | `package.json`, `fbg --help` |

## Contributing

- Test through the seam. Inject a fake `fetch` and `env`. Use no real network.
- Cover the error contract explicitly: a 200 response carrying an `error` body must exit non-zero.
- `tsconfig.json` sets **`erasableSyntaxOnly`** — write only syntax type-stripping can erase. It bars `enum`, `namespace`, and parameter properties, which would otherwise pass typecheck and fail at runtime.
- The package publishes `.ts` raw: no `dist/`, no build on publish. Keep it that way.
- Before commit: `pnpm typecheck` (tsc --noEmit) · `pnpm lint` (biome) · `pnpm test`.
- Fix lint by fixing the code it flags — never `biome --unsafe`, never disable a rule to clear it.

## Agent skills

| Topic | Rule | Detail |
|---|---|---|
| Issue tracker | GitHub issues via `gh` | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Triage labels | 5 canonical labels (string == role) | [docs/agents/triage-labels.md](docs/agents/triage-labels.md) |
| Domain docs | Single-context (`CONTEXT.md`) | [docs/agents/domain.md](docs/agents/domain.md) |

## Status

Skeleton. The spec is [issue #1](https://github.com/realroboto/meta-graph-cli/issues/1); no source exists yet. Files named above under `src/`, `bin/`, and `docs/` are the target layout, not the current one.
