import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in OpenID issuer for the tests: never the real Google or Apple.
// `/authorize` approves at once, for `next`, and redirects back with a code;
// `/token` checks the PKCE verifier and answers an ID token signed with the
// key `/jwks` publishes.
export interface StubPerson {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

export interface OpenIdStub {
  issuer: string;
  next: StubPerson;
  // What the next token call does instead of answering a good ID token.
  // `rotated`: the token is signed with a new key, which `/jwks` now
  // publishes beside the old one.
  fault:
    | null
    | 'down'
    | 'other-key'
    | 'rotated'
    | 'wrong-nonce'
    | 'wrong-audience';
  lastTokenRequest: URLSearchParams | null;
  // How many times `/jwks` was read.
  keyReads: number;
  close(): Promise<void>;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'stub-key';
const ROTATED_KID = 'stub-key-2';

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function idToken(
  claims: Record<string, unknown>,
  fault: OpenIdStub['fault'],
): string {
  const kid = fault === 'rotated' ? ROTATED_KID : KID;
  const data = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode(claims)}`;
  const foreign = fault === 'other-key' || fault === 'rotated';
  const signature = createSign('sha256')
    .update(data)
    .sign(foreign ? other.privateKey : privateKey)
    .toString('base64url');
  return `${data}.${signature}`;
}

interface Grant {
  challenge: string;
  clientId: string;
  nonce: string;
  person: StubPerson;
}

type Answer = [status: number, body: unknown];

function authorize(url: URL, stub: OpenIdStub, grants: Map<string, Grant>) {
  const code = randomBytes(16).toString('hex');
  const param = (name: string) => url.searchParams.get(name) ?? '';
  grants.set(code, {
    challenge: param('code_challenge'),
    clientId: param('client_id'),
    nonce: param('nonce'),
    person: { ...stub.next },
  });
  const back = new URL(param('redirect_uri'));
  back.searchParams.set('code', code);
  back.searchParams.set('state', param('state'));
  return back.toString();
}

function token(
  form: URLSearchParams,
  stub: OpenIdStub,
  grants: Map<string, Grant>,
): Answer {
  stub.lastTokenRequest = form;
  if (stub.fault === 'down') return [500, { error: 'server_error' }];
  const code = form.get('code') ?? '';
  const grant = grants.get(code);
  grants.delete(code);
  const challenge = createHash('sha256')
    .update(form.get('code_verifier') ?? '')
    .digest('base64url');
  if (!grant || grant.challenge !== challenge) {
    return [400, { error: 'invalid_grant' }];
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: stub.fault === 'wrong-audience' ? 'someone-else' : grant.clientId,
    exp: now + 600,
    iat: now,
    iss: stub.issuer,
    nonce: stub.fault === 'wrong-nonce' ? 'another' : grant.nonce,
    ...grant.person,
  };
  return [
    200,
    {
      access_token: 'unused',
      id_token: idToken(claims, stub.fault),
      token_type: 'Bearer',
    },
  ];
}

function published(stub: OpenIdStub, path: string): Answer | null {
  if (path === '/.well-known/openid-configuration') {
    return [
      200,
      {
        authorization_endpoint: `${stub.issuer}/authorize`,
        issuer: stub.issuer,
        jwks_uri: `${stub.issuer}/jwks`,
        token_endpoint: `${stub.issuer}/token`,
      },
    ];
  }
  if (path === '/jwks') {
    stub.keyReads += 1;
    const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: KID }];
    if (stub.fault === 'rotated') {
      keys.push({
        ...other.publicKey.export({ format: 'jwk' }),
        kid: ROTATED_KID,
      });
    }
    return [
      200,
      { keys: keys.map((key) => ({ ...key, alg: 'RS256', use: 'sig' })) },
    ];
  }
  return null;
}

export async function startOpenIdStub(): Promise<OpenIdStub> {
  const grants = new Map<string, Grant>();
  let server: Server | null = null;
  const stub: OpenIdStub = {
    close: () =>
      new Promise((done) => {
        server?.closeAllConnections();
        server?.close(() => done());
      }),
    fault: null,
    issuer: '',
    keyReads: 0,
    lastTokenRequest: null,
    next: { email: 'elena@example.test', email_verified: true, sub: 'sub-1' },
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', stub.issuer);
    const send = ([status, body]: Answer) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/authorize') {
      res.writeHead(302, { location: authorize(url, stub, grants) });
      res.end();
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => send(token(new URLSearchParams(raw), stub, grants)));
      return;
    }
    send(published(stub, url.pathname) ?? [404, { error: 'not_found' }]);
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  stub.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return stub;
}
