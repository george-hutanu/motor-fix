// @traces 139-edit-my-details-FR-011
// @traces 139-edit-my-details-FR-012
// @traces 139-edit-my-details-FR-013
// @traces 139-edit-my-details-FR-017
import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { PhoneChangeService } from './phone-change.service';
import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testPhone,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { signAccessToken } from '../access-token';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import { codeHash } from '../phone-sign-in/phone-sign-in';
import { PhoneSignInModule } from '../phone-sign-in/phone-sign-in.module';
import type { Actor } from '../policy';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(12);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
const redis = new Redis(redisUrl);
let app: NestExpressApplication;
let changes: PhoneChangeService;

const OLD = testPhone(1);
const NEW = testPhone(2);
// The same new number as a Romanian types it.
const NEW_TYPED = '0710 000 002';
const TEMPLATE = { en: 32, ro: 31 } as const;
const FIVE_MINUTES = 5 * 60_000;

beforeAll(async () => {
  await brevo.start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      PhoneSignInModule.register({
        brevo: { apiKey: 'test-key', apiUrl: brevo.url },
        phone: testPhoneConfig({
          WHATSAPP_TEMPLATES: [
            'motorfix_sign_in_code_ro=21',
            'motorfix_sign_in_code_en=22',
            `motorfix_phone_change_code_ro=${TEMPLATE.ro}`,
            `motorfix_phone_change_code_en=${TEMPLATE.en}`,
          ].join(),
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
  changes = app.get(PhoneChangeService);
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

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const ask = (accountId: string | null, phone: unknown) => {
  const call = http().post('/me/phone').send({ phone });
  return accountId ? call.set('Authorization', bearer(accountId)) : call;
};

const confirm = (accountId: string | null, code: unknown) => {
  const call = http().post('/me/phone/confirm').send({ code });
  return accountId ? call.set('Authorization', bearer(accountId)) : call;
};

// A driver who signs in with Google and has the old number, confirmed.
async function driver(
  language: 'ro' | 'en' = 'ro',
  phone: string | null = OLD,
) {
  const id = await account(`andrei-${language}`, ['driver'], { language });
  if (phone) {
    await prisma.account.update({
      data: { phone, phoneVerifiedAt: new Date(Date.now() - 86_400_000) },
      where: { id },
    });
  }
  return id;
}

// A driver who signs in with a WhatsApp code to the old number.
async function phoneDriver() {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'whatsapp_phone', subject: OLD },
    language: 'ro',
    name: 'Andrei Telefon',
    phone: OLD,
    roles: ['driver'],
  });
  await prisma.account.update({
    data: { phoneVerifiedAt: new Date(Date.now() - 86_400_000) },
    where: { id },
  });
  return id;
}

const actorOf = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
});

interface WhatsAppBody {
  params: string[];
  templateId: number;
  contactNumbers?: string[];
  to?: string;
}

const sent = () => brevo.whatsapp().map((call) => call.body as WhatsAppBody);

// The code the last WhatsApp message carried.
function lastCode(): string {
  const body = sent().at(-1);
  if (!body) throw new Error('no WhatsApp message sent');
  return String(body.params[0]);
}

const otherThan = (code: string) => (code === '000000' ? '111111' : '000000');

const accountOf = (id: string) =>
  prisma.account.findUniqueOrThrow({
    select: { phone: true, phoneVerifiedAt: true },
    where: { id },
  });

const changeOf = (accountId: string) =>
  prisma.phoneChange.findUnique({ where: { accountId } });

describe('asking to change my phone', () => {
  it('sends a 6-digit code by WhatsApp to the new number read as +40, and keeps the old number', async () => {
    const id = await driver();

    const res = await ask(id, NEW_TYPED);

    expect(res.status).toBe(202);
    expect(sent()).toHaveLength(1);
    expect(JSON.stringify(sent()[0])).toContain(NEW.slice(1));
    expect(sent()[0]?.templateId).toBe(TEMPLATE.ro);
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('keeps only the HMAC of the code, valid 5 minutes, with no tries used', async () => {
    const id = await driver();
    const before = Date.now();

    await ask(id, NEW).expect(202);

    const row = await changeOf(id);
    expect(row).toMatchObject({
      attempts: 0,
      codeHash: codeHash(lastCode(), tokenSecret),
      phone: NEW,
    });
    expect(row?.codeHash).not.toContain(lastCode());
    const expiry = row?.expiresAt.getTime() ?? 0;
    expect(expiry).toBeGreaterThanOrEqual(before + FIVE_MINUTES - 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + FIVE_MINUTES + 1000);
  });

  it("sends the code in the account's language", async () => {
    const id = await driver('en');

    await ask(id, NEW).expect(202);

    expect(sent()[0]?.templateId).toBe(TEMPLATE.en);
  });

  it('accepts a number for an account that had none', async () => {
    const id = await driver('ro', null);

    await ask(id, NEW).expect(202);

    expect(await changeOf(id)).toMatchObject({ phone: NEW });
  });

  it('keeps one live change per account: a new ask replaces the older code', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const first = lastCode();
    const third = testPhone(3);

    await ask(id, third).expect(202);

    expect(await prisma.phoneChange.count({ where: { accountId: id } })).toBe(
      1,
    );
    expect(await changeOf(id)).toMatchObject({
      attempts: 0,
      codeHash: codeHash(lastCode(), tokenSecret),
      phone: third,
    });
    if (first !== lastCode()) {
      const res = await confirm(id, first);
      expect(res.body.code).toBe('code_invalid');
    }
  });

  it('refuses 409 phone_taken a number another account holds, sending and keeping nothing', async () => {
    const id = await driver();
    const other = await account('maria');
    await prisma.account.update({
      data: { phone: NEW },
      where: { id: other },
    });

    const res = await ask(id, NEW);

    expect([res.status, res.body.code]).toEqual([409, 'phone_taken']);
    expect(sent()).toHaveLength(0);
    expect(await changeOf(id)).toBeNull();
  });

  it('refuses 409 phone_taken a number another account signs in with by WhatsApp', async () => {
    const id = await driver('ro', null);
    await prisma.account.update({
      data: { phone: null },
      where: { id: await phoneDriver() },
    });

    const res = await ask(id, OLD);

    expect([res.status, res.body.code]).toEqual([409, 'phone_taken']);
    expect(sent()).toHaveLength(0);
  });

  it('refuses 409 phone_unchanged the account its own number', async () => {
    const id = await driver();

    const res = await ask(id, '0710 000 001');

    expect([res.status, res.body.code]).toEqual([409, 'phone_unchanged']);
    expect(sent()).toHaveLength(0);
    expect(await changeOf(id)).toBeNull();
  });

  it.each([
    ['letters', 'telefonul meu'],
    ['too few digits', '07'],
    ['nothing', ''],
    ['a number', 722123456],
  ])('refuses 400 %s', async (_, phone) => {
    const id = await driver();

    const res = await ask(id, phone);

    // The api's filter names it validation_failed (bootstrap.ts).
    expect(res.status).toBe(400);
    expect(sent()).toHaveLength(0);
  });

  it('answers 503 send_failed and keeps nothing when Brevo refuses', async () => {
    const id = await driver();
    brevo.answer({ status: 400 });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await ask(id, NEW);

    expect([res.status, res.body.code]).toEqual([503, 'send_failed']);
    expect(await changeOf(id)).toBeNull();
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('answers 503 send_failed and sends nothing to a number WhatsApp sending may not reach', async () => {
    const id = await driver();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // Outside the test allowlist.
    const res = await ask(id, '+40799999999');

    expect([res.status, res.body.code]).toEqual([503, 'send_failed']);
    expect(sent()).toHaveLength(0);
    expect(await changeOf(id)).toBeNull();
  });

  it('allows 5 codes an hour per account and refuses the sixth 429 too_many_attempts, sending nothing', async () => {
    const id = await driver('ro', null);
    for (const n of [2, 3, 4, 5, 6]) await ask(id, testPhone(n)).expect(202);

    const res = await ask(id, testPhone(7));

    expect([res.status, res.body.code]).toEqual([429, 'too_many_attempts']);
    expect(sent()).toHaveLength(5);
    expect(await changeOf(id)).toMatchObject({ phone: testPhone(6) });
  });

  it('does not count one account against another', async () => {
    const first = await driver('ro', null);
    for (const n of [2, 3, 4, 5, 6]) await ask(first, testPhone(n)).expect(202);
    const second = await driver('en', null);

    await ask(second, testPhone(7)).expect(202);
  });

  it('answers 401 sign_in_required with no session', async () => {
    const res = await ask(null, NEW);

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    expect(sent()).toHaveLength(0);
  });

  it('answers 403 account_suspended to a suspended account and sends nothing', async () => {
    const id = await driver();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await ask(id, NEW);

    expect([res.status, res.body.code]).toEqual([403, 'account_suspended']);
    expect(sent()).toHaveLength(0);
  });

  it('does not exist for an assistant acting for the account', async () => {
    const id = await driver();

    await expect(
      changes.request({ ...actorOf(id), via: 'assistant' }, NEW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sent()).toHaveLength(0);
  });
});

const reader = countedMetrics();
const phoneChanges = () =>
  counterTotal(reader, 'motorfix_account_changes_total', { field: 'phone' });

describe('confirming my new phone', () => {
  it('sets the phone and its confirmed time, deletes the change and answers who am I', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const before = Date.now();

    const res = await confirm(id, lastCode());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      phone: NEW,
      phoneConfirmed: true,
    });
    const saved = await accountOf(id);
    expect(saved.phone).toBe(NEW);
    expect(saved.phoneVerifiedAt?.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(await changeOf(id)).toBeNull();
  });

  it('records the old and the new number in the audit history and one account.updated event', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);

    await confirm(id, lastCode()).expect(200);

    const entries = await prisma.activityLog.findMany({
      where: { field: 'phone', subjectId: id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: id,
      newValue: NEW,
      oldValue: OLD,
    });
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'account.updated', subjectId: id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ fields: ['phone'] });
  });

  it('counts one phone change', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const before = await phoneChanges();

    await confirm(id, otherThan(lastCode()));
    await confirm(id, lastCode()).expect(200);

    expect(await phoneChanges()).toBe(before + 1);
  });

  it('moves the WhatsApp sign-in to the new number', async () => {
    const id = await phoneDriver();
    await ask(id, NEW).expect(202);

    await confirm(id, lastCode()).expect(200);

    const identity = await prisma.accountIdentity.findFirstOrThrow({
      where: { accountId: id, method: 'whatsapp_phone' },
    });
    expect(identity.subject).toBe(NEW);
    await http()
      .post('/auth/phone-code')
      .set('X-Forwarded-For', address())
      .send({ phone: NEW })
      .expect(202);
    const signedIn = await http()
      .post('/auth/phone-sign-in')
      .set('X-Forwarded-For', address())
      .send({ code: lastCode(), phone: NEW });
    expect(signedIn.status).toBe(200);
    expect(await prisma.account.count({ where: { phone: NEW } })).toBe(1);
  });

  it('refuses a wrong code 401 code_invalid, counting one try and keeping the old number', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);

    const res = await confirm(id, otherThan(lastCode()));

    expect([res.status, res.body.code]).toEqual([401, 'code_invalid']);
    expect((await changeOf(id))?.attempts).toBe(1);
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('voids the code at the fifth wrong try: 429 too_many_attempts then and after, even for the right code', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const code = lastCode();
    const wrong = otherThan(code);

    const answers: [number, string][] = [];
    for (let i = 0; i < 5; i++) {
      const res = await confirm(id, wrong);
      answers.push([res.status, res.body.code]);
    }
    const right = await confirm(id, code);

    expect(answers).toEqual([
      [401, 'code_invalid'],
      [401, 'code_invalid'],
      [401, 'code_invalid'],
      [401, 'code_invalid'],
      [429, 'too_many_attempts'],
    ]);
    expect([right.status, right.body.code]).toEqual([429, 'too_many_attempts']);
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('lets a new code be asked for after the old one was voided', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const wrong = otherThan(lastCode());
    for (let i = 0; i < 5; i++) await confirm(id, wrong);

    await ask(id, NEW).expect(202);

    await confirm(id, lastCode()).expect(200);
    expect((await accountOf(id)).phone).toBe(NEW);
  });

  it('refuses a code older than 5 minutes 410 code_expired', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    await prisma.phoneChange.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { accountId: id },
    });

    const res = await confirm(id, lastCode());

    expect([res.status, res.body.code]).toEqual([410, 'code_expired']);
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('refuses 410 code_expired when no change waits', async () => {
    const id = await driver();

    const res = await confirm(id, '123456');

    expect([res.status, res.body.code]).toEqual([410, 'code_expired']);
  });

  it('refuses a used code 410 code_expired: the change is gone', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const code = lastCode();
    await confirm(id, code).expect(200);

    const res = await confirm(id, code);

    expect([res.status, res.body.code]).toEqual([410, 'code_expired']);
  });

  it('refuses 409 phone_taken when another account took the number meanwhile', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    const other = await account('maria');
    await prisma.account.update({
      data: { phone: NEW },
      where: { id: other },
    });

    const res = await confirm(id, lastCode());

    expect([res.status, res.body.code]).toEqual([409, 'phone_taken']);
    expect((await accountOf(id)).phone).toBe(OLD);
    expect(
      await prisma.activityLog.count({
        where: { field: 'phone', subjectId: id },
      }),
    ).toBe(0);
  });

  it.each([
    ['five digits', '12345'],
    ['letters', 'abcdef'],
    ['a number', 123456],
  ])('refuses 400 %s', async (_, code) => {
    const id = await driver();
    await ask(id, NEW).expect(202);

    const res = await confirm(id, code);

    // The api's filter names it validation_failed (bootstrap.ts).
    expect(res.status).toBe(400);
    expect((await changeOf(id))?.attempts).toBe(0);
  });

  it('answers 401 sign_in_required with no session', async () => {
    const res = await confirm(null, '123456');

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
  });

  it('answers 403 account_suspended to a suspended account and changes nothing', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    const res = await confirm(id, lastCode());

    expect([res.status, res.body.code]).toEqual([403, 'account_suspended']);
    expect((await accountOf(id)).phone).toBe(OLD);
  });

  it('does not exist for an assistant acting for the account', async () => {
    const id = await driver();
    await ask(id, NEW).expect(202);

    await expect(
      changes.confirm({ ...actorOf(id), via: 'assistant' }, lastCode()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await accountOf(id)).phone).toBe(OLD);
  });
});

describe('keeping the code secret', () => {
  it('never writes the code or the number to a log line, a notification or the change row', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
    }
    const id = await driver();
    await ask(id, NEW).expect(202);
    const code = lastCode();

    await confirm(id, otherThan(code));
    brevo.answer({ status: 400 });
    await ask(id, testPhone(3));
    await confirm(id, code).expect(200);

    const logged = lines.join('\n');
    expect(logged).not.toContain(code);
    expect(logged).not.toContain(NEW);
    expect(logged).not.toContain(NEW.slice(1));
    expect(await prisma.notification.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect(
      JSON.stringify(
        await prisma.activityLog.findMany({ where: { subjectId: id } }),
      ),
    ).not.toContain(code);
  });
});
