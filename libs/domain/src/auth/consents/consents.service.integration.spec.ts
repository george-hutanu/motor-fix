import { randomUUID } from 'node:crypto';

import {
  ANALYTICS_CONSENT_VERSION,
  CURRENT_CONSENT,
  type RecordConsentDto,
} from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { RECORDS_PER_HOUR } from './consents';
import { ConsentsService } from './consents.service';
import { ConsentThrottle } from './consents.throttle';
import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { AccountsService } from '../accounts.service';
import type { Actor } from '../policy';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
const reader = countedMetrics();
serialDatabase(databaseUrl);

const service = new ConsentsService(
  prisma,
  new AuditService(),
  new ConsentThrottle(redis),
);

const choice = (
  overrides: Partial<RecordConsentDto> = {},
): RecordConsentDto => ({
  at: new Date().toISOString(),
  browserConsentId: randomUUID(),
  decision: 'granted',
  language: 'ro',
  textVersion: ANALYTICS_CONSENT_VERSION,
  ...overrides,
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;

const actorOf = (accountId: string): Actor => ({
  accountId,
  garageId: null,
  permissions: {} as Actor['permissions'],
  role: 'driver',
  roles: ['driver'],
});

const newAccount = async (name = 'Ioana Pop') =>
  (
    await accounts.createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${name}-${randomUUID()}` },
      name,
      roles: ['driver'],
    })
  ).id;

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

const analyticsEntries = (accountId: string) =>
  prisma.activityLog.findMany({
    where: { field: 'analyticsConsent', subjectId: accountId },
  });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, consent_record CASCADE');
  const keys = await redis.keys('consents:*');
  if (keys.length) await redis.del(...keys);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

// @traces 244-FR-008
describe('keeping every choice', () => {
  it('stores a second choice as a second row and changes neither', async () => {
    const browserConsentId = randomUUID();
    const first = await service.record(
      choice({ browserConsentId, decision: 'granted' }),
      address(),
    );
    const second = await service.record(
      choice({ browserConsentId, decision: 'withdrawn' }),
      address(),
    );

    const rows = await prisma.consentRecord.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => [row.id, row.decision])).toEqual([
      [first.id, 'granted'],
      [second.id, 'withdrawn'],
    ]);
    expect(Object.keys(first)).toEqual(['id']);
  });

  it('keeps a visitor choice under no account, with its text, language and time', async () => {
    const at = '2026-10-10T08:00:00.000Z';
    await service.record(
      choice({ at, decision: 'refused', language: 'en' }),
      address(),
    );

    const [row] = await prisma.consentRecord.findMany();
    expect(row).toMatchObject({
      accountId: null,
      decision: 'refused',
      kind: 'analytics',
      language: 'en',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });
    expect(row?.at.toISOString()).toBe(at);
  });
});

// @traces 244-FR-009
describe('the clock and the address limit', () => {
  it('accepts a time up to five minutes ahead of the server', async () => {
    const at = new Date(Date.now() + 4 * 60_000).toISOString();

    await expect(service.record(choice({ at }), address())).resolves.toEqual({
      id: expect.any(String),
    });
  });

  it('refuses a time more than five minutes ahead', async () => {
    const at = new Date(Date.now() + 6 * 60_000).toISOString();

    const refusal = await refusalOf(service.record(choice({ at }), address()));

    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({ code: 'consent_time_ahead' });
    expect(await prisma.consentRecord.count()).toBe(0);
  });

  it('refuses the record past the hourly share of one address', async () => {
    const from = address();
    for (let n = 0; n < RECORDS_PER_HOUR; n++) {
      await service.record(choice(), from);
    }

    const refusal = await refusalOf(service.record(choice(), from));

    expect(refusal.status).toBe(429);
    expect(refusal.body).toMatchObject({
      code: 'consent_rate_limited',
      retryAfterSeconds: expect.any(Number),
    });
    expect(await prisma.consentRecord.count()).toBe(RECORDS_PER_HOUR);
    await expect(service.record(choice(), address())).resolves.toBeDefined();
  });

  it('never refuses a record because Redis is down', async () => {
    const down = new Redis('redis://127.0.0.1:1', {
      commandTimeout: 200,
      connectTimeout: 200,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    down.on('error', () => undefined);
    const withoutRedis = new ConsentsService(
      prisma,
      new AuditService(),
      new ConsentThrottle(down),
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      withoutRedis.record(choice(), address()),
    ).resolves.toBeDefined();
    down.disconnect();
  });
});

// @traces 244-FR-010
describe('a choice made signed in', () => {
  it('files the row on the account and one audit entry by the account itself', async () => {
    const accountId = await newAccount();

    await service.record(
      choice({ decision: 'withdrawn' }),
      address(),
      actorOf(accountId),
    );

    const [row] = await prisma.consentRecord.findMany();
    expect(row?.accountId).toBe(accountId);
    const entries = await analyticsEntries(accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: accountId,
      newValue: {
        decision: 'withdrawn',
        textVersion: ANALYTICS_CONSENT_VERSION,
      },
      subjectId: accountId,
      subjectType: 'account',
    });
  });

  it('writes no audit entry for a visitor', async () => {
    // The audit history is append-only: count from where the test starts.
    const entries = () =>
      prisma.activityLog.count({ where: { field: 'analyticsConsent' } });
    const before = await entries();

    await service.record(choice(), address());

    expect(await entries()).toBe(before);
  });
});

// @traces 244-FR-011
describe('my consents', () => {
  it('answers no analytics choice when the account has none', async () => {
    const accountId = await newAccount();

    const mine = await service.mine(accountId);

    expect(mine.analytics).toBeNull();
  });

  it('answers the choice with the latest time, not the latest received', async () => {
    const accountId = await newAccount();
    const actor = actorOf(accountId);
    await service.record(
      choice({ at: '2026-10-10T10:00:00.000Z', decision: 'granted' }),
      address(),
      actor,
    );
    await service.record(
      choice({ at: '2026-10-10T09:00:00.000Z', decision: 'refused' }),
      address(),
      actor,
    );
    await service.record(choice({ decision: 'withdrawn' }), address());

    const mine = await service.mine(accountId);

    expect(mine.analytics).toEqual({
      at: '2026-10-10T10:00:00.000Z',
      decision: 'granted',
      language: 'ro',
      textVersion: ANALYTICS_CONSENT_VERSION,
    });
  });

  it('lists the terms and privacy notice the account accepted', async () => {
    const accountId = await newAccount();

    const { accepted } = await service.mine(accountId);

    expect(accepted.map((a) => [a.kind, a.textVersion]).sort()).toEqual([
      ['privacy_notice', CURRENT_CONSENT.privacyVersion],
      ['terms', CURRENT_CONSENT.termsVersion],
    ]);
    expect(accepted[0]?.acceptedAt).toEqual(expect.any(String));
  });
});

// @traces 244-FR-016
describe('what a record reports', () => {
  it('logs one line without any id and counts the decision', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const before = await counterTotal(
      reader,
      'motorfix_consent_records_total',
      { decision: 'refused' },
    );
    const browserConsentId = randomUUID();

    const { id } = await service.record(
      choice({ browserConsentId, decision: 'refused' }),
      address(),
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(log.mock.calls[0]);
    expect(line).toContain('refused');
    expect(line).not.toContain(id);
    expect(line).not.toContain(browserConsentId);
    expect(
      await counterTotal(reader, 'motorfix_consent_records_total', {
        decision: 'refused',
      }),
    ).toBe(before + 1);
  });
});
