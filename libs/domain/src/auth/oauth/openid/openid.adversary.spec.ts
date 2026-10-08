import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  appleClientSecret,
  authorizationUrl,
  OpenIdClient,
  OpenIdError,
  pkce,
  randomToken,
  verifyIdToken,
} from './openid';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEYS = [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1' }];
const NOW = 1_800_000_000_000;
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  claims: unknown,
  header: unknown = { alg: 'RS256', kid: 'k1' },
  key = rsa.privateKey,
) {
  const data = `${encode(header)}.${encode(claims)}`;
  return `${data}.${createSign('sha256').update(data).sign(key).toString('base64url')}`;
}

const CLAIMS = {
  aud: 'client-1',
  email: 'elena@example.test',
  email_verified: true,
  exp: NOW / 1000 + 300,
  iss: 'https://issuer.test',
  name: 'Elena Pop',
  nonce: 'n-1',
  sub: 'sub-1',
};
const CHECK = {
  audience: 'client-1',
  issuers: ['https://issuer.test'],
  keys: KEYS,
  nonce: 'n-1',
  now: NOW,
};

describe('verifyIdToken against forged tokens', () => {
  it.each([
    ['an empty string', ''],
    ['only dots', '..'],
    ['one dot', 'a.b'],
    ['empty segments', '.x.'],
    ['non-base64 segments', '!!!.@@@.###'],
    ['a binary blob', Buffer.from([0, 255, 254, 1, 2, 3]).toString('latin1')],
    ['a UTF-16 string with a BOM', '﻿a.b.c'],
    ['an emoji token', '😀.😀.😀'],
  ])('refuses %s with an OpenIdError', (_, idToken) => {
    expect(() => verifyIdToken(idToken, CHECK)).toThrow(OpenIdError);
  });

  it.each([
    ['a JSON null header', 'null'],
    ['a JSON array header', '[]'],
    ['a JSON string header', '"RS256"'],
    ['a header that is not JSON', 'RS256'],
  ])('refuses %s', (_, header) => {
    const body = encode(CLAIMS);
    const head = Buffer.from(header).toString('base64url');
    const data = `${head}.${body}`;
    const sig = createSign('sha256')
      .update(data)
      .sign(rsa.privateKey)
      .toString('base64url');

    expect(() => verifyIdToken(`${data}.${sig}`, CHECK)).toThrow(OpenIdError);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a number', 7],
    ['a string', 'claims'],
  ])('refuses a signed payload that is %s', (_, claims) => {
    expect(() => verifyIdToken(token(claims), CHECK)).toThrow(OpenIdError);
  });

  it('refuses a lower-case algorithm name', () => {
    expect(() =>
      verifyIdToken(token(CLAIMS, { alg: 'rs256', kid: 'k1' }), CHECK),
    ).toThrow(OpenIdError);
  });

  it.each(['ES256', 'PS256', 'RS512', 'EdDSA'])(
    'refuses the algorithm %s',
    (alg) => {
      expect(() =>
        verifyIdToken(token(CLAIMS, { alg, kid: 'k1' }), CHECK),
      ).toThrow(OpenIdError);
    },
  );

  it('refuses a token whose payload was altered after signing', () => {
    const [head, , signature] = token(CLAIMS).split('.');
    const forged = encode({ ...CLAIMS, sub: 'admin' });

    expect(() =>
      verifyIdToken(`${head}.${forged}.${signature}`, CHECK),
    ).toThrow(OpenIdError);
  });

  it('refuses a token with an empty signature', () => {
    const [head, body] = token(CLAIMS).split('.');

    expect(() => verifyIdToken(`${head}.${body}.`, CHECK)).toThrow(OpenIdError);
  });

  it('refuses a token with a truncated signature', () => {
    const idToken = token(CLAIMS);

    expect(() => verifyIdToken(idToken.slice(0, -20), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it('refuses every token when no key is known', () => {
    expect(() => verifyIdToken(token(CLAIMS), { ...CHECK, keys: [] })).toThrow(
      OpenIdError,
    );
  });

  it('refuses with an OpenIdError, not a TypeError, when the matching key is not an RSA key', () => {
    const ecJwk = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'k1' };

    expect(() =>
      verifyIdToken(token(CLAIMS), { ...CHECK, keys: [ecJwk] }),
    ).toThrow(OpenIdError);
  });

  it('refuses with an OpenIdError when the matching key is junk', () => {
    expect(() =>
      verifyIdToken(token(CLAIMS), { ...CHECK, keys: [{ kid: 'k1' }] }),
    ).toThrow(OpenIdError);
  });

  it('refuses a token with no key id when the published keys carry ids', () => {
    expect(() => verifyIdToken(token(CLAIMS, { alg: 'RS256' }), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it('picks the right key out of several', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = [
      { ...other.publicKey.export({ format: 'jwk' }), kid: 'k0' },
      ...KEYS,
    ];

    expect(verifyIdToken(token(CLAIMS), { ...CHECK, keys }).subject).toBe(
      'sub-1',
    );
  });

  it('refuses a token a stale key set signed once its key was rotated away', () => {
    const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = [
      { ...rotated.publicKey.export({ format: 'jwk' }), kid: 'k1' },
    ];

    expect(() => verifyIdToken(token(CLAIMS), { ...CHECK, keys })).toThrow(
      OpenIdError,
    );
  });
});

describe('verifyIdToken claim boundaries', () => {
  it('accepts a token that expired exactly a minute ago', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, exp: NOW / 1000 - 60 }), CHECK).subject,
    ).toBe('sub-1');
  });

  it('refuses a token that expired a minute and a second ago', () => {
    expect(() =>
      verifyIdToken(token({ ...CLAIMS, exp: NOW / 1000 - 61 }), CHECK),
    ).toThrow(OpenIdError);
  });

  it.each([
    ['no expiry', undefined],
    ['a string expiry', String(NOW / 1000 + 300)],
    ['a null expiry', null],
    ['an array expiry', [NOW / 1000 + 300]],
    ['a zero expiry', 0],
    ['a negative expiry', -1],
  ])('refuses %s', (_, exp) => {
    expect(() => verifyIdToken(token({ ...CLAIMS, exp }), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it('accepts an expiry in the far future', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, exp: 99_999_999_999 }), CHECK).subject,
    ).toBe('sub-1');
  });

  it.each([
    ['an empty audience list', []],
    ['an empty audience', ''],
    ['a null audience', null],
    ['a number audience', 1],
    ['a nested audience list', [['client-1']]],
    ['a case-changed audience', 'CLIENT-1'],
    ['an audience with a suffix', 'client-1x'],
    ['an audience with a trailing space', 'client-1 '],
  ])('refuses %s', (_, aud) => {
    expect(() => verifyIdToken(token({ ...CLAIMS, aud }), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it.each([
    ['an issuer with a trailing slash', 'https://issuer.test/'],
    ['an upper-case issuer', 'HTTPS://ISSUER.TEST'],
    ['an issuer as a list', ['https://issuer.test']],
    ['no issuer', undefined],
    ['a null issuer', null],
    ['a prefix of the issuer', 'https://issuer.tes'],
  ])('refuses %s', (_, iss) => {
    expect(() => verifyIdToken(token({ ...CLAIMS, iss }), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it("accepts Google's scheme-less issuer when it is on the allowed list", () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, iss: 'accounts.google.com' }), {
        ...CHECK,
        issuers: ['https://accounts.google.com', 'accounts.google.com'],
      }).subject,
    ).toBe('sub-1');
  });

  it.each([
    ['a numeric nonce', 1],
    ['an array nonce', ['n-1']],
    ['a null nonce', null],
    ['an empty nonce', ''],
    ['a case-changed nonce', 'N-1'],
    ['a nonce with a trailing space', 'n-1 '],
  ])('refuses %s', (_, nonce) => {
    expect(() => verifyIdToken(token({ ...CLAIMS, nonce }), CHECK)).toThrow(
      OpenIdError,
    );
  });

  it('refuses an empty expected nonce even when the token has the same empty one', () => {
    expect(() =>
      verifyIdToken(token({ ...CLAIMS, nonce: '' }), { ...CHECK, nonce: '' }),
    ).toThrow(OpenIdError);
  });

  it.each([
    ['a numeric subject', 42],
    ['a null subject', null],
    ['no subject', undefined],
    ['an array subject', ['x']],
    ['an object subject', { a: 1 }],
  ])('refuses %s', (_, sub) => {
    expect(() => verifyIdToken(token({ ...CLAIMS, sub }), CHECK)).toThrow(
      OpenIdError,
    );
  });
});

describe('verifyIdToken person fields', () => {
  it('reads a person who has no e-mail, as unverified', () => {
    const { email: _e, email_verified: _v, ...bare } = CLAIMS;

    expect(verifyIdToken(token(bare), CHECK)).toEqual({
      email: undefined,
      emailVerified: false,
      name: 'Elena Pop',
      subject: 'sub-1',
    });
  });

  it('never calls an absent e-mail verified, even when the claim says true', () => {
    const { email: _e, ...noEmail } = CLAIMS;

    const person = verifyIdToken(token(noEmail), CHECK);

    expect(person.email).toBeUndefined();
    expect(person.emailVerified).toBe(false);
  });

  it.each([1, 'yes', 'True', 'TRUE', {}, [], null, 'false', 0, ''])(
    'does not read %j as a verified e-mail',
    (value) => {
      expect(
        verifyIdToken(token({ ...CLAIMS, email_verified: value }), CHECK)
          .emailVerified,
      ).toBe(false);
    },
  );

  it.each([['   '], [''], [null], [12], [{}]])(
    'reads the e-mail %j as absent',
    (email) => {
      expect(
        verifyIdToken(token({ ...CLAIMS, email }), CHECK).email,
      ).toBeUndefined();
    },
  );

  it('trims a padded name and e-mail', () => {
    const person = verifyIdToken(
      token({ ...CLAIMS, email: ' a@b.test ', name: '  Ana  ' }),
      CHECK,
    );

    expect(person.email).toBe('a@b.test');
    expect(person.name).toBe('Ana');
  });

  it('keeps a non-ASCII name intact', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, name: 'Ștefan Țurcanu 😀' }), CHECK)
        .name,
    ).toBe('Ștefan Țurcanu 😀');
  });

  it('keeps the subject exactly as the provider wrote it', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, sub: ' Sub-ü ' }), CHECK).subject,
    ).toBe(' Sub-ü ');
  });

  it('refuses a ten-megabyte token quickly and with an OpenIdError', () => {
    const huge = `${encode({ alg: 'RS256', kid: 'k1' })}.${'A'.repeat(10_000_000)}.sig`;
    const started = Date.now();

    expect(() => verifyIdToken(huge, CHECK)).toThrow(OpenIdError);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('random material', () => {
  it('gives a thousand random tokens that never repeat and are URL safe', () => {
    const seen = new Set(Array.from({ length: 1000 }, randomToken));

    expect(seen.size).toBe(1000);
    for (const value of seen) expect(value).toMatch(/^[\w-]{43}$/);
  });

  it('pairs each of a thousand verifiers with its own unpadded S256 challenge', () => {
    const verifiers = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { challenge, verifier } = pkce();
      expect(challenge).toBe(
        createHash('sha256').update(verifier).digest('base64url'),
      );
      expect(challenge).not.toContain('=');
      verifiers.add(verifier);
    }
    expect(verifiers.size).toBe(1000);
  });
});

describe('authorizationUrl against hostile endpoints and values', () => {
  const flow = {
    challenge: 'ch',
    clientId: 'client-1',
    endpoint: 'https://issuer.test/authorize',
    nonce: 'n-1',
    redirectUri: 'https://web.test/api/v1/auth/oauth/google/callback',
    state: 's-1',
  };

  it('overwrites state and nonce that the endpoint already carried', () => {
    const url = new URL(
      authorizationUrl('google', {
        ...flow,
        endpoint: 'https://issuer.test/a?state=evil&nonce=evil&client_id=evil',
      }),
    );

    expect(url.searchParams.getAll('state')).toEqual(['s-1']);
    expect(url.searchParams.getAll('nonce')).toEqual(['n-1']);
    expect(url.searchParams.getAll('client_id')).toEqual(['client-1']);
  });

  it('refuses an endpoint that is not a URL', () => {
    expect(() =>
      authorizationUrl('google', { ...flow, endpoint: 'not a url' }),
    ).toThrow();
  });

  it('encodes ampersands, hashes and unicode in the values so they stay one parameter each', () => {
    const state = 'a&b=c#d é😀';
    const url = new URL(authorizationUrl('google', { ...flow, state }));

    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.hash).toBe('');
  });

  it('asks Google for the code flow with S256 and no form post', () => {
    const url = new URL(authorizationUrl('google', flow));

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.has('response_mode')).toBe(false);
  });

  it('asks Apple for the name and e-mail by form post', () => {
    const url = new URL(authorizationUrl('apple', flow));

    expect(url.searchParams.get('scope')).toBe('openid email name');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('keeps the endpoint path and origin', () => {
    const url = new URL(authorizationUrl('google', flow));

    expect(url.origin + url.pathname).toBe('https://issuer.test/authorize');
  });
});

describe('appleClientSecret', () => {
  const input = {
    audience: 'https://appleid.apple.com',
    clientId: 'ro.motorfix.web',
    keyId: 'KEY123',
    now: 1_800_000_999_999,
    privateKey: ec.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString(),
    teamId: 'TEAM123',
  };
  const decode = (segment: string) =>
    JSON.parse(Buffer.from(segment, 'base64url').toString());

  it('writes an ES256 token naming the key, team, client and audience', () => {
    const [head, body] = appleClientSecret(input).split('.');

    expect(decode(head)).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(decode(body)).toEqual({
      aud: 'https://appleid.apple.com',
      exp: 1_800_000_999 + 300,
      iat: 1_800_000_999,
      iss: 'TEAM123',
      sub: 'ro.motorfix.web',
    });
  });

  it("signs it so the key's public half verifies it as a raw 64-byte ES256 signature", () => {
    const [head, body, signature] = appleClientSecret(input).split('.');

    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(
      createVerify('sha256')
        .update(`${head}.${body}`)
        .verify(
          { dsaEncoding: 'ieee-p1363', key: ec.publicKey },
          Buffer.from(signature, 'base64url'),
        ),
    ).toBe(true);
  });

  it('lives no longer than ten minutes', () => {
    const claims = decode(appleClientSecret(input).split('.')[1]);

    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it('refuses a key whose line breaks are still written as \\n escapes', () => {
    expect(() =>
      appleClientSecret({
        ...input,
        privateKey: input.privateKey.replace(/\n/g, '\\n'),
      }),
    ).toThrow();
  });

  it('refuses an empty key without leaking it in the message', () => {
    expect(() => appleClientSecret({ ...input, privateKey: '' })).toThrow();
  });

  it('does not put the private key in the token', () => {
    expect(appleClientSecret(input)).not.toContain('PRIVATE KEY');
  });
});

describe('OpenIdClient against a misbehaving provider', () => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  let server: Server;
  let handler: Handler;
  let issuer: string;
  let hits: string[];

  beforeEach(async () => {
    hits = [];
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      handler(req, res);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });

  const json = (res: ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const good = () => ({
    authorization_endpoint: `${issuer}/authorize`,
    jwks_uri: `${issuer}/jwks`,
    token_endpoint: `${issuer}/token`,
  });

  it('reads the three addresses from a good discovery document', async () => {
    handler = (_, res) => json(res, good());

    expect(await new OpenIdClient().discover(issuer)).toMatchObject({
      authorizationEndpoint: `${issuer}/authorize`,
      jwksUri: `${issuer}/jwks`,
      tokenEndpoint: `${issuer}/token`,
    });
  });

  it('asks for the discovery document once and reuses it', async () => {
    handler = (_, res) => json(res, good());
    const client = new OpenIdClient();

    await client.discover(issuer);
    await client.discover(issuer);

    expect(hits).toEqual(['/.well-known/openid-configuration']);
  });

  it('does not cache a failed discovery', async () => {
    handler = (_, res) => json(res, { error: 'down' }, 503);
    const client = new OpenIdClient();
    await expect(client.discover(issuer)).rejects.toBeInstanceOf(OpenIdError);

    handler = (_, res) => json(res, good());

    await expect(client.discover(issuer)).resolves.toMatchObject({
      tokenEndpoint: `${issuer}/token`,
    });
  });

  it.each([
    ['a 404', (res: ServerResponse) => json(res, good(), 404)],
    ['a 500', (res: ServerResponse) => json(res, good(), 500)],
    [
      'an HTML page',
      (res: ServerResponse) => res.end('<html>maintenance</html>'),
    ],
    ['an empty body', (res: ServerResponse) => res.end()],
    ['a JSON null', (res: ServerResponse) => json(res, null)],
    ['a JSON array', (res: ServerResponse) => json(res, [good()])],
    ['a JSON string', (res: ServerResponse) => json(res, 'hello')],
    [
      'a document without a token endpoint',
      (res: ServerResponse) =>
        json(res, { ...good(), token_endpoint: undefined }),
    ],
    [
      'a document without keys',
      (res: ServerResponse) => json(res, { ...good(), jwks_uri: undefined }),
    ],
    [
      'a document without an authorisation endpoint',
      (res: ServerResponse) =>
        json(res, { ...good(), authorization_endpoint: undefined }),
    ],
    [
      'a document whose endpoint is a number',
      (res: ServerResponse) => json(res, { ...good(), token_endpoint: 7 }),
    ],
    [
      'a document whose endpoint is empty',
      (res: ServerResponse) => json(res, { ...good(), jwks_uri: '' }),
    ],
    [
      'a binary blob',
      (res: ServerResponse) => res.end(Buffer.from([0, 1, 2, 255, 254, 253])),
    ],
    [
      'UTF-16 text with a BOM',
      (res: ServerResponse) =>
        res.end(
          Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from(JSON.stringify(good()), 'utf16le'),
          ]),
        ),
    ],
  ])('fails discovery with an OpenIdError on %s', async (_, answer) => {
    handler = (_req, res) => answer(res);

    await expect(new OpenIdClient().discover(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );
  });

  it('fails with an OpenIdError when the provider is not listening', async () => {
    await new Promise((done) => server.close(done));

    await expect(new OpenIdClient().discover(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  });

  it('fails with an OpenIdError on a twenty-megabyte answer', async () => {
    handler = (_, res) => res.end('x'.repeat(20_000_000));

    await expect(new OpenIdClient().discover(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );
  }, 30_000);

  it('gives up on a discovery that never answers within about five seconds', async () => {
    handler = () => undefined;
    const started = Date.now();

    await expect(new OpenIdClient().discover(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );

    expect(Date.now() - started).toBeLessThan(7000);
  }, 15_000);

  it('gives up on a key set that never answers within about five seconds', async () => {
    handler = (req, res) =>
      req.url?.startsWith('/jwks') ? undefined : json(res, good());
    const started = Date.now();

    await expect(new OpenIdClient().keys(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );

    expect(Date.now() - started).toBeLessThan(7000);
  }, 15_000);

  it('gives up on a token call that never answers within about five seconds', async () => {
    handler = (req, res) =>
      req.url?.startsWith('/token') ? undefined : json(res, good());
    const started = Date.now();

    await expect(
      new OpenIdClient().exchange(issuer, { code: 'c' }),
    ).rejects.toBeInstanceOf(OpenIdError);

    expect(Date.now() - started).toBeLessThan(7000);
  }, 15_000);

  it('gives up on a response that starts and then stalls', async () => {
    handler = (_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"authorization_endpoint":');
    };
    const started = Date.now();

    await expect(new OpenIdClient().discover(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );

    expect(Date.now() - started).toBeLessThan(7000);
  }, 15_000);

  it.each([
    ['no key list', {}],
    ['a key list that is an object', { keys: {} }],
    ['a key list that is a string', { keys: 'abc' }],
    ['a null key list', { keys: null }],
  ])('refuses a key set with %s', async (_, set) => {
    handler = (req, res) =>
      json(res, req.url?.startsWith('/jwks') ? set : good());

    await expect(new OpenIdClient().keys(issuer)).rejects.toBeInstanceOf(
      OpenIdError,
    );
  });

  it('keeps the key set until asked for it fresh, then picks up a rotation', async () => {
    let generation = 1;
    handler = (req, res) =>
      json(
        res,
        req.url?.startsWith('/jwks')
          ? { keys: [{ kid: `gen-${generation}` }] }
          : good(),
      );
    const client = new OpenIdClient();

    const first = await client.keys(issuer);
    generation = 2;
    const cached = await client.keys(issuer);
    const fresh = await client.keys(issuer, true);

    expect(first).toEqual([{ kid: 'gen-1' }]);
    expect(cached).toEqual([{ kid: 'gen-1' }]);
    expect(fresh).toEqual([{ kid: 'gen-2' }]);
  });

  it('answers an empty key list as is, which then verifies no token', async () => {
    handler = (req, res) =>
      json(res, req.url?.startsWith('/jwks') ? { keys: [] } : good());

    expect(await new OpenIdClient().keys(issuer)).toEqual([]);
  });

  it('posts the form to the token endpoint and answers the ID token', async () => {
    let seen = '';
    handler = (req, res) => {
      if (req.url?.startsWith('/token')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          seen = `${req.method} ${req.headers['content-type']} ${body}`;
          json(res, { id_token: 'the.id.token' });
        });
        return;
      }
      json(res, good());
    };

    const idToken = await new OpenIdClient().exchange(issuer, {
      code: 'a&b',
      grant_type: 'authorization_code',
    });

    expect(idToken).toBe('the.id.token');
    expect(seen).toMatch(
      /^POST application\/x-www-form-urlencoded(;.*)? code=a%26b&grant_type=authorization_code$/,
    );
  });

  it.each([
    ['no id_token', {}],
    ['a numeric id_token', { id_token: 5 }],
    ['an empty id_token', { id_token: '' }],
    ['a null id_token', { id_token: null }],
    ['an array id_token', { id_token: ['a.b.c'] }],
  ])('refuses a token answer with %s', async (_, answer) => {
    handler = (req, res) =>
      json(res, req.url?.startsWith('/token') ? answer : good());

    await expect(
      new OpenIdClient().exchange(issuer, { code: 'c' }),
    ).rejects.toBeInstanceOf(OpenIdError);
  });

  it('refuses a token call the provider rejects with a 400', async () => {
    handler = (req, res) =>
      json(
        res,
        req.url?.startsWith('/token') ? { error: 'invalid_grant' } : good(),
        req.url?.startsWith('/token') ? 400 : 200,
      );

    await expect(
      new OpenIdClient().exchange(issuer, { code: 'c' }),
    ).rejects.toBeInstanceOf(OpenIdError);
  });

  it('keeps the code, the verifier and the client secret out of the error message', async () => {
    handler = (req, res) => {
      if (req.url?.startsWith('/token')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => json(res, { echo: body, id_token: 5 }, 400));
        return;
      }
      json(res, good());
    };

    const failure = await new OpenIdClient()
      .exchange(issuer, {
        client_secret: 'TOPSECRETVALUE',
        code: 'AUTHCODE123',
        code_verifier: 'VERIFIER456',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OpenIdError);
    const message = (failure as Error).message;
    expect(message).not.toContain('TOPSECRETVALUE');
    expect(message).not.toContain('AUTHCODE123');
    expect(message).not.toContain('VERIFIER456');
  });

  it('does not follow a token-endpoint redirect to another host with the code in the body', async () => {
    let leaked = false;
    const thief = createServer((_, res) => {
      leaked = true;
      json(res, { id_token: 'stolen.id.token' });
    });
    await new Promise<void>((done) => thief.listen(0, '127.0.0.1', done));
    const thiefUrl = `http://127.0.0.1:${(thief.address() as AddressInfo).port}/steal`;
    handler = (req, res) => {
      if (req.url?.startsWith('/token')) {
        res.writeHead(307, { location: thiefUrl });
        res.end();
        return;
      }
      json(res, good());
    };

    const outcome = await new OpenIdClient()
      .exchange(issuer, { code: 'c' })
      .catch((error: unknown) => error);
    await new Promise((done) => thief.close(done));

    expect(leaked).toBe(false);
    expect(outcome).toBeInstanceOf(OpenIdError);
  });

  it('keeps two issuers apart in its cache', async () => {
    handler = (_, res) => json(res, good());
    const other = createServer((_, res) =>
      json(res, {
        authorization_endpoint: 'http://other.test/a',
        jwks_uri: 'http://other.test/j',
        token_endpoint: 'http://other.test/t',
      }),
    );
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const otherIssuer = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    const client = new OpenIdClient();

    const one = await client.discover(issuer);
    const two = await client.discover(otherIssuer);
    await new Promise((done) => other.close(done));

    expect(one.tokenEndpoint).toBe(`${issuer}/token`);
    expect(two.tokenEndpoint).toBe('http://other.test/t');
  });
});
