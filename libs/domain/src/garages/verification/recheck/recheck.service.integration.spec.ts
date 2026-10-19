import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, localDay } from '../../../bucharest';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

const redisUrl = redisUrlFor(13);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
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
  await prisma.$disconnect();
});

afterEach(() => jest.restoreAllMocks());

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const today = () => localDay(new Date());
const ago = (days: number) => addDays(today(), -days);
const asDate = (day: string | null) => (day === null ? null : new Date(day));
const dayOf = (at: Date | null) => at?.toISOString().slice(0, 10) ?? null;

let ana: string;
let admin: string;

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  ana = await account('Ana Popescu', ['admin']);
  admin = bearer(ana, 'admin');
});

// Every earlier file was rejected; the latest is the one the garage stands on.
const fileStatus = (earlier: boolean, garageStatus: string) => {
  if (earlier) return 'rejected';
  return garageStatus === 'draft' ? 'submitted' : 'approved';
};

let slug = 0;
async function garage(
  options: {
    name?: string;
    checkedDaysAgo?: number | null;
    status?: 'draft' | 'approved' | 'suspended';
    activities?: string[];
    rarNumbers?: string[];
  } = {},
) {
  const checked =
    options.checkedDaysAgo === undefined ? 28 : options.checkedDaysAgo;
  const status = options.status ?? 'approved';
  const created = await prisma.garage.create({
    data: {
      approvedAt: status === 'draft' ? null : new Date(),
      lastCheckedOn: asDate(checked === null ? null : ago(checked)),
      name: options.name ?? 'Atelier Dinamo',
      rarActivities: options.activities ?? ['mechanics', 'brakes'],
      slug: `recheck-${slug++}-${randomUUID()}`,
      status,
    },
  });
  const numbers = options.rarNumbers ?? [];
  for (const [i, rarNumber] of numbers.entries()) {
    await prisma.verificationFile.create({
      data: {
        createdAt: new Date(Date.now() - (numbers.length - i) * 60_000),
        garageId: created.id,
        rarNumber,
        status: fileStatus(i < numbers.length - 1, status),
      },
    });
  }
  return created;
}

const list = (as: string = admin) =>
  http().get('/admin/rechecks').set('Authorization', as);

const record = (
  garageId: string,
  body: Record<string, unknown>,
  as: string = admin,
) =>
  http()
    .post(`/admin/garages/${garageId}/rechecks`)
    .set('Authorization', as)
    .send(body);

const valid = (
  lastCheckedOn: string | null,
  extra: Record<string, unknown> = {},
) => ({
  activities: ['mechanics', 'brakes'],
  checkedOn: today(),
  lastCheckedOn,
  result: 'ok',
  ...extra,
});

interface RecheckRow {
  kind: string;
  result: string;
  failure: string | null;
  detail: string | null;
  checkedOn: string;
  activities: string[];
  automatic: boolean;
  recordedBy: string | null;
}

// Read through SQL: the table is new and the generated client may lag it.
const rechecks = (garageId: string) =>
  prisma.$queryRaw<RecheckRow[]>`
    SELECT kind::text, result::text, failure::text, detail,
      checked_on::text AS "checkedOn", rar_activities AS activities,
      automatic, recorded_by::text AS "recordedBy"
    FROM recheck WHERE garage_id = ${garageId}::uuid
    ORDER BY recorded_at`;

const stored = (id: string) =>
  prisma.garage.findUniqueOrThrow({ where: { id } });
const entries = (garageId: string, kind = 'recheck_recorded') =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { garageId, kind, subjectType: 'garage' },
  });
const events = (garageId: string, kind?: string) =>
  prisma.outboxEvent.findMany({
    where: { subjectId: garageId, ...(kind && { kind }) },
  });
const suspensions = (garageId: string) =>
  prisma.garageSuspension.findMany({ where: { garageId } });

async function unchanged(
  before: Awaited<ReturnType<typeof stored>>,
  garageId: string,
) {
  const after = await stored(garageId);
  expect(after.status).toBe(before.status);
  expect(dayOf(after.lastCheckedOn)).toBe(dayOf(before.lastCheckedOn));
  expect(after.rarActivities).toEqual(before.rarActivities);
  expect(await entries(garageId)).toHaveLength(0);
  expect(await events(garageId, 'recheck.recorded')).toHaveLength(0);
  expect(await suspensions(garageId)).toHaveLength(0);
}

