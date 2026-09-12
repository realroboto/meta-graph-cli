import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { run } from '../src/run.ts';

// A fake fetch that records its calls and returns a canned JSON Response.
// No network: every test crosses only `run` with this injected.
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

// A fake fetch that returns a canned sequence of Responses, one per call, and
// records the calls. Used to drive --paginate across a multi-page collection.
function fakeFetchSeq(pages: { body: unknown; status?: number }[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const page = pages[calls.length];
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(page.body), { status: page.status ?? 200 });
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

// A fetch that must never run: fails the test if called.
function neverFetch() {
  const calls: unknown[] = [];
  const fn = async () => {
    calls.push(1);
    throw new Error('fetch must not be called');
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

// A fake prompt that hands back canned answers and records how it was asked
// (label + whether the input was hidden). No tty: every auth test crosses `run`.
function fakeIo(answers: string[]) {
  const prompts: { label: string; hidden: boolean }[] = [];
  let i = 0;
  return {
    prompts,
    prompt: async (label: string, opts?: { hidden?: boolean }) => {
      prompts.push({ label, hidden: Boolean(opts?.hidden) });
      return answers[i++];
    },
  };
}

// An in-memory credential store standing in for the real filesystem, recording
// the mkdir/chmod modes so a test can assert the 0700 dir and 0600 file perms.
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const mkdirs: { path: string; mode: number }[] = [];
  const chmods: { path: string; mode: number }[] = [];
  return {
    files,
    mkdirs,
    chmods,
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, data: string) => {
      files.set(path, data);
    },
    mkdir: async (path: string, opts: { recursive: boolean; mode: number }) => {
      mkdirs.push({ path, mode: opts.mode });
    },
    chmod: async (path: string, mode: number) => {
      chmods.push({ path, mode });
    },
    rm: async (path: string) => {
      files.delete(path);
    },
  };
}

const TOKEN = { META_ACCESS_TOKEN: 'tok_abc' };

// Home-only env: no token in the environment, so the credential file is the
// only source. The resolved credential path for this env.
const HOME_ENV = { HOME: '/home/u' };
const CRED_PATH = '/home/u/.config/fbg/credentials.json';

// A valid /debug_token payload and the /me identity behind it, in call order.
const DEBUG_OK = {
  data: {
    app_id: '555',
    application: 'My App',
    type: 'SYSTEM_USER',
    is_valid: true,
    scopes: ['ads_management', 'business_management'],
    expires_at: 0,
    data_access_expires_at: 0,
  },
};
const ME_OK = { id: '42', name: 'Sys User' };

test('GET builds the URL from the version constant and passes flags as query params', async () => {
  const fetch = fakeFetch({ id: '1', name: 'X' });
  const res = await run(['GET', '/me', '--fields=id,name'], { fetch, env: TOKEN });

  assert.equal(fetch.calls.length, 1);
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.origin, 'https://graph.facebook.com');
  assert.equal(url.pathname, '/v26.0/me');
  assert.equal(url.searchParams.get('fields'), 'id,name');
  assert.equal((fetch.calls[0].init?.method ?? 'GET').toUpperCase(), 'GET');
  assert.equal(res.code, 0);
});

test('the token is read from META_ACCESS_TOKEN and sent as a bearer header', async () => {
  const fetch = fakeFetch({ id: '1' });
  await run(['GET', '/me'], { fetch, env: TOKEN });

  const headers = new Headers(fetch.calls[0].init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer tok_abc');
});

test('--api-version overrides the version constant for one call', async () => {
  const fetch = fakeFetch({ id: '1' });
  await run(['GET', '/me', '--api-version=v25.0'], { fetch, env: TOKEN });

  assert.equal(new URL(fetch.calls[0].url).pathname, '/v25.0/me');
});

test('the reserved --api-version flag is not sent as a query param', async () => {
  const fetch = fakeFetch({ id: '1' });
  await run(['GET', '/me', '--api-version=v25.0'], { fetch, env: TOKEN });

  assert.equal(new URL(fetch.calls[0].url).searchParams.has('api-version'), false);
});

test('a bare reserved flag is not corrupted into a query param', async () => {
  const fetch = fakeFetch({ id: '1' });
  await run(['GET', '/me', '--paginate'], { fetch, env: TOKEN });

  const url = new URL(fetch.calls[0].url);
  assert.equal(url.search, '');
});

test('a missing token fails with its own message and never calls fetch', async () => {
  const fetch = neverFetch();
  const res = await run(['GET', '/me'], { fetch, env: {} });

  assert.equal(fetch.calls.length, 0);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /META_ACCESS_TOKEN/);
  assert.equal(res.stdout, '');
});

