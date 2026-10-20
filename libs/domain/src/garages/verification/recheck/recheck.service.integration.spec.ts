import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
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
import { SuspensionService } from '../suspension/suspension.service';

const redisUrl = redisUrlFor(13);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const rechecksCounted = (result: string) =>
  counterTotal(reader, 'motorfix_rechecks_total', { result });
const suspensionsCounted = () =>
  counterTotal(reader, 'motorfix_garage_suspensions_total', {
    cause: 'recheck_failed',
  });

const WIDER_RO =
  'O autorizație mai largă se înregistrează printr-o modificare a datelor';
const WIDER_EN =
  'A wider authorisation is recorded through a change of details';
const STALE_RO = 'Datele service-ului s-au schimbat. Reîncarcă lista.';
const DETAIL = 'expirată pe 12 sept. 2026';

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
let dan: string;
let ioana: string;
let admin: string;
let otherAdmin: string;
let englishAdmin: string;

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  ana = await account('Ana Popescu', ['admin']);
  dan = await account('Dan Ene', ['admin']);
  ioana = await account('Ioana Marin', ['admin'], { language: 'en' });
  admin = bearer(ana, 'admin');
  otherAdmin = bearer(dan, 'admin');
  englishAdmin = bearer(ioana, 'admin');
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

const failed = (
  lastCheckedOn: string | null,
  extra: Record<string, unknown> = {},
) => ({
  checkedOn: today(),
  detail: DETAIL,
  failure: 'expired',
  lastCheckedOn,
  result: 'failed',
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
          activityNames: [
            { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
            { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
          ],
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

// @traces 1351-FR-005 1351-FR-006 1351-FR-012 1351-FR-013 1351-FR-014
describe('recording a valid re-check', () => {
  it('stores the re-check, moves the date and keeps the activities', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const counted = await rechecksCounted('ok');

    const res = await record(g.id, valid(ago(29)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      checkedOn: today(),
      garageId: g.id,
      id: expect.any(String),
      lastCheckedOn: today(),
      result: 'ok',
      status: 'approved',
    });
    expect(await rechecks(g.id)).toEqual([
      {
        activities: ['mechanics', 'brakes'],
        automatic: false,
        checkedOn: today(),
        detail: null,
        failure: null,
        kind: 'rar',
        recordedBy: ana,
        result: 'ok',
      },
    ]);
    const after = await stored(g.id);
    expect(dayOf(after.lastCheckedOn)).toBe(today());
    expect(after.rarActivities).toEqual(['mechanics', 'brakes']);
    expect(after.status).toBe('approved');
    expect(await rechecksCounted('ok')).toBe(counted + 1);
  });

  it('takes the row off the list', async () => {
    const g = await garage({ checkedDaysAgo: 29 });

    await record(g.id, valid(ago(29)));

    expect((await list()).body.items).toEqual([]);
    expect((await list(otherAdmin)).body.items).toEqual([]);
    expect(g.id).toEqual(expect.any(String));
  });

  it('writes one audit entry with the activities before and after', async () => {
    const g = await garage({
      activities: ['mechanics', 'brakes', 'air_con'],
      checkedDaysAgo: 29,
    });

    await record(g.id, valid(ago(29)));

    const written = await entries(g.id);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      actorId: ana,
      actorName: 'Ana',
      actorRole: 'admin',
      field: 'last_checked_on',
      newValue: {
        activities: ['mechanics', 'brakes'],
        checkedOn: today(),
        result: 'ok',
      },
      oldValue: {
        activities: ['mechanics', 'brakes', 'air_con'],
        checkedOn: ago(29),
      },
      subjectId: g.id,
    });
  });

  it('writes one recheck.recorded row for the admins, the owner and the public profile, and no price-list row when nothing narrowed', async () => {
    const g = await garage({ checkedDaysAgo: 29 });

    await record(g.id, valid(ago(29)));

    const recorded = await events(g.id, 'recheck.recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toEqual({ garageId: g.id, result: 'ok' });
    expect(recorded[0]?.audience).toEqual(
      expect.arrayContaining([
        'admin',
        `garage:${g.id}`,
        `public:garage:${g.id}`,
      ]),
    );
    expect(await events(g.id, 'price_list.updated')).toHaveLength(0);
  });

  // @traces 1357-FR-004
  it('narrows the activities and emits price_list.updated for the garage', async () => {
    const g = await garage({
      activities: ['mechanics', 'brakes', 'air_con'],
      checkedDaysAgo: 29,
    });

    const res = await record(
      g.id,
      valid(ago(29), { activities: ['mechanics', 'brakes'] }),
    );

    expect(res.status).toBe(200);
    expect((await stored(g.id)).rarActivities).toEqual(['mechanics', 'brakes']);
    const updated = await events(g.id, 'price_list.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.audience).toEqual(
      expect.arrayContaining([`garage:${g.id}`, `public:garage:${g.id}`]),
    );
  });

  it('takes any date up to today when the garage had none', async () => {
    const g = await garage({ checkedDaysAgo: null });

    const res = await record(g.id, valid(null, { checkedOn: ago(400) }));

    expect(res.status).toBe(200);
    expect(dayOf((await stored(g.id)).lastCheckedOn)).toBe(ago(400));
  });

  // The price list reads an empty set as covering every job.
  it('refuses a valid re-check with no activity at all with 422 and changes nothing', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const before = await stored(g.id);

    const res = await record(g.id, valid(ago(29), { activities: [] }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'recheck_activities_empty',
      field: 'activities',
    });
    await unchanged(before, g.id);
    expect(await rechecks(g.id)).toEqual([]);
    expect(await events(g.id, 'price_list.updated')).toHaveLength(0);
  });

  it.each([
    ['ro', () => admin, WIDER_RO],
    ['en', () => englishAdmin, WIDER_EN],
  ])(
    'refuses a wider set with 422 in %s and changes nothing',
    async (_, as, message) => {
      const g = await garage({ activities: ['mechanics'], checkedDaysAgo: 29 });
      const before = await stored(g.id);

      const res = await record(
        g.id,
        valid(ago(29), { activities: ['mechanics', 'brakes'] }),
        as(),
      );

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'recheck_activities_wider',
        field: 'activities',
        message,
      });
      await unchanged(before, g.id);
    },
  );

  it('refuses an activity code that is not a RAR activity with 422', async () => {
    const g = await garage({
      activities: ['mechanics', 'tuning'],
      checkedDaysAgo: 29,
    });
    const before = await stored(g.id);

    const res = await record(g.id, valid(ago(29), { activities: ['tuning'] }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'recheck_activity_unknown',
      field: 'activities',
    });
    await unchanged(before, g.id);
  });

  it('rolls everything back when a write inside the transaction fails', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const before = await stored(g.id);
    const audit = app.get<AuditPort>(AUDIT_PORT, { strict: false });
    jest.spyOn(audit, 'record').mockRejectedValue(new Error('audit down'));

    const res = await record(g.id, valid(ago(29)));

    expect(res.status).toBe(500);
    await unchanged(before, g.id);
    expect(await rechecks(g.id)).toEqual([]);
    expect(await events(g.id)).toHaveLength(0);
  });
});

