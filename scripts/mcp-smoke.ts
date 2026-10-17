// Checks that a deployed MCP address is ready for Claude and ChatGPT to
// connect, without any credential: the unsigned request's 401 points to the
// sign-in metadata, the identity server publishes what an assistant needs, and
// it lets each assistant register itself. Every client it registers is deleted
// again. One line per step; exit 0 when all passed, 1 when one failed, 2 on a
// usage error. Run by the release's staging job and by the owner:
//
//   node scripts/mcp-smoke.ts https://<mcp host>/mcp
//
// It never prints a token, a registration access token or a client secret.

type Json = Record<string, unknown>;
type Line = (line: string) => void;
type Send = (url: string, init?: RequestInit) => Promise<Response>;

interface Options {
  timeoutMs?: number;
  out?: Line;
  err?: Line;
}

interface Registered {
  name: string;
  origin: string;
  uri?: string;
  token?: string;
}

// The two assistants' published OAuth callbacks; both hosts are trusted by
// the realm's registration policy (infra/keycloak/realm-motorfix-assistants.json).
const ASSISTANTS = [
  ['claude', 'https://claude.ai/api/mcp/auth_callback'],
  ['chatgpt', 'https://chatgpt.com/connector_platform_oauth_redirect'],
] as const;

class Failed extends Error {}