test('success prints compact JSON on stdout and exits 0', async () => {
  const body = { id: '1', name: 'X' };
  const fetch = fakeFetch(body);
  const res = await run(['GET', '/me'], { fetch, env: TOKEN });

  assert.equal(res.code, 0);
  assert.equal(res.stdout, JSON.stringify(body));
  assert.equal(res.stderr, '');
});

test('a 200 response carrying an error body exits non-zero with the error on stderr', async () => {
  const err = { message: 'Invalid OAuth token', type: 'OAuthException', code: 190 };
  const fetch = fakeFetch({ error: err }, 200);
  const res = await run(['GET', '/me'], { fetch, env: TOKEN });

  assert.notEqual(res.code, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, JSON.stringify(err));
});

test('a status at or above 400 exits non-zero with the error on stderr', async () => {
  const err = { message: 'Unsupported get request', type: 'GraphMethodException', code: 100 };
  const fetch = fakeFetch({ error: err }, 400);
  const res = await run(['GET', '/nope'], { fetch, env: TOKEN });

  assert.notEqual(res.code, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, JSON.stringify(err));
});

test('POST sends flags as a form body and leaves the query string empty', async () => {
  const fetch = fakeFetch({ id: 'aud_1' });
  const res = await run(['POST', '/act_123/customaudiences', '--name=X', '--subtype=LOOKALIKE'], {
    fetch,
    env: TOKEN,
  });

  const call = fetch.calls[0];
  const url = new URL(call.url);
  assert.equal(url.pathname, '/v26.0/act_123/customaudiences');
  assert.equal(url.search, '');
  assert.equal((call.init?.method ?? '').toUpperCase(), 'POST');
  const body = new URLSearchParams(call.init?.body as URLSearchParams);
  assert.equal(body.get('name'), 'X');
  assert.equal(body.get('subtype'), 'LOOKALIKE');
  assert.equal(res.code, 0);
});

test('DELETE works with no flags and sends nothing in the query string', async () => {
  const fetch = fakeFetch({ success: true });
  const res = await run(['DELETE', '/aud_1'], { fetch, env: TOKEN });

  const call = fetch.calls[0];
  assert.equal(new URL(call.url).search, '');
  assert.equal((call.init?.method ?? '').toUpperCase(), 'DELETE');
  assert.equal(res.code, 0);
});

test('DELETE carries flags in the form body, not the query string', async () => {
  const fetch = fakeFetch({ success: true });
  await run(['DELETE', '/act_123/adimages', '--hash=abc'], { fetch, env: TOKEN });

  const call = fetch.calls[0];
  assert.equal(new URL(call.url).search, '');
  const body = new URLSearchParams(call.init?.body as URLSearchParams);
  assert.equal(body.get('hash'), 'abc');
});

test('the error contract holds on writes: a 200-with-error POST exits non-zero', async () => {
  const err = { message: 'Invalid parameter', type: 'OAuthException', code: 100 };
  const fetch = fakeFetch({ error: err }, 200);
  const res = await run(['POST', '/act_123/customaudiences', '--name=X'], {
    fetch,
    env: TOKEN,
  });

  assert.notEqual(res.code, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, JSON.stringify(err));
});

