// The one seam. `run` parses argv, builds the request, injects the token,
// and applies the error contract — all I/O injected so it needs no network.
// See docs/SPEC.md. The load-bearing contract lives at renderResponse.

const GRAPH_HOST = 'https://graph.facebook.com';

// Single API-version constant. --api-version overrides it per call.
const API_VERSION = 'v26.0';

const HELP = `fbg <VERB> <path> [--k=v ...] [--paginate] [--api-version=vNN.0]

A passthrough CLI for the Meta Graph API.

  --k=v            query params on GET, form body on every other verb
  --api-version    override the API version for one call (default ${API_VERSION})
  --paginate       follow paging.next until it runs out
  --help           show this message

Auth: export META_ACCESS_TOKEN, or run \`fbg auth login\` to save a token.
The env var wins over the saved file, so CI stays unchanged.

  fbg auth login    prompt for a system-user token, validate it, and save it
  fbg auth status   show the current token's identity, app, scopes, and expiry
  fbg auth logout   remove the saved token

  fbg GET /me --fields=id,name`;

// Missing-token message. Names the env var (so tooling can key off it) and
// points at the login command as the other way to supply a credential.
const MISSING_TOKEN =
  'META_ACCESS_TOKEN is not set and no saved credential was found. Run `fbg auth login`, or export a Meta system-user token.';

// Interactive prompt, injected so login is testable without a tty. `hidden`
// suppresses the terminal echo for secrets.
type Io = {
  prompt: (label: string, opts?: { hidden?: boolean }) => Promise<string>;
};

// The credential-file primitives, injected so the save/load/remove orchestration
// (path, 0700 dir, 0600 file) is exercised through the seam with no real disk.
// readFile resolves null when the file is absent; rm is a no-op when it is.
type CredentialFs = {
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, opts: { recursive: boolean; mode: number }) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  rm: (path: string) => Promise<void>;
};

type Deps = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  io?: Io;
  fs?: CredentialFs;
};

type Result = {
  stdout: string;
  stderr: string;
  code: number;
};

// The one internal checkpoint every fetch result passes through. The error
// contract is written here once: an `error` body (even under HTTP 200) or a
// status >= 400 exits non-zero with the error on stderr; success is compact
// JSON on stdout, exit 0.
async function renderResponse(res: Response): Promise<Result> {
  const body = await res.json();
  if (body?.error || res.status >= 400) {
    return { stdout: '', stderr: JSON.stringify(body?.error ?? body), code: 1 };
  }
  return { stdout: JSON.stringify(body), stderr: '', code: 0 };
}

// Cursor-based pagination: paging.next is a full absolute URL that carries the
// next cursor. Absent -> last page. https://developers.facebook.com/docs/graph-api/results
function nextPage(stdout: string): string | undefined {
  return JSON.parse(stdout)?.paging?.next;
}

// The saved credential lives at $XDG_CONFIG_HOME/fbg/ (falling back to
// ~/.config/fbg/), POSIX-only — the only platforms `fbg` targets.
function credentialDir(env: Record<string, string | undefined>): string {
  const base = env.XDG_CONFIG_HOME || `${env.HOME}/.config`;
  return `${base}/fbg`;
}

function credentialPath(env: Record<string, string | undefined>): string {
  return `${credentialDir(env)}/credentials.json`;
}

