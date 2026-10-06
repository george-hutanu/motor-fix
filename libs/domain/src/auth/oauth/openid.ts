import {
  createHash,
  createPublicKey,
  createSign,
  createVerify,
  type JsonWebKey,
  randomBytes,
} from 'node:crypto';

import type { OAuthProvider } from '@motor-fix/contracts';

// Why a provider's answer was not accepted. The message names the check,
// never a token, a code or an e-mail.
export class OpenIdError extends Error {}

export interface Person {
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

// A provider call that does not answer in this long counts as down.
const TIMEOUT_MS = 5000;
// Expiry is checked with a minute's grace for clocks that disagree.
const SKEW_S = 60;
const DISCOVERY_MS = 3_600_000;

const base64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export const randomToken = () => randomBytes(32).toString('base64url');

export function pkce() {
  const verifier = randomToken();
  return {
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    verifier,
  };
}

export function authorizationUrl(
  provider: OAuthProvider,
  flow: {
    challenge: string;
    clientId: string;
    endpoint: string;
    nonce: string;
    redirectUri: string;
    state: string;
  },
): string {
  const url = new URL(flow.endpoint);
  const params = {
    client_id: flow.clientId,
    code_challenge: flow.challenge,
    code_challenge_method: 'S256',
    nonce: flow.nonce,
    redirect_uri: flow.redirectUri,
    response_type: 'code',
    // Apple sends the name and e-mail only when asked, and then only by post.
    ...(provider === 'apple'
      ? { response_mode: 'form_post', scope: 'openid email name' }
      : { scope: 'openid email profile' }),
    state: flow.state,
  };
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

// Apple takes, in place of a client secret, a token signed with the team's key.
export function appleClientSecret(input: {
  audience: string;
  clientId: string;
  keyId: string;
  now: number;
  privateKey: string;
  teamId: string;
}): string {
  const iat = Math.floor(input.now / 1000);
  const data = `${base64url({ alg: 'ES256', kid: input.keyId })}.${base64url({
    aud: input.audience,
    exp: iat + 300,
    iat,
    iss: input.teamId,
    sub: input.clientId,
  })}`;
  const signature = createSign('sha256')
    .update(data)
    .sign({ dsaEncoding: 'ieee-p1363', key: input.privateKey })
    .toString('base64url');
  return `${data}.${signature}`;
}

function part(segment: string, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(segment, 'base64url').toString(),
    );
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  throw new OpenIdError(`unreadable ID token ${what}`);
}

type Key = JsonWebKey & { kid?: string };

interface Check {
  audience: string;
  issuers: readonly string[];
  keys: readonly Key[];
  nonce: string;
  now: number;
}

// The claims of a token signed, with RS256 only, by one of the keys.
function signedClaims(idToken: string, keys: readonly Key[]) {
  const segments = idToken.split('.');
  if (segments.length !== 3) throw new OpenIdError('malformed ID token');
  const [head, body, signature] = segments;
  const header = part(head, 'header');
  if (header['alg'] !== 'RS256') throw new OpenIdError('unexpected algorithm');
  const kid = header['kid'];
  const jwk =
    typeof kid === 'string' ? keys.find((key) => key.kid === kid) : undefined;
  if (!jwk) throw new OpenIdError('unknown signing key');
  let valid: boolean;
  try {
    valid = createVerify('sha256')
      .update(`${head}.${body}`)
      .verify(
        createPublicKey({ format: 'jwk', key: jwk }),
        Buffer.from(signature, 'base64url'),
      );
  } catch {
    valid = false;
  }
  if (!valid) throw new OpenIdError('bad signature');
  return part(body, 'claims');
}

function checkClaims(claims: Record<string, unknown>, check: Check) {
  if (!check.issuers.includes(claims['iss'] as string)) {
    throw new OpenIdError('wrong issuer');
  }
  const audience = claims['aud'];
  if (![audience].flat().includes(check.audience)) {
    throw new OpenIdError('wrong audience');
  }
  if (!claims['nonce'] || claims['nonce'] !== check.nonce) {
    throw new OpenIdError('wrong nonce');
  }
  const exp = claims['exp'];
  if (typeof exp !== 'number' || exp + SKEW_S < check.now / 1000) {
    throw new OpenIdError('expired');
  }
}

const filled = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export function verifyIdToken(idToken: string, check: Check): Person {
  const claims = signedClaims(idToken, check.keys);
  checkClaims(claims, check);
  const subject = claims['sub'];
  if (typeof subject !== 'string' || !subject) {
    throw new OpenIdError('no subject');
  }
  const email = filled(claims['email']);
  return {
    email,
    // Apple writes it as a string; with no e-mail there is nothing verified.
    emailVerified:
      email !== undefined &&
      (claims['email_verified'] === true ||
        claims['email_verified'] === 'true'),
    name: filled(claims['name']),
    subject,
  };
}

interface Discovered {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  keys?: Key[];
  at: number;
}

async function getJson(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let answer: Response;
  try {
    answer = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OpenIdError('provider did not answer');
  }
  if (!answer.ok) {
    throw new OpenIdError(`provider answered ${answer.status}`);
  }
  let body: unknown;
  try {
    body = await answer.json();
  } catch {
    throw new OpenIdError('provider answered no JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OpenIdError('provider answered no JSON object');
  }
  return body as Record<string, unknown>;
}

const text = (value: unknown, what: string) => {
  if (typeof value !== 'string' || !value) {
    throw new OpenIdError(`provider answer lacks ${what}`);
  }
  return value;
};

// The provider's addresses and keys, read once an hour.
export class OpenIdClient {
  private readonly cache = new Map<string, Discovered>();

  async discover(issuer: string): Promise<Discovered> {
    const cached = this.cache.get(issuer);
    if (cached && Date.now() - cached.at < DISCOVERY_MS) return cached;
    const config = await getJson(`${issuer}/.well-known/openid-configuration`);
    const found: Discovered = {
      at: Date.now(),
      authorizationEndpoint: text(
        config['authorization_endpoint'],
        'authorization_endpoint',
      ),
      jwksUri: text(config['jwks_uri'], 'jwks_uri'),
      tokenEndpoint: text(config['token_endpoint'], 'token_endpoint'),
    };
    this.cache.set(issuer, found);
    return found;
  }

  // `fresh` reads them again: a provider rotates its keys.
  async keys(issuer: string, fresh = false): Promise<Key[]> {
    const found = await this.discover(issuer);
    if (!found.keys || fresh) {
      const set = await getJson(found.jwksUri);
      if (!Array.isArray(set['keys'])) throw new OpenIdError('no key set');
      found.keys = set['keys'] as Key[];
    }
    return found.keys;
  }

  // The ID token the code buys.
  async exchange(
    issuer: string,
    form: Record<string, string>,
  ): Promise<string> {
    const { tokenEndpoint } = await this.discover(issuer);
    const answer = await getJson(tokenEndpoint, {
      body: new URLSearchParams(form),
      headers: { accept: 'application/json' },
      method: 'POST',
    });
    return text(answer['id_token'], 'id_token');
  }
}
