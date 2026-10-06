import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { verifyAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { PhoneSignInModule } from './phone-sign-in.module';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';
import { BrevoMock } from '../notifications/brevo-mock.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testPhoneConfig,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const PHONE = '+40722123456';
const { prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
const redis = new Redis(redisUrl);
let app: NestExpressApplication;

beforeAll(async () => {
  await brevo.start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      PhoneSignInModule.register({
        brevo: { apiKey: 'test-key', apiUrl: brevo.url },
        phone: testPhoneConfig({
          PHONE_ALLOWLIST: '+407*',
          WHATSAPP_TEMPLATES:
            'motorfix_sign_in_code_ro=21,motorfix_sign_in_code_en=22',
        }),
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 'loopback');
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE sign_in_code');
  await redis.flushdb();
  brevo.reset();
  jest.restoreAllMocks();
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;
const http = () => request(app.getHttpServer());

const askCode = (body: Record<string, unknown>) =>
  http().post('/auth/phone-code').set('X-Forwarded-For', address()).send(body);
const signIn = (body: Record<string, unknown>) =>
  http()
    .post('/auth/phone-sign-in')
    .set('X-Forwarded-For', address())
    .send(body);
const rawPost = (route: string, body: string) =>
  http()
    .post(route)
    .set('X-Forwarded-For', address())
    .set('Content-Type', 'application/json')
    .send(body);

// The code the last WhatsApp message carried.
function lastCode(): string {
  const body = brevo.whatsapp().at(-1)?.body as { params: string[] };
  if (!body) throw new Error('no WhatsApp message sent');
  return String(body.params[0]);
}

async function codeFor(phone: string): Promise<string> {
  await askCode({ phone }).expect(202);
  return lastCode();
}

// An account whose phone is verified; it signs in by e-mail elsewhere.
async function holder(
  roles: Role[],
  {
    lastRole,
    phone = PHONE,
    identity = 'google',
    verified = true,
    status,
  }: {
    lastRole?: Role;
    phone?: string;
    identity?: 'google' | 'whatsapp_phone';
    verified?: boolean;
    status?: 'suspended' | 'deleted';
  } = {},
) {
  const email = `${roles.join('-')}@example.test`;
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity:
      identity === 'google'
        ? { method: 'google', subject: `${email}-google` }
        : { method: 'whatsapp_phone', subject: phone },
    name: 'Ana Pop',
    phone,
    roles,
  });
  await prisma.account.update({
    data: {
      phoneVerifiedAt: verified ? new Date() : null,
      ...(lastRole && { lastRole }),
      ...(status && { status }),
    },
    where: { id },
  });
  return id;
}

function cookieOf(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const claims = (res: request.Response) =>
  verifyAccessToken(res.body.accessToken, tokenSecret);

describe('asking for a sign-in code', () => {
  it('answers 202 and the same empty body for a known and an unknown number', async () => {
    await holder(['garage']);

    const known = await askCode({ phone: PHONE });
    const unknown = await askCode({ phone: '+40733000000' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.text).toBe('');
    expect(unknown.text).toBe(known.text);
    expect(brevo.whatsapp()).toHaveLength(2);
  });

  it('sends the code and its five minutes to the number, in the template of the language', async () => {
    await askCode({ phone: '0722 123 456' }).expect(202);
    await askCode({ language: 'en', phone: '+40733000000' }).expect(202);

    const [ro, en] = brevo.whatsapp().map((call) => call.body);
    expect(ro).toEqual({
      contactNumbers: ['40722123456'],
      params: [expect.stringMatching(/^\d{6}$/), '5'],
      senderNumber: '40700000099',
      templateId: 21,
    });
    expect(en).toMatchObject({
      contactNumbers: ['40733000000'],
      templateId: 22,
    });
  });

  it('keeps the code as a hash, never as it was sent', async () => {
    const code = await codeFor(PHONE);

    const row = await prisma.signInCode.findUnique({ where: { phone: PHONE } });
    expect(row?.codeHash).toBeTruthy();
    expect(row?.codeHash).not.toContain(code);
    expect(row?.attempts).toBe(0);
    expect(row?.usedAt).toBeNull();
    expect(
      (row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0),
    ).toBe(5 * 60_000);
  });

  it.each([
    ['letters', { phone: '0722 ABC 456' }],
    ['too few digits', { phone: '0722' }],
    ['no number', {}],
    ['a number that is not text', { phone: 40722123456 }],
    ['another language', { language: 'de', phone: PHONE }],
    ['an unknown field', { phone: PHONE, role: 'admin' }],
  ])('answers 400 for %s, and sends nothing', async (_, body) => {
    const res = await askCode(body);

    expect(res.status).toBe(400);
    expect(brevo.whatsapp()).toHaveLength(0);
  });
});

describe('signing in with the code', () => {
  it('signs a garage owner in with an access token and a remembered refresh cookie', async () => {
    const id = await holder(['garage']);
    const code = await codeFor(PHONE);

    const res = await signIn({ code, phone: PHONE });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['accessToken']);
    expect(claims(res)).toEqual({
      accountId: id,
      expiresAt: expect.any(Number),
      role: 'garage',
    });
    expect(cookieOf(res)).toContain('Max-Age=2592000');
    expect(cookieOf(res)).toContain('HttpOnly');
  });

  it('keeps the session to the browser when remember is off', async () => {
    await holder(['garage']);
    const code = await codeFor(PHONE);

    const res = await signIn({ code, phone: PHONE, remember: false });

    expect(res.status).toBe(200);
    expect(cookieOf(res)).toBeDefined();
    expect(cookieOf(res)).not.toMatch(/Max-Age|Expires/);
  });

  it('uses the role in use, as the e-mail sign-in does', async () => {
    await holder(['driver', 'garage'], { lastRole: 'garage' });
    const code = await codeFor(PHONE);

    const res = await signIn({ code, phone: PHONE });

    expect(claims(res)?.role).toBe('garage');
  });

  it.each(['driver', 'garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'signs in an account holding only %s, and creates nothing',
    async (role) => {
      const id = await holder([role]);
      const code = await codeFor(PHONE);

      const res = await signIn({ code, phone: PHONE });

      expect(res.status).toBe(200);
      expect(claims(res)).toMatchObject({ accountId: id, role });
      expect(await prisma.account.count()).toBe(1);
      expect(
        await prisma.accountRole.findMany({ where: { accountId: id } }),
      ).toHaveLength(1);
    },
  );

  it('adds no sign-in identity to an account matched by its verified phone', async () => {
    const id = await holder(['driver']);
    const code = await codeFor(PHONE);

    await signIn({ code, phone: PHONE }).expect(200);

    const identities = await prisma.accountIdentity.findMany({
      where: { accountId: id },
    });
    expect(identities.map((i) => i.method)).toEqual(['google']);
  });

  it('finds the account by its WhatsApp sign-in identity', async () => {
    const id = await holder(['driver'], { identity: 'whatsapp_phone' });
    const code = await codeFor(PHONE);

    const res = await signIn({ code, phone: PHONE });

    expect(claims(res)?.accountId).toBe(id);
  });

  it('matches one account however the number is written', async () => {
    const id = await holder(['driver']);
    for (const [asked, given] of [
      ['0722 123 456', '+40 722 123 456'],
      ['0040722123456', '0722-123-456'],
      ['+40722123456', '0040 722 123 456'],
    ]) {
      await redis.flushdb();
      const code = await codeFor(asked as string);

      const res = await signIn({ code, phone: given });

      expect(res.status).toBe(200);
      expect(claims(res)?.accountId).toBe(id);
    }
  });

  it.each([
    ['a number that is not possible', { code: '123456', phone: '0722' }],
    ['a code of five digits', { code: '12345', phone: PHONE }],
    ['a code with a letter', { code: '12345a', phone: PHONE }],
    ['no code', { phone: PHONE }],
    ['an unknown field', { accountId: 'x', code: '123456', phone: PHONE }],
  ])('answers 400 for %s', async (_, body) => {
    const res = await signIn(body);

    expect(res.status).toBe(400);
  });
});

describe('a number no account holds', () => {
  const NEW = '+40733000000';
  const profile = { consent: CURRENT_CONSENT, name: 'Ion Popescu' };

  const created = () =>
    prisma.account.findUniqueOrThrow({
      include: { consents: true, identities: true, roles: true },
      where: { phone: NEW },
    });

  it('answers that a profile is needed, opens no session and keeps the code live', async () => {
    const code = await codeFor(NEW);

    const res = await signIn({ code, phone: NEW });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ next: 'profile' });
    expect(cookieOf(res)).toBeUndefined();
    expect(await prisma.account.count()).toBe(0);
    const row = await prisma.signInCode.findUnique({ where: { phone: NEW } });
    expect(row).toMatchObject({ attempts: 0, usedAt: null });
  });

  it('creates a driver account with the verified number, the name and the language, and signs it in', async () => {
    const code = await codeFor(NEW);
    await signIn({ code, phone: NEW }).expect(200);

    const res = await signIn({
      code,
      consent: CURRENT_CONSENT,
      language: 'en',
      name: '  Ion Popescu  ',
      phone: '0733 000 000',
      remember: false,
    });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['accessToken']);
    expect(cookieOf(res)).toBeDefined();
    expect(cookieOf(res)).not.toMatch(/Max-Age|Expires/);
    const account = await created();
    expect(claims(res)).toMatchObject({
      accountId: account.id,
      role: 'driver',
    });
    expect(account).toMatchObject({
      email: null,
      language: 'en',
      name: 'Ion Popescu',
      phone: NEW,
      status: 'active',
    });
    expect(account.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
    expect(account.identities).toEqual([
      expect.objectContaining({ method: 'whatsapp_phone', subject: NEW }),
    ]);
    expect(
      account.consents.map((c) => [c.kind, c.method, c.textVersion]).sort(),
    ).toEqual(
      [
        ['privacy_notice', 'whatsapp_phone', CURRENT_CONSENT.privacyVersion],
        ['terms', 'whatsapp_phone', CURRENT_CONSENT.termsVersion],
      ].sort(),
    );
  });

  it('records the account once in the history and once as account.created by WhatsApp', async () => {
    const code = await codeFor(NEW);

    await signIn({ code, phone: NEW, ...profile }).expect(200);

    const { id } = await created();
    const roles = await prisma.activityLog.findMany({
      where: { field: 'role', subjectId: id },
    });
    expect(roles).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: id,
        newValue: 'driver',
      }),
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'account.created', subjectId: id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      method: 'whatsapp_phone',
      roles: ['driver'],
    });
  });

  it('spends the code on the account it created', async () => {
    const code = await codeFor(NEW);
    await signIn({ code, phone: NEW, ...profile }).expect(200);

    const again = await signIn({ code, phone: NEW, ...profile });

    expect(again.status).toBe(401);
    expect(again.body.code).toBe('code_invalid');
    expect(await prisma.account.count()).toBe(1);
  });

  it.each([
    ['a stale consent', { privacyVersion: 'old', termsVersion: 'old' }],
    ['an unticked consent', {}],
  ])(
    'refuses %s with consent_required, creates nothing and keeps the code live',
    async (_, consent) => {
      const code = await codeFor(NEW);

      const res = await signIn({
        code,
        consent,
        name: 'Ion Popescu',
        phone: NEW,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('consent_required');
      expect(await prisma.account.count()).toBe(0);
      await signIn({ code, phone: NEW, ...profile }).expect(200);
    },
  );

  it('ignores a name, a consent and a language sent for a number an account holds', async () => {
    const id = await holder(['garage']);
    const code = await codeFor(PHONE);

    const res = await signIn({
      code,
      consent: CURRENT_CONSENT,
      language: 'en',
      name: 'Someone Else',
      phone: PHONE,
    });

    expect(res.status).toBe(200);
    expect(claims(res)).toMatchObject({ accountId: id, role: 'garage' });
    expect(await prisma.account.count()).toBe(1);
    expect(
      await prisma.account.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ language: 'ro', name: 'Ana Pop' });
  });

  it.each([
    ['never verified it', { verified: false }],
    ['was deleted', { status: 'deleted' as const }],
    [
      'was deleted after signing in by WhatsApp',
      { identity: 'whatsapp_phone' as const, status: 'deleted' as const },
    ],
  ])(
    'answers phone_taken for the number of an account that %s, and spends the code',
    async (_, options) => {
      await holder(['driver'], options);
      const code = await codeFor(PHONE);

      const res = await signIn({ code, phone: PHONE, ...profile });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('phone_taken');
      expect(cookieOf(res)).toBeUndefined();
      expect(await prisma.account.count()).toBe(1);
      const again = await signIn({ code, phone: PHONE, ...profile });
      expect(again.status).toBe(401);
    },
  );
});