// The token, resolved with the env var winning over the saved file — so a
// container that exports META_ACCESS_TOKEN behaves exactly as before, and the
// file only fills in when the env is empty. undefined -> caller emits the guard.
async function resolveToken(
  env: Record<string, string | undefined>,
  fs?: CredentialFs,
): Promise<string | undefined> {
  if (env.META_ACCESS_TOKEN) return env.META_ACCESS_TOKEN;
  if (!fs) return undefined;
  const raw = await fs.readFile(credentialPath(env));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === 'string' ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

// Introspect a token: /debug_token for app/scopes/expiry, /me for the identity
// behind it. Both authorize with the token as a Bearer header; input_token must
// ride the query string because /debug_token is GET-only and reads it there.
// An invalid token fails through the same error contract (exit != 0, stderr).
async function authIntrospect(
  token: string,
  fetch: typeof globalThis.fetch,
  version: string,
): Promise<Result> {
  const headers = { Authorization: `Bearer ${token}` };
  const debugUrl = `${GRAPH_HOST}/${version}/debug_token?input_token=${encodeURIComponent(token)}`;
  const debug = await renderResponse(await fetch(debugUrl, { headers }));
  if (debug.code !== 0) return debug;

  const data = JSON.parse(debug.stdout)?.data;
  if (!data?.is_valid) {
    return {
      stdout: '',
      stderr: JSON.stringify(data ?? { message: 'token is not valid' }),
      code: 1,
    };
  }

  const me = await renderResponse(
    await fetch(`${GRAPH_HOST}/${version}/me?fields=id,name`, { headers }),
  );
  if (me.code !== 0) return me;
  const identity = JSON.parse(me.stdout);

  const summary = {
    identity: { id: identity.id, name: identity.name },
    app_id: data.app_id,
    application: data.application,
    type: data.type,
    scopes: data.scopes,
    expires_at: data.expires_at,
    data_access_expires_at: data.data_access_expires_at,
  };
  return { stdout: JSON.stringify(summary), stderr: '', code: 0 };
}

// Prompt for a token (hidden), validate it, and only then persist it — an
// invalid token writes nothing. The summary echoed on success never contains
// the token itself.
async function authLogin(
  io: Io,
  fs: CredentialFs,
  fetch: typeof globalThis.fetch,
  env: Record<string, string | undefined>,
  version: string,
): Promise<Result> {
  const token = (await io.prompt('Paste your META_ACCESS_TOKEN', { hidden: true })).trim();
  if (!token) {
    return { stdout: '', stderr: 'No token entered.', code: 1 };
  }

  const status = await authIntrospect(token, fetch, version);
  if (status.code !== 0) return status;

  const path = credentialPath(env);
  await fs.mkdir(credentialDir(env), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, JSON.stringify({ token }));
  await fs.chmod(path, 0o600);
  return status;
}

// Remove the saved credential, idempotent: reports whether one was there.
async function authLogout(
  fs: CredentialFs,
  env: Record<string, string | undefined>,
): Promise<Result> {
  const path = credentialPath(env);
  const removed = (await fs.readFile(path)) !== null;
  await fs.rm(path);
  return { stdout: JSON.stringify({ removed }), stderr: '', code: 0 };
}

// `fbg auth <sub>`: login | status | logout. Its own dispatch, separate from
// the VERB+path passthrough — `auth` is never an HTTP verb.
async function runAuth(args: string[], deps: Deps, version: string): Promise<Result> {
  const sub = args[0];

  if (sub === 'login') {
    const { io, fs } = deps;
    if (!io || !fs) {
      return { stdout: '', stderr: 'auth login needs an interactive terminal.', code: 1 };
    }
    return authLogin(io, fs, deps.fetch, deps.env, version);
  }

  if (sub === 'status') {
    const token = await resolveToken(deps.env, deps.fs);
    if (!token) return { stdout: '', stderr: MISSING_TOKEN, code: 1 };
    return authIntrospect(token, deps.fetch, version);
  }

  if (sub === 'logout') {
    const { fs } = deps;
    if (!fs) return { stdout: '', stderr: 'auth logout needs filesystem access.', code: 1 };
    return authLogout(fs, deps.env);
  }

  return {
    stdout: '',
    stderr: `Unknown auth subcommand${sub ? `: ${sub}` : ''}. Usage: fbg auth login|status|logout`,
    code: 1,
  };
}

export async function run(argv: string[], deps: Deps): Promise<Result> {
  const { fetch, env } = deps;
  if (argv.length === 0 || argv.includes('--help')) {
    return { stdout: HELP, stderr: '', code: 0 };
  }

  if (argv[0] === 'auth') {
    return runAuth(argv.slice(1), deps, API_VERSION);
  }

  const [verb, path, ...rest] = argv;

  let version = API_VERSION;
  let paginate = false;
  const params = new URLSearchParams();
  for (const arg of rest) {
    if (arg === '--paginate') {
      paginate = true;
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq === -1) continue; // not a --k=v flag
    const key = arg.slice(2, eq); // strip leading --
    const value = arg.slice(eq + 1);
    if (key === 'api-version') {
      version = value;
      continue;
    }
    params.set(key, value);
  }

  const token = await resolveToken(env, deps.fs);
  if (!token) {
    return { stdout: '', stderr: MISSING_TOKEN, code: 1 };
  }

  // Flags are query params on GET, form body on every other verb, so their
  // values never land in proxy logs or shell-history echoes. Passing the
  // URLSearchParams as the body makes fetch set application/x-www-form-urlencoded.
  const isGet = verb.toUpperCase() === 'GET';
  const query = isGet ? params.toString() : '';
  const init = {
    method: verb,
    headers: { Authorization: `Bearer ${token}` },
    ...(isGet ? {} : { body: params }),
  };

  // One request unless --paginate; then follow paging.next until it runs out,
  // each page through the same renderResponse checkpoint, so a failing page
  // fails through the contract instead of silently truncating. Every page is
  // buffered before returning (ADR-0001), emitted as one JSON document each.
  let url: string | undefined = `${GRAPH_HOST}/${version}${path}${query ? `?${query}` : ''}`;
  const pages: string[] = [];
  while (url) {
    const rendered = await renderResponse(await fetch(url, init));
    if (rendered.code !== 0) return rendered;
    pages.push(rendered.stdout);
    url = paginate ? nextPage(rendered.stdout) : undefined;
  }

  return { stdout: pages.join('\n'), stderr: '', code: 0 };
}