export async function run(
  argv: string[],
  { timeoutMs = 10_000, out = console.log, err = console.error }: Options = {},
): Promise<number> {
  const address = absolute(argv[0]);
  if (argv.length !== 1 || !address) {
    err('usage: node scripts/mcp-smoke.ts <mcp-url>');
    return 2;
  }
  let failed = false;
  const step = async <T>(name: string, body: () => Promise<[T, string]>) => {
    try {
      const [value, detail] = await body();
      out(`PASS ${name} — ${detail}`);
      return value;
    } catch (error) {
      failed = true;
      out(`FAIL ${name} — ${reason(error, timeoutMs)}`);
      return undefined;
    }
  };
  const skip = (...names: string[]) => {
    for (const name of names)
      out(`SKIP ${name} — not run: an earlier step failed`);
  };
  const send: Send = (url, init = {}) =>
    fetch(url, {
      ...init,
      // A redirect is reported, never followed: a delete carries a token.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

  const later = ['register claude', 'register chatgpt'];
  const metadata = await step('challenge', () => challenge(address, send));
  if (!metadata) {
    skip('resource metadata', 'server metadata', ...later);
    return 1;
  }
  const issuer = await step('resource metadata', () =>
    resource(metadata, address, send),
  );
  if (!issuer) {
    skip('server metadata', ...later);
    return 1;
  }
  const registration = await step('server metadata', () =>
    server(issuer, send),
  );
  if (!registration) {
    skip(...later);
    return 1;
  }

  const registered: Registered[] = [];
  try {
    for (const [name, callback] of ASSISTANTS) {
      await step(`register ${name}`, () =>
        register(registration, name, callback, send, registered),
      );
    }
  } finally {
    for (const client of registered) {
      await step(`delete ${client.name}`, () => remove(client, send));
    }
  }
  return failed ? 1 : 0;
}

async function challenge(
  address: string,
  send: Send,
): Promise<[string, string]> {
  const res = await send(address, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  await res.body?.cancel();
  if (res.status !== 401) throw new Failed(`expected 401, got ${res.status}`);
  const header = res.headers.get('www-authenticate') ?? '';
  const bearer = bearerParams(header);
  if (!bearer) throw new Failed('the 401 has no Bearer challenge');
  const metadata = absolute(bearer.get('resource_metadata'));
  if (!metadata) {
    throw new Failed('the challenge names no absolute resource_metadata');
  }
  return [metadata, `401 with resource_metadata ${metadata}`];
}

// The parameters of the Bearer challenge, or undefined when there is none.
// One header may carry several challenges (`Basic realm="x", Bearer a="b"`):
// a comma-separated part that is not `name=value` starts the next one.
function bearerParams(header: string): Map<string, string> | undefined {
  const challenges: { scheme: string; params: Map<string, string> }[] = [];
  for (const raw of header.match(/(?:[^",]|"(?:[^"\\]|\\.)*")+/g) ?? []) {
    const part = raw.trim();
    const param = authParam(part);
    const last = challenges.at(-1);
    if (param && last) {
      last.params.set(...param);
      continue;
    }
    const scheme = /^\S+/.exec(part)?.[0] ?? '';
    const first = authParam(part.slice(scheme.length).trim());
    challenges.push({
      params: new Map(first ? [first] : []),
      scheme: scheme.toLowerCase(),
    });
  }
  return challenges.find((c) => c.scheme === 'bearer')?.params;
}

// `name=value` or `name="quoted \" value"`, the name lower-cased.
function authParam(part: string): [string, string] | undefined {
  const match =
    /^([\w!#$%&'*+.^`|~-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\S*))$/.exec(part);
  if (!match?.[1]) return undefined;
  const quoted = match[2]?.replace(/\\(.)/g, '$1');
  return [match[1].toLowerCase(), quoted ?? match[3] ?? ''];
}

async function resource(
  url: string,
  address: string,
  send: Send,
): Promise<[string, string]> {
  const body = await readJson(send, url);
  const named = typeof body['resource'] === 'string' ? body['resource'] : '';
  if (trim(named) !== trim(address)) {
    throw new Failed(`resource is ${named || '(none)'}, expected ${address}`);
  }
  const servers = body['authorization_servers'];
  if (!Array.isArray(servers) || servers.length !== 1 || !str(servers[0])) {
    throw new Failed(
      `expected exactly one authorization server, got ${Array.isArray(servers) ? servers.length : 'none'}`,
    );
  }
  return [servers[0], `authorization server ${servers[0]}`];
}

async function server(issuer: string, send: Send): Promise<[string, string]> {
  const body = await readJson(
    send,
    `${trim(issuer)}/.well-known/oauth-authorization-server`,
  );
  if (body['issuer'] !== issuer) {
    throw new Failed(`issuer is ${String(body['issuer'])}, expected ${issuer}`);
  }
  for (const key of [
    'authorization_endpoint',
    'token_endpoint',
    'registration_endpoint',
  ]) {
    const value = str(body[key]);
    if (!value) throw new Failed(`no ${key}`);
    if (!absolute(value)) {
      throw new Failed(`${key} is not an absolute http(s) URL: ${value}`);
    }
  }
  const methods = body['code_challenge_methods_supported'];
  if (!Array.isArray(methods) || !methods.includes('S256')) {
    throw new Failed('S256 is not among code_challenge_methods_supported');
  }
  return [
    body['registration_endpoint'] as string,
    'issuer, endpoints and S256 present',
  ];
}

async function register(
  endpoint: string,
  name: string,
  callback: string,
  send: Send,
  registered: Registered[],
): Promise<[true, string]> {
  const res = await send(endpoint, {
    body: JSON.stringify({
      client_name: `MotorFix smoke check (${name})`,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [callback],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const body = asObject(await res.json().catch(() => undefined));
  if (!res.ok)
    throw new Failed(`refused with ${res.status}${oauthError(body)}`);
  if (!str(body['client_id'])) {
    throw new Failed('the answer carries no client id');
  }
  registered.push({
    name,
    origin: new URL(endpoint).origin,
    token: str(body['registration_access_token']),
    uri: str(body['registration_client_uri']),
  });
  return [true, `client registered for ${callback}`];
}

async function remove(client: Registered, send: Send): Promise<[true, string]> {
  if (!absolute(client.uri) || !client.uri || !client.token) {
    throw new Failed(
      'the registration gave no address and token to delete it with',
    );
  }
  // The token goes only to the identity server that issued it.
  if (new URL(client.uri).origin !== client.origin) {
    throw new Failed(
      `the registration names a delete address on another host (${new URL(client.uri).origin})`,
    );
  }
  const res = await send(client.uri, {
    headers: { authorization: `Bearer ${client.token}` },
    method: 'DELETE',
  });
  await res.body?.cancel();
  if (!res.ok) throw new Failed(`delete refused with ${res.status}`);
  return [true, 'client deleted'];
}

async function readJson(send: Send, url: string): Promise<Json> {
  const res = await send(url);
  const text = await res.text();
  if (!res.ok) throw new Failed(`${url} answered ${res.status}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // reported below
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Failed(`${url} answered something that is not JSON`);
  }
  return body as Json;
}

// A JSON object, or an empty one for anything else (null, an array, no JSON).
const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

// Only the OAuth error code: a description could echo what was sent.
function oauthError(body: Json): string {
  const code = body['error'];
  return typeof code === 'string' && /^[a-z_]+$/.test(code) ? ` (${code})` : '';
}

// Errors from fetch may come from another realm (a test runner's), so they
// are read by shape, not by class.
function reason(error: unknown, timeoutMs: number): string {
  if (error instanceof Failed) return error.message;
  const { name, cause } = (error ?? {}) as { name?: string; cause?: unknown };
  if (name === 'TimeoutError') return `no answer within ${timeoutMs / 1000} s`;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return `could not connect${typeof code === 'string' ? ` (${code})` : ''}`;
}

function absolute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

const trim = (value: string) => value.replace(/\/$/, '');
// A non-empty string, or undefined.
const str = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : undefined;

if (process.argv[1]?.endsWith('mcp-smoke.ts')) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
