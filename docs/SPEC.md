# SPEC — `fbg`

Behavior source of truth for `meta-graph-cli` (bin `fbg`). Distilled from [issue #1](https://github.com/realroboto/meta-graph-cli/issues/1); that issue now links here rather than being the spec. Where this file and a ticket disagree, this file wins — raise a PR to reconcile.

`fbg` is a passthrough CLI for the Meta Graph API — the `gh api` Meta's official Ads CLI lacks. No endpoint table, no domain model, no state: **the route is the URL**, so it covers 100% of the Graph API, including endpoints that do not exist yet.

## Command shape

```
fbg <VERB> <path> [--k=v ...] [--paginate] [--api-version=vNN.0]
```

- **VERB** — HTTP verb. **path** — Graph path starting with `/`.
- `--k=v` flags → **query params on `GET`**, **form body on every other verb** (so values never land in proxy logs or shell history).
- Reserved flags: `--paginate`, `--api-version`, `--help`.

```bash
fbg GET /me/businesses --fields=id,name
fbg GET /<business-id>/owned_ad_accounts --paginate
fbg POST /act_123/customaudiences --name=X --subtype=LOOKALIKE
fbg DELETE /<id>
```

## The one seam

Everything lives behind a single exported function:

```ts
run(argv: string[], deps: {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  io?: Io;            // prompt(label, { hidden }) — only auth login uses it
  fs?: CredentialFs;  // readFile/writeFile/mkdir/chmod/rm — credential store
}): Promise<{ stdout: string; stderr: string; code: number }>
```

Pure: argv parsing, URL building, token injection, pagination, the error contract, and the auth credential orchestration (path, 0700 dir, 0600 file). All I/O is injected — network via `fetch`, the terminal via `io`, the disk via `fs` — so the whole CLI is testable with no network, tty, or disk. `io`/`fs` are optional so the passthrough verbs need only `{ fetch, env }`; the auth subcommands require them. `bin/fbg.ts` is a shell: it constructs the real `io` (a muted-echo tty prompt) and `fs` (the credential-file adapter over `node:fs/promises`), calls `run`, writes the two streams, and exits with the code — the only impure layer, holding no branching business logic.

**Rejected:** splitting the exported seam into `buildRequest` + `renderResponse`. Pagination couples them; testing them apart leaves that coupling uncovered.

### Internal checkpoint: `renderResponse`

Inside `run`, every `fetch` result passes through **one internal checkpoint**, `renderResponse(res)` — the single `GET`, every write, and every paginated page. It is an **internal seam**, private to `run`'s implementation, not an export: tests still cross only `run`. This keeps the load-bearing error contract in one place instead of restated per verb. This is distinct from the rejected *exported* split above.

## The error contract

**Load-bearing — the reason `fbg` is not an alias for `curl`.** The Graph API returns **HTTP 200 with an `error` object in the body** in many cases. An agent piping raw `curl` treats that failure as success.

- Any response carrying an `error` body **(including under HTTP 200)**, or any status ≥ 400 → **exit non-zero**, the `error` object on **stderr**.
- Success → compact JSON on **stdout**, **exit 0**.

Applied once, at `renderResponse`. Every response path inherits it.

## Auth

The credential is a Meta **system-user token**, sent as `Authorization: Bearer`. It resolves from two sources, **env first, then file**:

1. `META_ACCESS_TOKEN` — deliberately the **same** token Meta's official `meta` CLI reads, so a container that exports it behaves exactly as before.
2. A saved credential file at `$XDG_CONFIG_HOME/fbg/credentials.json` (falling back to `~/.config/fbg/credentials.json`), written by `fbg auth login`.

A **missing token** (neither source) **fails with its own message and never calls `fetch`**.

### `fbg auth <sub>` — guided credential management

Its own dispatch, ahead of the VERB+path passthrough, so `auth` is never read as an HTTP verb.

- `fbg auth login` — prompts for the token with the terminal echo muted, validates it live (`GET /debug_token` + `GET /me`), prints an identity/app/scopes/expiry summary, then persists it (dir `0700`, file `0600`). An invalid token **writes nothing**. The summary never contains the token.
- `fbg auth status` — introspects the resolved token; read-only.
- `fbg auth logout` — removes the saved file; idempotent, reports whether one was there.

`/debug_token` authorizes with the token as a Bearer header; `input_token` rides the query string because that endpoint is GET-only and reads it there. Every auth response passes through the same `renderResponse` error contract (an `error` body, a status ≥ 400, or `is_valid: false` → exit non-zero, error on stderr). No credential secret is persisted beyond the token itself — no ids or defaults, since the token alone is a discovery root (`/me`, `/me/businesses`, `/me/accounts`, `/me/adaccounts` → `/act_<id>/campaigns`).

**Not OAuth, and deliberately so.** Meta's only CLI-shaped OAuth (Device Login) yields a ~60-day expiring *user* token plus an embedded App ID — a regression for a container-baked automation CLI, whose correct credential is the non-expiring system-user token. The saved file is **plaintext on disk at `0600`**; `META_ACCESS_TOKEN` remains the option for anyone who does not want a token on disk.

## API version

- Single constant, initial value **`v26.0`**.
- `--api-version=vNN.0` overrides it **per call** (ships in the tracer, #5 — a one-line branch on the constant).

### Two tracks

Graph API and Marketing API are versioned on **separate changelogs with different expiry dates for the same number**. Conflating them is the easy mistake.

| Track | Latest | Note |
|---|---|---|
| Graph API | v26.0 (2026-07-29) | what `fbg` targets: businesses, system users, assets, audiences, webhooks |
| Marketing API | v25.0 (2026-02-18) | no v26.0 changelog published; expiries far shorter (v24.0 ends 2026-10-06) |

Paths under `/act_<id>/…` are Marketing API. **Measured under [#8](https://github.com/realroboto/meta-graph-cli/issues/8) (2026-09-12): `/act_<id>/campaigns` answers under `v26.0`, read and write.** Against a live ad account, `GET /act_<id>/campaigns` returned a normal (empty) campaign list and `POST /act_<id>/campaigns` (create) then a `DELETE` on the returned campaign all succeeded under the default `v26.0` constant — despite no v26.0 Marketing changelog being published. Only `/campaigns` was exercised; other Marketing paths are unverified but resolve through the same `/v26.0/` namespace. So the global constant stays `v26.0` and no `--api-version` override was needed for that call; the escape hatch stays available per call if a Marketing path ever diverges.

`v26.0` also removed `pretty`, `debug`, `date_format`, legacy `If-None-Match`, and root `GET /?ids=`. `fbg` depends on none of them; those removals reach every still-supported version on 2026-10-27, so pinning older buys nothing.

## Pagination

`--paginate` follows `paging.next` until it runs out, emitting one JSON document per page. Without the flag, exactly one request goes out even when `paging.next` is present. A failing page mid-pagination exits non-zero through `renderResponse` rather than silently truncating.

The return is **buffered** (`{ stdout, ... }`), not streamed — see [ADR-0001](adr/0001-buffered-run-return.md).

## Stack

- Node ≥ 24, zero runtime dependencies (native `fetch`).
- TypeScript 7 strict. **Buildless dev**: Node type-strips `.ts` at runtime. **Publish compiles**: `prepack` emits `dist/*.js` (`tsconfig.build.json`, `rewriteRelativeImportExtensions`) and the tarball ships that, not `.ts` — Node refuses to strip types under `node_modules`, so a raw-`.ts` dependency will not run once installed. `dist/` is git-ignored.
- `tsconfig` sets `erasableSyntaxOnly` — no `enum`, `namespace`, or parameter properties (they pass typecheck, fail at runtime).
- Biome for lint + format. pnpm 12 pinned via `packageManager`.

## Testing

Test **only external behavior**, through the seam: given an argv and a fake `fetch`, assert stdout, stderr, and exit code. No test knows internal function names, internal shapes, or call order. No test touches the network.

Cases:

- `GET` builds the URL from the version constant and passes flags as query params.
- `POST` sends flags in the body, query string stays empty.
- `--api-version` overrides the constant.
- Missing token fails with its own message, never calls `fetch`.
- Token present → `Authorization: Bearer` header.
- `auth login` prompts hidden, validates, and on success saves the token (dir `0700`, file `0600`); an invalid token writes nothing.
- `auth status` introspects the resolved token; `META_ACCESS_TOKEN` wins over the saved file, and the file fills in when the env is empty.
- The token never appears on stdout or stderr.
- `auth logout` removes the saved file and is idempotent when nothing is saved.
- An unknown `auth` subcommand fails with usage and never calls `fetch`.
- 200-with-`error` body → exit ≠ 0, `error` on stderr *(the case that justifies the project)*.
- Status ≥ 400 → same.
- Success → compact JSON on stdout, exit 0.
- `--paginate` follows `paging.next` to the end and stops when it is absent.
- Without `--paginate`, one request only, even with `paging.next` present.
- `--help` → exit 0, never calls `fetch`.

The Marketing-track measurement (#8) is a **manual network spike**, not part of the suite.

## Out of scope

Endpoint curation (field/type/enum validation) · OAuth / Device Login / token exchange / automatic token minting · token refresh or rotation · storing ids or defaults · OS keychain / secret store (the `0600` file is the scope) · multiple credential profiles · cache, retry, backoff, rate-limit handling · file upload / `multipart` · batch and multi-get · agent skill · any change to the vmCODE repo.

## Consumer

[realroboto/vmCODE#267](https://github.com/realroboto/vmCODE/issues/267) installs `fbg` as a global npm binary at image-build time, pinned `latest`, and retires the two Meta MCPs. A published break reaches it on the next rebuild — bump the major for anything that changes the command shape, the exit codes, or the error contract.