// @traces 1351-FR-005
describe('two admins on the same row', () => {
  it('refuses the second admin with 409 naming the first and the time', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    expect((await record(g.id, valid(ago(40)))).status).toBe(200);
    const after = await stored(g.id);

    const res = await record(g.id, valid(ago(40)), otherAdmin);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('recheck_conflict');
    expect(res.body.message).toMatch(
      /^Deja reverificat de Ana P\. la \d{2}:\d{2}$/,
    );
    expect(await rechecks(g.id)).toHaveLength(1);
    expect(dayOf((await stored(g.id)).lastCheckedOn)).toBe(
      dayOf(after.lastCheckedOn),
    );
    expect(await entries(g.id)).toHaveLength(1);
  });

  it('answers an English admin in English', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    await record(g.id, valid(ago(40)));

    const res = await record(g.id, valid(ago(40)), englishAdmin);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(
      /^Already re-checked by Ana P\. at \d{2}:\d{2}$/,
    );
  });

  it('names the day too when the newer re-check is not today’s', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    await record(g.id, valid(ago(40), { checkedOn: ago(30) }));
    await prisma.$executeRaw`
      UPDATE recheck SET recorded_at = recorded_at - interval '3 days'
      WHERE garage_id = ${g.id}::uuid`;

    const res = await record(g.id, valid(ago(40)), otherAdmin);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('recheck_conflict');
    expect(res.body.message).toMatch(
      /^Deja reverificat de Ana P\. pe \d{1,2} \S+ la \d{2}:\d{2}$/,
    );
  });

  it('refuses the same admin’s second save of the day as a conflict', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    await record(g.id, valid(ago(40)));

    const res = await record(g.id, valid(ago(40)));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('recheck_conflict');
    expect(await rechecks(g.id)).toHaveLength(1);
  });

  it('answers recheck_stale when the date moved without a newer re-check', async () => {
    const g = await garage({ checkedDaysAgo: 40 });
    await prisma.garage.update({
      data: { lastCheckedOn: asDate(ago(35)) },
      where: { id: g.id },
    });

    const res = await record(g.id, valid(ago(40)));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'recheck_stale',
      message: STALE_RO,
    });
    expect(await rechecks(g.id)).toEqual([]);
    expect(dayOf((await stored(g.id)).lastCheckedOn)).toBe(ago(35));
  });
});