test('--paginate follows paging.next to the end, emitting one JSON document per page', async () => {
  const p1 = { data: [1], paging: { next: 'https://graph.facebook.com/v26.0/me/x?after=A' } };
  const p2 = { data: [2], paging: { next: 'https://graph.facebook.com/v26.0/me/x?after=B' } };
  const p3 = { data: [3] }; // no paging.next -> last page
  const fetch = fakeFetchSeq([{ body: p1 }, { body: p2 }, { body: p3 }]);
  const res = await run(['GET', '/me/x', '--paginate'], { fetch, env: TOKEN });

  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[1].url, p1.paging.next);
  assert.equal(fetch.calls[2].url, p2.paging.next);
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, [p1, p2, p3].map((p) => JSON.stringify(p)).join('\n'));
});

test('pagination stops when paging.next is absent', async () => {
  const only = { data: [1] };
  const fetch = fakeFetchSeq([{ body: only }]);
  const res = await run(['GET', '/me/x', '--paginate'], { fetch, env: TOKEN });

  assert.equal(fetch.calls.length, 1);
  assert.equal(res.stdout, JSON.stringify(only));
});

test('without --paginate exactly one request is made even when paging.next is present', async () => {
  const page = { data: [1], paging: { next: 'https://graph.facebook.com/v26.0/me/x?after=A' } };
  const fetch = fakeFetchSeq([{ body: page }]);
  const res = await run(['GET', '/me/x'], { fetch, env: TOKEN });

  assert.equal(fetch.calls.length, 1);
  assert.equal(res.stdout, JSON.stringify(page));
});

test('a failing page mid-pagination exits non-zero rather than truncating', async () => {
  const p1 = { data: [1], paging: { next: 'https://graph.facebook.com/v26.0/me/x?after=A' } };
  const err = { message: 'Rate limit', type: 'OAuthException', code: 4 };
  const fetch = fakeFetchSeq([{ body: p1 }, { body: { error: err }, status: 200 }]);
  const res = await run(['GET', '/me/x', '--paginate'], { fetch, env: TOKEN });

  assert.equal(fetch.calls.length, 2);
  assert.notEqual(res.code, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, JSON.stringify(err));
});

test('--help states the command shape, exits 0, and never calls fetch', async () => {
  const fetch = neverFetch();
  const res = await run(['--help'], { fetch, env: {} });

  assert.equal(fetch.calls.length, 0);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /fbg <VERB> <path>/);
});

test('auth login prompts for the token hidden, validates it, and saves it 0600', async () => {
  const fetch = fakeFetchSeq([{ body: DEBUG_OK }, { body: ME_OK }]);
  const io = fakeIo(['tok_new']);
  const fs = fakeFs();
  const res = await run(['auth', 'login'], { fetch, env: HOME_ENV, io, fs });

  assert.equal(res.code, 0);
  assert.equal(io.prompts.length, 1);
  assert.equal(io.prompts[0].hidden, true);
  // token was validated: debug_token first (input_token carries the token), then /me
  assert.match(fetch.calls[0].url, /\/debug_token\?input_token=tok_new/);
  assert.match(fetch.calls[1].url, /\/me\?fields=id,name/);
  // persisted, with the directory 0700 and the file 0600
  assert.equal(JSON.parse(fs.files.get(CRED_PATH) ?? '{}').token, 'tok_new');
  assert.deepEqual(fs.chmods, [{ path: CRED_PATH, mode: 0o600 }]);
  assert.equal(fs.mkdirs[0].mode, 0o700);
  // summary shows identity/app/scopes; the token itself never surfaces
  assert.match(res.stdout, /Sys User/);
  assert.match(res.stdout, /ads_management/);
  assert.doesNotMatch(res.stdout, /tok_new/);
  assert.doesNotMatch(res.stderr, /tok_new/);
});

test('auth login writes nothing when the token is invalid', async () => {
  const invalid = { data: { is_valid: false, error: { code: 190, message: 'bad token' } } };
  const fetch = fakeFetchSeq([{ body: invalid }]);
  const io = fakeIo(['tok_bad']);
  const fs = fakeFs();
  const res = await run(['auth', 'login'], { fetch, env: HOME_ENV, io, fs });

  assert.notEqual(res.code, 0);
  assert.equal(res.stdout, '');
  assert.equal(fs.files.size, 0);
  assert.equal(fs.chmods.length, 0);
});

