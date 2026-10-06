import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { oauthSettings } from './providers';
import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import type { Role } from '../capabilities';
import { MAINTENANCE } from '../maintenance';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

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

export const WEB = 'https://web.example.test';

export const ELENA: StubPerson = {
  email: 'elena@example.test',
  email_verified: true,
  name: 'Elena Pop',
  sub: 'google-elena',
};

export type Provider = 'google' | 'apple';

export function cookieLine(res: request.Response, name: string): string {
  const all = (res.headers['set-cookie'] ?? []) as unknown as string[];
  return all.find((c) => c.startsWith(`${name}=`)) ?? '';
}

export function cookie(
  res: request.Response,
  name: string,
): string | undefined {
  const line = cookieLine(res, name);
  return line ? line.split(';')[0].slice(name.length + 1) : undefined;
}

// The person approves at the stub provider, which answers with a code.
export async function approve(location: URL) {
  const answer = await fetch(location, { redirect: 'manual' });
  const back = new URL(answer.headers.get('location') ?? '');
  return {
    code: back.searchParams.get('code') ?? '',
    state: back.searchParams.get('state') ?? '',
  };
}

// One spec file's API with both providers pointed at a stub issuer, its
// database and Redis cleared before each test. `maintenance` is read on
// every call.
export function oauthHarness(maintenance: () => boolean = () => false) {
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const prisma = createPrisma(databaseUrl);
  const redis = new Redis(redisUrl);
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);
  serialDatabase(databaseUrl);
  const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();

  async function boot(oauth: ReturnType<typeof oauthSettings>) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.register({
          databaseUrl,
          oauth,
          redisUrl,
          tokenSecret: 'test',
        }),
      ],
    })
      .overrideProvider(MAINTENANCE)
      .useValue({ on: async () => maintenance() })
      .compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>();
    nest.set('trust proxy', 'loopback');
    nest.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await nest.init();
    return nest;
  }

  const h = {
    accounts,
    app: undefined as unknown as NestExpressApplication,
    boot,

    callback(
      provider: Provider,
      fields: Record<string, string>,
      flow: string | undefined,
    ) {
      const req =
        provider === 'apple'
          ? h
              .http()
              .post('/auth/oauth/apple/callback')
              .type('form')
              .send(fields)
          : h.http().get('/auth/oauth/google/callback').query(fields);
      return flow === undefined ? req : req.set('Cookie', `mf_oauth=${flow}`);
    },

    async continueWith(
      provider: Provider,
      person: StubPerson,
      extra: Record<string, string> = {},
      query?: string,
    ) {
      h.stub.next = person;
      const { flow, location } = await h.start(provider, query);
      const { code, state } = await approve(location);
      return h.callback(provider, { code, state, ...extra }, flow);
    },

    // An account holding `email`; a provider links only to one that
    // confirmed it.
    async existing(
      email: string,
      roles: Role[] = ['driver'],
      identity: { method: 'password' | 'google' | 'apple'; subject: string } = {
        method: 'password',
        subject: email,
      },
      emailVerified = true,
    ) {
      const { id } = await accounts.createAccount({
        consent: CURRENT_CONSENT,
        email,
        emailVerified,
        identity: {
          ...identity,
          passwordHash: identity.method === 'password' ? 'x' : undefined,
        },
        name: 'Andrei Ionescu',
        roles,
      });
      return id;
    },
    http: () => request(h.app.getHttpServer()),
    prisma,
    redis,

    async start(provider: Provider, query = 'language=ro&remember=true') {
      const res = await h.http().get(`/auth/oauth/${provider}?${query}`);
      expect(res.status).toBe(302);
      return {
        flow: cookie(res, 'mf_oauth') ?? '',
        location: new URL(res.headers['location']),
        res,
      };
    },
    stub: undefined as unknown as OpenIdStub,
  };

  beforeAll(async () => {
    h.stub = await startOpenIdStub();
    h.app = await boot(
      oauthSettings('test', {
        APPLE_ISSUER: h.stub.issuer,
        APPLE_KEY_ID: 'KEY123',
        APPLE_PRIVATE_KEY: appleKey,
        APPLE_SERVICES_ID: 'ro.motorfix.web',
        APPLE_TEAM_ID: 'TEAM123',
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_ISSUER: h.stub.issuer,
        PUBLIC_WEB_URL: WEB,
      }),
    );
  });

  afterAll(async () => {
    await h.app.close();
    await h.stub.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    h.stub.fault = null;
    await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
    const keys = await redis.keys('auth:*');
    if (keys.length) await redis.del(...keys);
  });

  return h;
}