// @traces 1351-FR-006
describe('a narrowing seen on the price list', () => {
  // @traces 1357-FR-004
  it('hides exactly the jobs whose activity left the set, through the existing rule', async () => {
    const g = await garage({
      activities: ['mechanics', 'air_con'],
      checkedDaysAgo: 29,
    });
    const owner = await account('Mihai Owner', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });
    const job = async (rarActivity: string | null, position: number) => {
      const created = await prisma.jobType.create({
        data: {
          key: `job-${randomUUID()}`,
          nameEn: `Job ${position}`,
          nameRo: `Lucrare ${position}`,
          rarActivity,
          status: 'approved',
        },
      });
      await prisma.garagePrice.create({
        data: {
          fromBani: 10_000,
          garageId: g.id,
          jobTypeId: created.id,
          position,
          toBani: 20_000,
          updatedBy: owner,
        },
      });
      return created.id;
    };
    const engine = await job('mechanics', 0);
    const aircon = await job('air_con', 1);
    const unmapped = await job(null, 2);
    const prices = async () =>
      (
        await http()
          .get(`/garages/${g.id}/prices`)
          .set('Authorization', bearer(owner, 'garage'))
      ).body.items as { jobTypeId: string; public: boolean; reason?: string }[];
    expect((await prices()).every((i) => i.public)).toBe(true);

    await record(g.id, valid(ago(29), { activities: ['mechanics'] }));

    const after = new Map((await prices()).map((i) => [i.jobTypeId, i]));
    expect(after.get(engine)).toMatchObject({ public: true });
    expect(after.get(unmapped)).toMatchObject({ public: true });
    expect(after.get(aircon)).toMatchObject({
      public: false,
      reason: 'not_authorised',
    });
  });
});

