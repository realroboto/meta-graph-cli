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

// A fetch that must never run: fails the test if called.
function neverFetch() {
  const calls: unknown[] = [];
  const fn = async () => {
    calls.push(1);
    throw new Error('fetch must not be called');
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

const TOKEN = { META_ACCESS_TOKEN: 'tok_abc' };

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

test('--help states the command shape, exits 0, and never calls fetch', async () => {
  const fetch = neverFetch();
  const res = await run(['--help'], { fetch, env: {} });

  assert.equal(fetch.calls.length, 0);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /fbg <VERB> <path>/);
});