// @traces 1351-FR-001 1351-FR-003
describe('the due list', () => {
  it('answers the Bucharest day it used', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], today: today() });
  });

  it.each([
    [27, false, false],
    [28, true, false],
    [31, true, false],
    [32, true, true],
  ])(
    'at %i days since the last check lists it %s, overdue %s',
    async (days, listed, overdue) => {
      const g = await garage({ checkedDaysAgo: days });

      const { items } = (await list()).body;

      if (!listed) {
        expect(items).toEqual([]);
        return;
      }
      expect(items).toEqual([
        {
          activities: ['mechanics', 'brakes'],
          daysSince: days,
          garageId: g.id,
          lastCheckedOn: ago(days),
          name: 'Atelier Dinamo',
          overdue,
          rarNumber: null,
        },
      ]);
    },
  );

  it('lists a garage with no date of last check as due and overdue, first', async () => {
    await garage({ checkedDaysAgo: 40, name: 'Alfa' });
    const never = await garage({ checkedDaysAgo: null, name: 'Zeta' });

    const { items } = (await list()).body;

    expect(items[0]).toMatchObject({
      daysSince: null,
      garageId: never.id,
      lastCheckedOn: null,
      overdue: true,
    });
    expect(items).toHaveLength(2);
  });

  it('counts the approval as the first check: absent at 27 days, present at 28', async () => {
    const g = await garage({ checkedDaysAgo: 27 });
    expect((await list()).body.items).toEqual([]);

    await prisma.garage.update({
      data: { lastCheckedOn: asDate(ago(28)) },
      where: { id: g.id },
    });

    expect((await list()).body.items).toEqual([
      expect.objectContaining({ daysSince: 28, garageId: g.id }),
    ]);
  });

  it.each([
    ['suspended', 'suspended'],
    ['draft', 'draft'],
  ] as const)(
    'never lists a %s garage, whatever its date',
    async (_, status) => {
      await garage({ checkedDaysAgo: 90, status });
      await garage({ checkedDaysAgo: null, status });

      expect((await list()).body.items).toEqual([]);
    },
  );

  it('never lists a garage waiting for verification', async () => {
    await garage({
      checkedDaysAgo: null,
      rarNumbers: ['B 1234/2019'],
      status: 'draft',
    });

    expect((await list()).body.items).toEqual([]);
  });

  it('shows the newest verification file’s RAR number', async () => {
    await garage({ rarNumbers: ['B 1/2019', 'B 2/2020'] });

    expect((await list()).body.items[0].rarNumber).toBe('B 2/2020');
  });

  it('orders by date of last check, empty first, then by name, then by id', async () => {
    const beta = await garage({ checkedDaysAgo: 30, name: 'Beta' });
    const alfa = await garage({ checkedDaysAgo: 30, name: 'Alfa' });
    const oldest = await garage({ checkedDaysAgo: 45, name: 'Zeta' });
    const never = await garage({ checkedDaysAgo: null, name: 'Omega' });
    const twinA = await garage({ checkedDaysAgo: 29, name: 'Gama' });
    const twinB = await garage({ checkedDaysAgo: 29, name: 'Gama' });
    const twins = [twinA.id, twinB.id].sort();

    const ids = (await list()).body.items.map(
      (i: { garageId: string }) => i.garageId,
    );

    expect(ids).toEqual([never.id, oldest.id, alfa.id, beta.id, ...twins]);
  });

  it('writes nothing', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    const before = await stored(g.id);
    const logged = await prisma.activityLog.count();
    const emitted = await prisma.outboxEvent.count();

    await list();

    await unchanged(before, g.id);
    expect(await prisma.activityLog.count()).toBe(logged);
    expect(await prisma.outboxEvent.count()).toBe(emitted);
    expect(await rechecks(g.id)).toEqual([]);
  });
});

// @traces 1351-FR-003 1351-FR-004
describe('closed to everyone but admins', () => {
  it.each([
    ['a driver', ['driver'], 'driver'],
    ['a garage owner', ['garage'], 'garage'],
  ] as const)(
    'answers %s 404 on the list and the record',
    async (_, roles, role) => {
      const g = await garage({ checkedDaysAgo: 40 });
      const before = await stored(g.id);
      const who = bearer(await account(`Radu ${role}`, [...roles]), role);

      expect((await list()).status).toBe(200);

      expect((await list(who)).status).toBe(404);
      expect((await record(g.id, valid(ago(40)), who)).status).toBe(404);

      await unchanged(before, g.id);
    },
  );

  it.each([
    ['an unknown id', '7d3c1a52-8d6e-4f0b-9d5e-2f7f3c8b1a90'],
    ['a malformed id', 'not-a-uuid'],
  ])('answers an admin 404 for %s', async (_, id) => {
    const res = await record(id, valid(ago(40)));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});

// @traces 1351-FR-005
describe('a garage that is not due', () => {
  it.each([
    ['checked 10 days ago', { checkedDaysAgo: 10 }],
    ['checked at approval today', { checkedDaysAgo: 0 }],
    ['suspended', { checkedDaysAgo: 40, status: 'suspended' as const }],
    ['a draft', { checkedDaysAgo: 40, status: 'draft' as const }],
  ])(
    'refuses a record for a garage %s with 409 recheck_not_due',
    async (_, options) => {
      const g = await garage(options);
      const before = await stored(g.id);

      const res = await record(g.id, valid(dayOf(before.lastCheckedOn)));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('recheck_not_due');
      await unchanged(before, g.id);
      expect(await rechecks(g.id)).toEqual([]);
    },
  );
});

// @traces 1351-FR-004
describe('the date checked', () => {
  it.each([
    ['after today', () => addDays(today(), 1)],
    ['on the date of last check', () => ago(40)],
    ['before the date of last check', () => ago(41)],
  ])('refuses a date %s with 422 naming the field', async (_, checkedOn) => {
    const g = await garage({ checkedDaysAgo: 40 });
    const before = await stored(g.id);

    const res = await record(g.id, valid(ago(40), { checkedOn: checkedOn() }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'recheck_date_invalid',
      field: 'checkedOn',
    });
    await unchanged(before, g.id);
  });

  it('refuses a detail sent with a valid result with 422 naming the field', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    const before = await stored(g.id);

    const res = await record(g.id, valid(ago(40), { detail: 'în regulă' }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'recheck_detail_invalid',
      field: 'detail',
    });
    await unchanged(before, g.id);
  });
});
