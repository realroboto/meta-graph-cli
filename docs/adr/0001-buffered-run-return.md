# ADR-0001 — `run` returns buffered strings, not a stream

- **Status:** Accepted
- **Date:** 2026-09-12
- **Context:** pre-implementation architecture review of [issue #1](https://github.com/realroboto/meta-graph-cli/issues/1) and tickets #5–#9.

## Decision

The one seam returns a fully buffered result:

```ts
run(argv, deps): Promise<{ stdout: string; stderr: string; code: number }>
```

Under `--paginate`, every page is accumulated into `stdout` before `bin/fbg.ts` writes a byte. `run` does **not** return an `AsyncIterable` of pages or stream to a writable.

## Context

`--paginate` (#7) can walk large collections — activity logs, `owned_ad_accounts`. A streaming interface (async-iterable of pages, bin drains it) would hold constant memory instead of the whole result set.

## Why buffered wins here

- **Depth / small interface.** `{ stdout, stderr, code }` is the smallest surface a caller must learn. A stream widens the interface (iteration protocol, backpressure, partial-write semantics).
- **The interface is the test surface.** Buffered strings make every case a plain equality assertion through the seam with an injected `fetch`. A stream forces tests to collect chunks and reason about ordering.
- **The error contract stays simple.** Buffered, a failing page returns `code ≠ 0` cleanly. Streaming interleaves the contract with an in-flight stdout stream — the load-bearing behavior gets harder to keep correct and to test.
- **YAGNI.** Result sets are usually small; no measured memory pressure exists. The cost is paid only if a real set hurts.

## Consequences

- Large paginated sets are held in memory before output. Accepted.
- Revisit only on evidence: a real `--paginate` call that exhausts memory. At that point, prefer streaming **only** the paginated path, keeping the single-request path buffered.
- Recorded so future architecture reviews do not re-suggest streaming without that evidence.