// @traces 1351-FR-002 1351-FR-007 1351-FR-012
describe('recording a failed re-check', () => {
  it.each([
    ['expired', 'expirată'],
    ['suspended', 'suspendată'],
    ['withdrawn', 'retrasă'],
  ])(
    'stores the %s re-check and suspends the garage with cause recheck_failed',
    async (failure, word) => {
      const g = await garage({ checkedDaysAgo: 29 });
      const before = await stored(g.id);
      const counted = await suspensionsCounted();

      const res = await record(g.id, failed(ago(29), { failure }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        garageId: g.id,
        lastCheckedOn: ago(29),
        result: 'failed',
        status: 'suspended',
      });
      expect(await rechecks(g.id)).toEqual([
        {
          activities: [],
          automatic: false,
          checkedOn: today(),
          detail: DETAIL,
          failure,
          kind: 'rar',
          recordedBy: ana,
          result: 'failed',
        },
      ]);
      const [suspension] = await suspensions(g.id);
      expect(suspension).toMatchObject({
        cause: 'recheck_failed',
        reason: `Autorizație RAR ${word} · ${DETAIL}`,
        suspendedBy: ana,
      });
      const after = await stored(g.id);
      expect(after.status).toBe('suspended');
      expect(dayOf(after.lastCheckedOn)).toBe(dayOf(before.lastCheckedOn));
      expect(after.rarActivities).toEqual(before.rarActivities);
      expect(await suspensionsCounted()).toBe(counted + 1);
    },
  );

  it('trims the suspension reason to 200 characters', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const detail = 'd'.repeat(200);

    await record(g.id, failed(ago(29), { detail }));

    const [suspension] = await suspensions(g.id);
    expect(suspension?.reason).toHaveLength(200);
    expect(suspension?.reason.startsWith('Autorizație RAR expirată · d')).toBe(
      true,
    );
  });

  it('leaves its own audit entry beside the suspension’s, and both events', async () => {
    const g = await garage({ checkedDaysAgo: 29 });

    await record(g.id, failed(ago(29)));

    const own = await entries(g.id);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      actorId: ana,
      field: 'status',
      newValue: { checkedOn: today(), failure: 'expired', result: 'failed' },
      text: DETAIL,
    });
    expect(await entries(g.id, 'garage_suspended')).toHaveLength(1);
    const recorded = await events(g.id, 'recheck.recorded');
    expect(recorded.map((e) => e.payload)).toEqual([
      { garageId: g.id, result: 'failed' },
    ]);
    expect(await events(g.id, 'garage.suspended')).toHaveLength(1);
  });

  it('takes the garage off the due list', async () => {
    const g = await garage({ checkedDaysAgo: 29 });

    await record(g.id, failed(ago(29)));

    expect((await list()).body.items).toEqual([]);
  });

  it.each([
    ['without a detail', { detail: undefined }],
    ['with a blank detail', { detail: '  ' }],
    ['with a detail over 200 characters', { detail: 'a'.repeat(201) }],
  ])(
    'refuses a failure %s with 422 naming the field and stores nothing',
    async (_, extra) => {
      const g = await garage({ checkedDaysAgo: 29 });
      const before = await stored(g.id);

      const res = await record(g.id, failed(ago(29), extra));

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'recheck_detail_invalid',
        field: 'detail',
      });
      await unchanged(before, g.id);
      expect(await rechecks(g.id)).toEqual([]);
    },
  );

  it('refuses a failure without a failure kind at the edge and stores nothing', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const before = await stored(g.id);

    const res = await record(g.id, failed(ago(29), { failure: undefined }));

    expect(res.status).toBe(400);
    await unchanged(before, g.id);
    expect(await rechecks(g.id)).toEqual([]);
  });

  it('rolls the re-check back with the suspension’s 409 and keeps its record of the refused attempt', async () => {
    const g = await garage({ checkedDaysAgo: 29 });
    const suspending = app.get(SuspensionService, { strict: false });
    const real = suspending.suspendIn.bind(suspending);
    // A suspension by another cause lands between the lock and the write.
    jest
      .spyOn(suspending, 'suspendIn')
      .mockImplementationOnce(async (...args) => {
        await real(...args);
        return real(...args);
      });

    const res = await record(g.id, failed(ago(29)));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('garage_already_suspended');
    expect(await rechecks(g.id)).toEqual([]);
    expect(await suspensions(g.id)).toHaveLength(0);
    expect((await stored(g.id)).status).toBe('approved');
    expect(await entries(g.id)).toHaveLength(0);
    expect(await events(g.id)).toHaveLength(0);
    expect(await entries(g.id, 'garage_suspension_refused')).toHaveLength(1);
  });
});