describe('both routes', () => {
  const routes = [
    ['/auth/phone-code', { phone: PHONE }],
    ['/auth/phone-sign-in', { code: '123456', phone: PHONE }],
  ] as const;

  it.each(routes)('%s refuses a form post that is not JSON', async (route) => {
    const res = await http()
      .post(route)
      .set('X-Forwarded-For', address())
      .type('form')
      .send('phone=%2B40722123456&code=123456');

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it.each(routes)('%s refuses plain text', async (route) => {
    const res = await http()
      .post(route)
      .set('X-Forwarded-For', address())
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ code: '123456', phone: PHONE }));

    expect(res.status).toBe(415);
  });

  it.each([
    [
      '/auth/phone-code',
      '__proto__',
      `{"phone":"${PHONE}","__proto__":{"x":1}}`,
    ],
    [
      '/auth/phone-code',
      'constructor',
      `{"phone":"${PHONE}","constructor":{"prototype":{"x":1}}}`,
    ],
    [
      '/auth/phone-sign-in',
      '__proto__',
      `{"phone":"${PHONE}","code":"123456","__proto__":{"x":1}}`,
    ],
    [
      '/auth/phone-sign-in',
      'constructor',
      `{"phone":"${PHONE}","code":"123456","constructor":{"prototype":{"x":1}}}`,
    ],
  ])('%s refuses a %s key', async (route, _, body) => {
    const res = await rawPost(route, body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  it('logs neither the number nor the code over a whole sign-in', async () => {
    const lines: unknown[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args) => {
        lines.push(args);
      });
    }
    await holder(['garage']);

    const code = await codeFor('0722 123 456');
    await signIn({
      code: code === '000000' ? '000001' : '000000',
      phone: PHONE,
    });
    await signIn({ code, phone: PHONE }).expect(200);

    const logged = JSON.stringify(lines);
    expect(logged).not.toContain('722123456');
    expect(logged).not.toContain('722 123 456');
    expect(logged).not.toContain(code);
  });
});
