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

Auth: export META_ACCESS_TOKEN with a Meta system-user token.

  fbg GET /me --fields=id,name`;

type Deps = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
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

export async function run(argv: string[], { fetch, env }: Deps): Promise<Result> {
  if (argv.length === 0 || argv.includes('--help')) {
    return { stdout: HELP, stderr: '', code: 0 };
  }

  const [verb, path, ...rest] = argv;

  let version = API_VERSION;
  const params = new URLSearchParams();
  for (const arg of rest) {
    if (arg === '--paginate') continue; // reserved; #7 owns it
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

  const token = env.META_ACCESS_TOKEN;
  if (!token) {
    return {
      stdout: '',
      stderr: 'META_ACCESS_TOKEN is not set. Export a Meta system-user token.',
      code: 1,
    };
  }

  const query = params.toString();
  const url = `${GRAPH_HOST}/${version}${path}${query ? `?${query}` : ''}`;

  const res = await fetch(url, {
    method: verb,
    headers: { Authorization: `Bearer ${token}` },
  });

  return renderResponse(res);
}