test('auth login surfaces a debug_token error and writes nothing', async () => {
  const err = { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 };
  const fetch = fakeFetchSeq([{ body: { error: err }, status: 200 }]);
  const io = fakeIo(['tok_bad']);
  const fs = fakeFs();
  const res = await run(['auth', 'login'], { fetch, env: HOME_ENV, io, fs });

  assert.notEqual(res.code, 0);
  assert.equal(res.stderr, JSON.stringify(err));
  assert.equal(fs.files.size, 0);
});

test('auth status introspects the resolved token: identity, scopes, expiry', async () => {
  const fetch = fakeFetchSeq([{ body: DEBUG_OK }, { body: ME_OK }]);
  const res = await run(['auth', 'status'], { fetch, env: TOKEN });

  assert.equal(res.code, 0);
  const summary = JSON.parse(res.stdout);
  assert.equal(summary.identity.id, '42');
  assert.equal(summary.app_id, '555');
  assert.deepEqual(summary.scopes, ['ads_management', 'business_management']);
  assert.equal(summary.expires_at, 0);
  assert.doesNotMatch(res.stdout, /tok_abc/);
});

test('auth status prefers the env token over the saved file', async () => {
  const fetch = fakeFetchSeq([{ body: DEBUG_OK }, { body: ME_OK }]);
  const fs = fakeFs({ [CRED_PATH]: JSON.stringify({ token: 'tok_file' }) });
  await run(['auth', 'status'], { fetch, env: { ...TOKEN, HOME: '/home/u' }, io: fakeIo([]), fs });

  // env token wins: it is the one carried to debug_token, not the file token
  assert.match(fetch.calls[0].url, /input_token=tok_abc/);
});

test('auth status falls back to the saved file when the env has no token', async () => {
  const fetch = fakeFetchSeq([{ body: DEBUG_OK }, { body: ME_OK }]);
  const fs = fakeFs({ [CRED_PATH]: JSON.stringify({ token: 'tok_file' }) });
  const res = await run(['auth', 'status'], { fetch, env: HOME_ENV, io: fakeIo([]), fs });

  assert.equal(res.code, 0);
  assert.match(fetch.calls[0].url, /input_token=tok_file/);
});

test('a regular command uses the saved file token when the env has none', async () => {
  const fetch = fakeFetch({ id: '1' });
  const fs = fakeFs({ [CRED_PATH]: JSON.stringify({ token: 'tok_file' }) });
  await run(['GET', '/me'], { fetch, env: HOME_ENV, io: fakeIo([]), fs });

  const headers = new Headers(fetch.calls[0].init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer tok_file');
});

test('auth status with no token anywhere fails with its own message and never calls fetch', async () => {
  const fetch = neverFetch();
  const fs = fakeFs();
  const res = await run(['auth', 'status'], { fetch, env: HOME_ENV, io: fakeIo([]), fs });

  assert.equal(fetch.calls.length, 0);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /META_ACCESS_TOKEN/);
});

test('auth logout removes the saved credential and reports it', async () => {
  const fetch = neverFetch();
  const fs = fakeFs({ [CRED_PATH]: JSON.stringify({ token: 'tok_file' }) });
  const res = await run(['auth', 'logout'], { fetch, env: HOME_ENV, io: fakeIo([]), fs });

  assert.equal(res.code, 0);
  assert.equal(fs.files.has(CRED_PATH), false);
  assert.equal(JSON.parse(res.stdout).removed, true);
  assert.equal(fetch.calls.length, 0);
});

test('auth logout is idempotent when nothing is saved', async () => {
  const fetch = neverFetch();
  const fs = fakeFs();
  const res = await run(['auth', 'logout'], { fetch, env: HOME_ENV, io: fakeIo([]), fs });

  assert.equal(res.code, 0);
  assert.equal(JSON.parse(res.stdout).removed, false);
});

test('an unknown auth subcommand fails with usage and never calls fetch', async () => {
  const fetch = neverFetch();
  const res = await run(['auth', 'wibble'], { fetch, env: TOKEN, io: fakeIo([]), fs: fakeFs() });

  assert.equal(fetch.calls.length, 0);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /login\|status\|logout/);
});
