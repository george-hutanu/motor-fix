import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { localDay } from '../../bucharest';
import { cacheKey } from '../../cache/cache.service';
import { purgeAudience } from '../../cache/purge';
import { outbox } from '../../events/event.port';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { dropSearches } from '../../search/garage-search/garage-search.cache';
import { SearchModule } from '../../search/search.module';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';
import { NO_BRAND } from '../public-garages/public-garages';

// @traces 1246-FR-001 1246-FR-002 1246-FR-003 1246-FR-004 1246-FR-005
// @traces 1246-FR-006 1246-FR-007 1246-FR-008 1246-FR-009 1246-FR-010
// @traces 1246-FR-027

const redisUrl = redisUrlFor(2);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const PHONE = '+40722123456';
const WEEK = {
  fri: [['08:00', '17:00']],
  mon: [['08:00', '17:00']],
  sat: [],
  sun: [],
  thu: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
};
const SATURDAY = { ...WEEK, sat: [['09:00', '13:00']] };

let app: NestExpressApplication;
let redis: Redis;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;
let lastEvent: bigint;

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
      SearchModule,
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
  redis = new Redis(redisUrl);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.flushdb();
  await checkpoint();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function checkpoint() {
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  const [{ id }] = await prisma.$queryRaw<
    { id: bigint }[]
  >`SELECT COALESCE(MAX(id), 0)::bigint AS id FROM outbox_event`;
  lastEvent = id;
}

// A Bucharest day `n` days from today.
const dayAhead = (n: number) => {
  const today = new Date(`${localDay(new Date())}T00:00:00Z`);
  return new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
};

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Service Auto Nord with its owner, a receptionist and a mechanic; Atelier
// Dinamo with its owner.
async function world(
  data: Partial<Parameters<typeof prisma.garage.create>[0]['data']> = {},
) {
  const nord = await prisma.garage.create({
    data: {
      address: 'Str. Atelierului 14, București',
      facilitiesNote: 'Cafea și Wi-Fi',
      hours: WEEK,
      knownFor: 'Dacia și Renault',
      name: 'Service Auto Nord',
      phone: PHONE,
      slug: `nord-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });
  await prisma.garageFacility.createMany({
    data: [
      { facility: 'waiting_area', garageId: nord.id },
      { facility: 'courtesy_car', garageId: nord.id },
    ],
  });
  const dinamo = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: nord.id, name: 'Mecanic' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  return {
    mechanic: bearer(vlad, 'mechanic'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const mobile = {
  address: null,
  businessKind: 'mobile' as const,
  cui: '12345678',
  latitude: 44.9365,
  longitude: 26.0129,
  mobileLegalForm: 'pfa' as const,
  seatAddress: 'Str. Sediului 3, Chiajna',
  serviceRadiusKm: 20,
};

const patch = (w: World, body: object, as: string | null = w.owner) => {
  const req = http().patch(`/garages/${w.nord.id}/profile`).send(body);
  return as ? req.set('Authorization', as) : req;
};

const stored = (garageId: string) =>
  prisma.garage.findUniqueOrThrow({
    select: {
      facilitiesNote: true,
      hours: true,
      knownFor: true,
      name: true,
      phone: true,
      profileVersion: true,
      serviceRadiusKm: true,
      slug: true,
    },
    where: { id: garageId },
  });

const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { at: { gte: since }, garageId, subjectType: 'garage' },
  });

const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    where: {
      id: { gt: lastEvent },
      kind: 'garage.updated',
      subjectId: garageId,
    },
  });

const facilities = async (garageId: string) =>
  (
    await prisma.garageFacility.findMany({
      orderBy: { facility: 'asc' },
      where: { garageId },
    })
  ).map((f) => f.facility);

const closedDays = async (garageId: string) =>
  (
    await prisma.garageClosedDay.findMany({
      orderBy: { day: 'asc' },
      where: { garageId },
    })
  ).map((c) => ({ day: c.day.toISOString().slice(0, 10), note: c.note }));

// Nothing of a refused save stays: the row, the history, the outbox.
async function nothingWritten(w: World, before: object) {
  expect(await stored(w.nord.id)).toEqual(before);
  expect(await history(w.nord.id)).toEqual([]);
  expect(await events(w.nord.id)).toEqual([]);
}

describe('PATCH /garages/:garageId/profile: who may save', () => {
  it("answers the owner 200 with the owner's profile and the new stamp", async () => {
    const w = await world();

    const res = await patch(w, { name: 'Service Auto Sud', version: '0' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Service Auto Sud',
      phone: PHONE,
      version: '1',
    });
    const read = await http()
      .get(`/garages/${w.nord.id}/profile`)
      .set('Authorization', w.owner);
    expect(res.body).toEqual(read.body);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const w = await world();

    const res = await patch(
      w,
      { name: 'Service Auto Sud', version: '0' },
      null,
    );

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it("answers 403 forbidden to the garage's receptionist and mechanic", async () => {
    const w = await world();
    const before = await stored(w.nord.id);

    for (const as of [w.receptionist, w.mechanic]) {
      const res = await patch(
        w,
        { name: 'Service Auto Sud', version: '0' },
        as,
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    }
    await nothingWritten(w, before);
  });

  it("answers 404 to another garage's owner", async () => {
    const w = await world();
    const before = await stored(w.nord.id);

    const res = await patch(
      w,
      { name: 'Service Auto Sud', version: '0' },
      w.other,
    );

    expect(res.status).toBe(404);
    await nothingWritten(w, before);
  });

  it('answers 404 to the owner of a garage not yet approved', async () => {
    const w = await world({ status: 'draft' });
    const before = await stored(w.nord.id);

    const res = await patch(w, { name: 'Service Auto Sud', version: '0' });

    expect(res.status).toBe(404);
    await nothingWritten(w, before);
  });

  it('answers 410 gone to the owner of a suspended garage', async () => {
    const w = await world({ status: 'suspended' });
    const before = await stored(w.nord.id);

    const res = await patch(w, { name: 'Service Auto Sud', version: '0' });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('gone');
    await nothingWritten(w, before);
  });
});

describe('PATCH /garages/:garageId/profile: the limits', () => {
  it.each([
    ['a name of 2 characters', { name: 'AB' }],
    ['a name of 80 characters', { name: 'N'.repeat(80) }],
    ['a description of 1,000 characters', { description: 'd'.repeat(1000) }],
  ])('takes %s', async (_, body) => {
    const w = await world();

    const res = await patch(w, { version: '0', ...body });

    expect(res.status).toBe(200);
  });

  it.each([5, 100])(
    'takes a radius of %p km for a mobile mechanic',
    async (km) => {
      const w = await world(mobile);

      const res = await patch(w, { serviceRadiusKm: km, version: '0' });

      expect(res.status).toBe(200);
      expect(res.body.serviceRadiusKm).toBe(km);
      expect((await stored(w.nord.id)).serviceRadiusKm).toBe(km);
    },
  );

  it.each([
    ['a name of 1 character', { name: 'N' }, 'name'],
    ['a name of 81 characters', { name: 'N'.repeat(81) }, 'name'],
    [
      'a description of 1,001 characters',
      { description: 'd'.repeat(1001) },
      'description',
    ],
    ['a phone the normaliser refuses', { phone: '12' }, 'phone'],
    ['a field it does not know', { slug: 'altul' }, 'slug'],
  ])(
    'answers 400 to %s naming it, and writes nothing',
    async (_, body, field) => {
      const w = await world();
      const before = await stored(w.nord.id);

      const res = await patch(w, { version: '0', ...body });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
        field,
      ]);
      await nothingWritten(w, before);
    },
  );

  it.each([[4], [101], [30.5], ['30']])(
    'answers 400 to a radius of %p for a mobile mechanic',
    async (km) => {
      const w = await world(mobile);
      const before = await stored(w.nord.id);

      const res = await patch(w, { serviceRadiusKm: km, version: '0' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ field: 'serviceRadiusKm' }),
      ]);
      await nothingWritten(w, before);
    },
  );

  it('answers 400 radius_not_applicable to a radius for a workshop', async () => {
    const w = await world();
    const before = await stored(w.nord.id);

    const res = await patch(w, { serviceRadiusKm: 30, version: '0' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      { code: 'radius_not_applicable', field: 'serviceRadiusKm' },
    ]);
    await nothingWritten(w, before);
  });

  it('answers 400 to a body with nothing to save', async () => {
    const w = await world();

    const res = await patch(w, { version: '0' });

    expect(res.status).toBe(400);
  });

  it.each([
    'address',
    'companyName',
    'cui',
    'mobileLegalForm',
    'seatAddress',
    'rarActivities',
    'proposedJobs',
  ])(
    'answers 422 needs_verification to %s and writes nothing',
    async (field) => {
      const w = await world();
      const before = await stored(w.nord.id);

      const res = await patch(w, { [field]: 'x', version: '0' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('needs_verification');
      expect(res.body.errors).toEqual([expect.objectContaining({ field })]);
      await nothingWritten(w, before);
    },
  );
});

describe('PATCH /garages/:garageId/profile: the order of refusals', () => {
  const broken = { address: 'x', name: 'N', version: '9' };

  it('answers 401 before anything else', async () => {
    const w = await world({ status: 'suspended' });

    expect((await patch(w, broken, null)).status).toBe(401);
  });

  it('answers 403 to staff and 410 to a suspended garage before 422', async () => {
    const w = await world({ status: 'suspended' });

    expect((await patch(w, broken, w.receptionist)).status).toBe(403);
    expect((await patch(w, broken)).status).toBe(410);
  });

  it('answers 422 before 400, and 400 before 409', async () => {
    const w = await world();

    expect((await patch(w, broken)).status).toBe(422);
    expect((await patch(w, { name: 'N', version: '9' })).status).toBe(400);
    const stale = await patch(w, { name: 'Service Auto Sud', version: '9' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('profile_changed');
  });
});

describe('PATCH /garages/:garageId/profile: what a save writes', () => {
  it('records one update entry per changed field, by the owner, on the garage', async () => {
    const w = await world();

    await patch(w, {
      description: 'Specializați pe Dacia',
      name: 'Service Auto Sud',
      phone: '0733 000 111',
      version: '0',
    }).expect(200);

    const entries = await history(w.nord.id);
    expect(entries.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['known_for', 'Dacia și Renault', 'Specializați pe Dacia'],
      ['name', 'Service Auto Nord', 'Service Auto Sud'],
      ['phone', PHONE, '+40733000111'],
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: 'update',
        actorId: w.mihai,
        actorRole: 'owner',
        garageId: w.nord.id,
        subjectId: w.nord.id,
      });
    }
  });

  it('saves one garage.updated naming the fields, never the phone', async () => {
    const w = await world();

    await patch(w, {
      name: 'Service Auto Sud',
      phone: '0733 000 111',
      version: '0',
    }).expect(200);

    const saved = await events(w.nord.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toEqual({
      fields: ['name', 'phone'],
      garageId: w.nord.id,
    });
    expect([...saved[0].audience].sort()).toEqual(
      [
        `garage:${w.nord.id}`,
        `public:garage:${w.nord.id}`,
        'public:search',
      ].sort(),
    );
    expect(
      JSON.stringify(saved.map((e) => [e.payload, e.audience])),
    ).not.toContain('733000111');
  });

  it('leaves no field, entry or event when a write of the save fails', async () => {
    const w = await world();
    const before = await stored(w.nord.id);
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));

    const res = await patch(w, { name: 'Service Auto Sud', version: '0' });

    expect(res.status).toBe(500);
    await nothingWritten(w, before);
  });

  it('writes nothing and keeps the stamp when nothing changes', async () => {
    const w = await world();
    const before = await stored(w.nord.id);

    const res = await patch(w, {
      closedDays: [],
      description: 'Dacia și Renault ',
      hours: WEEK,
      name: ' Service Auto Nord',
      phone: '0722 123 456',
      version: '0',
    });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('0');
    await nothingWritten(w, before);
  });

  it('answers 409 profile_changed to a stale stamp and writes nothing', async () => {
    const w = await world();
    await patch(w, { name: 'Service Auto Sud', version: '0' }).expect(200);
    await checkpoint();
    const before = await stored(w.nord.id);

    const res = await patch(w, { name: 'Service Auto Vest', version: '0' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('profile_changed');
    await nothingWritten(w, before);
  });

  it('lets exactly one of two saves with the same stamp win', async () => {
    const w = await world();

    const answers = await Promise.all([
      patch(w, { name: 'Service Auto Sud', version: '0' }),
      patch(w, { name: 'Service Auto Vest', version: '0' }),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await stored(w.nord.id)).profileVersion).toBe(1);
    expect(await events(w.nord.id)).toHaveLength(1);
  });

  it('stores the phone normalised and keeps it off the public read', async () => {
    const w = await world();

    await patch(w, { phone: '0733 000 111', version: '0' }).expect(200);

    expect((await stored(w.nord.id)).phone).toBe('+40733000111');
    const open = await http().get(`/garages/${w.nord.slug}`);
    expect(open.status).toBe(200);
    expect(open.body).not.toHaveProperty('phone');
    expect(open.text).not.toContain('733000111');
  });

  it('stores the description trimmed, an empty one as none', async () => {
    const w = await world();

    await patch(w, { description: '  Frâne și ulei ', version: '0' }).expect(
      200,
    );
    expect((await stored(w.nord.id)).knownFor).toBe('Frâne și ulei');

    await patch(w, { description: '   ', version: '1' }).expect(200);
    expect((await stored(w.nord.id)).knownFor).toBeNull();
  });

  it('serves a 1,000-character description on the public read as written', async () => {
    const w = await world();
    const text = `${'Reparații complete. '.repeat(49)}Sună-ne!`.slice(0, 1000);

    await patch(w, { description: text, version: '0' }).expect(200);

    const open = await http().get(`/garages/${w.nord.slug}`);
    expect(open.body.description).toBe(text);
  });

  it('never rewrites the slug on a new name', async () => {
    const w = await world();

    await patch(w, { name: 'Service Auto Sud', version: '0' }).expect(200);

    expect((await stored(w.nord.id)).slug).toBe(w.nord.slug);
  });

  it('answers the saved profile even while the public read is cached', async () => {
    const w = await world();
    await http().get(`/garages/${w.nord.slug}`).expect(200);

    const res = await patch(w, { name: 'Service Auto Sud', version: '0' });

    expect(res.body.name).toBe('Service Auto Sud');
  });

  it('drops the cached public profile once the relay hands on its garage.updated', async () => {
    const w = await world();
    await http().get(`/garages/${w.nord.slug}`).expect(200);
    const key = cacheKey('profile', w.nord.slug, NO_BRAND);
    expect(await redis.get(key)).not.toBeNull();

    await patch(w, { name: 'Service Auto Sud', version: '0' }).expect(200);
    const [event] = await events(w.nord.id);
    await purgeAudience(redis, event.audience);

    expect(await redis.get(key)).toBeNull();
    const open = await http().get(`/garages/${w.nord.slug}`);
    expect(open.body.name).toBe('Service Auto Sud');
  });
});

describe('PATCH /garages/:garageId/profile: hours and closed days', () => {
  it('writes the week and closed days and leaves the facilities and their note', async () => {
    const w = await world();
    const day = dayAhead(20);

    const res = await patch(w, {
      closedDays: [{ day, note: 'Inventar' }],
      hours: SATURDAY,
      version: '0',
    });

    expect(res.status).toBe(200);
    const row = await stored(w.nord.id);
    expect(row.hours).toEqual(SATURDAY);
    expect(row.facilitiesNote).toBe('Cafea și Wi-Fi');
    expect(row.profileVersion).toBe(1);
    expect(await facilities(w.nord.id)).toEqual([
      'courtesy_car',
      'waiting_area',
    ]);
    expect(await closedDays(w.nord.id)).toEqual([{ day, note: 'Inventar' }]);
    // Past the public answer's two weeks, the owner's answer still has it,
    // note included, so the dialog sends the list back whole.
    expect(res.body.storedClosedDays).toEqual([{ day, note: 'Inventar' }]);
  });

  it('adds one hours entry when the week changed, and none for the facilities', async () => {
    const w = await world();

    await patch(w, { closedDays: [], hours: SATURDAY, version: '0' }).expect(
      200,
    );

    const entries = await history(w.nord.id);
    expect(entries.map((e) => e.field)).toEqual(['hours']);
    expect(entries[0]).toMatchObject({ newValue: SATURDAY, oldValue: WEEK });
    const saved = await events(w.nord.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toEqual({
      fields: ['hours'],
      garageId: w.nord.id,
    });
  });

  it('keeps the stored closed days and their notes when only the week is sent', async () => {
    const w = await world();
    const day = dayAhead(20);
    const later = dayAhead(21);
    await prisma.garageClosedDay.createMany({
      data: [
        {
          day: new Date(`${day}T00:00:00Z`),
          garageId: w.nord.id,
          note: 'Inventar',
        },
        { day: new Date(`${later}T00:00:00Z`), garageId: w.nord.id },
      ],
    });

    await patch(w, { hours: SATURDAY, version: '0' }).expect(200);

    expect((await stored(w.nord.id)).hours).toEqual(SATURDAY);
    expect(await closedDays(w.nord.id)).toEqual([
      { day, note: 'Inventar' },
      { day: later, note: null },
    ]);
    expect((await events(w.nord.id))[0].payload).toEqual({
      fields: ['hours'],
      garageId: w.nord.id,
    });
  });

  it('keeps the stored week when only the closed days are sent', async () => {
    const w = await world();
    const day = dayAhead(20);

    await patch(w, { closedDays: [{ day }], version: '0' }).expect(200);

    expect((await stored(w.nord.id)).hours).toEqual(WEEK);
    expect(await closedDays(w.nord.id)).toEqual([{ day, note: null }]);
  });

  it('drops a closed day on a legal holiday and counts no change for it', async () => {
    const w = await world();
    const day = dayAhead(40);
    const at = new Date(`${day}T00:00:00Z`);
    const known = await prisma.publicHoliday.findUnique({ where: { day: at } });
    if (!known) {
      await prisma.publicHoliday.create({
        data: { day: at, nameEn: 'Holiday', nameRo: 'Sărbătoare' },
      });
    }
    try {
      const before = await stored(w.nord.id);

      const res = await patch(w, {
        closedDays: [{ day }],
        hours: WEEK,
        version: '0',
      });

      expect(res.status).toBe(200);
      expect(await closedDays(w.nord.id)).toEqual([]);
      await nothingWritten(w, before);
    } finally {
      if (!known) await prisma.publicHoliday.delete({ where: { day: at } });
    }
  });

  it('refuses hours that break a rule with 400 naming them', async () => {
    const w = await world();
    const before = await stored(w.nord.id);

    const res = await patch(w, {
      hours: { ...WEEK, mon: [['17:00', '08:00']] },
      version: '0',
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ field: 'hours' }),
    ]);
    await nothingWritten(w, before);
  });
});

// A cash-only garage with the waiting area and a free courtesy car.
const CASH = { card: false, cash: true, transfer: false };
const listing = (data: Parameters<typeof world>[0] = {}) =>
  world({ paymentCash: true, ...data });

const facilitiesGroup = (group: object = {}) => ({
  courtesyCar: { paid: false },
  facilities: ['courtesy_car', 'waiting_area'],
  facilitiesNote: 'Cafea și Wi-Fi',
  paymentMethods: CASH,
  ...group,
});

const saveGroup = (w: World, group: object = {}, version = '0') =>
  patch(w, { facilities: facilitiesGroup(group), version });

const terms = (garageId: string) =>
  prisma.garage.findUniqueOrThrow({
    select: {
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: true,
      facilitiesNote: true,
      paymentCard: true,
      paymentCash: true,
      paymentTransfer: true,
      profileVersion: true,
    },
    where: { id: garageId },
  });

const facilityHistory = async (garageId: string) =>
  (
    await prisma.activityLog.findMany({
      orderBy: { action: 'asc' },
      where: { at: { gte: since }, garageId, subjectType: 'garage_facility' },
    })
  ).map((e) => [e.action, e.oldValue ?? e.newValue]);

const changes = async (garageId: string) =>
  (await history(garageId)).map((e) => [e.field, e.oldValue, e.newValue]);

const fieldsOf = async (garageId: string) => {
  const saved = await events(garageId);
  expect(saved).toHaveLength(1);
  return saved[0];
};

// @traces 1248-FR-004
// @traces 1248-FR-006
// @traces 1248-FR-007
describe('PATCH /garages/:garageId/profile: the facilities', () => {
  it('ticks a facility: one row, one create entry, one event searched', async () => {
    const w = await listing();

    const res = await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
      version: '1',
    });
    expect(await facilities(w.nord.id)).toEqual([
      'courtesy_car',
      'pickup_dropoff',
      'waiting_area',
    ]);
    expect(await facilityHistory(w.nord.id)).toEqual([
      ['create', { facility: 'pickup_dropoff' }],
    ]);
    const event = await fieldsOf(w.nord.id);
    expect(event.payload).toEqual({
      fields: ['facilities'],
      garageId: w.nord.id,
    });
    expect(event.audience).toContain('public:search');
  });

  it('unticks a facility: the row goes with one delete entry', async () => {
    const w = await listing();

    await saveGroup(w, {
      courtesyCar: undefined,
      facilities: ['waiting_area'],
    }).expect(200);

    expect(await facilities(w.nord.id)).toEqual(['waiting_area']);
    expect(await facilityHistory(w.nord.id)).toEqual([
      ['delete', { facility: 'courtesy_car' }],
    ]);
  });

  it('ticks one and unticks another in one save under one event', async () => {
    const w = await listing();

    await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff'],
    }).expect(200);

    expect(await facilityHistory(w.nord.id)).toEqual([
      ['create', { facility: 'pickup_dropoff' }],
      ['delete', { facility: 'waiting_area' }],
    ]);
    expect((await fieldsOf(w.nord.id)).payload).toEqual({
      fields: ['facilities'],
      garageId: w.nord.id,
    });
  });

  it('answers what GET answers, with the new stamp', async () => {
    const w = await listing();

    const res = await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
    });

    const read = await http()
      .get(`/garages/${w.nord.id}/profile`)
      .set('Authorization', w.owner);
    expect(res.body).toEqual(read.body);
  });

  it('keeps the week and every closed day when only the facilities move', async () => {
    const w = await listing();
    const day = dayAhead(20);
    await prisma.garageClosedDay.create({
      data: {
        day: new Date(`${day}T00:00:00Z`),
        garageId: w.nord.id,
        note: 'Inventar',
      },
    });

    await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
    }).expect(200);

    expect((await stored(w.nord.id)).hours).toEqual(WEEK);
    expect(await closedDays(w.nord.id)).toEqual([{ day, note: 'Inventar' }]);
    expect(await changes(w.nord.id)).toEqual([]);
  });

  it('saves the facilities with the hours in one save and one event', async () => {
    const w = await listing();

    await patch(w, {
      facilities: facilitiesGroup({
        facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
      }),
      hours: SATURDAY,
      version: '0',
    }).expect(200);

    expect((await stored(w.nord.id)).hours).toEqual(SATURDAY);
    expect(await facilities(w.nord.id)).toContain('pickup_dropoff');
    expect((await fieldsOf(w.nord.id)).payload).toEqual({
      fields: ['hours', 'facilities'],
      garageId: w.nord.id,
    });
  });

  it.each([
    ['an unknown facility', { facilities: ['valet'] }, 'facilities.facilities'],
    [
      'a facility twice',
      { courtesyCar: undefined, facilities: ['waiting_area', 'waiting_area'] },
      'facilities.facilities',
    ],
    ['no facilities key', { facilities: undefined }, 'facilities.facilities'],
    [
      'no payment methods key',
      { paymentMethods: undefined },
      'facilities.paymentMethods',
    ],
  ])(
    'answers 400 to %s naming it, and writes nothing',
    async (_, group, field) => {
      const w = await listing();
      const before = await stored(w.nord.id);

      const res = await saveGroup(w, group);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
        field,
      ]);
      await nothingWritten(w, before);
      expect(await facilityHistory(w.nord.id)).toEqual([]);
    },
  );
});

// @traces 1248-FR-008
describe('PATCH /garages/:garageId/profile: the facilities on the public read', () => {
  it('drops the cached public profile so it lists the new facility', async () => {
    const w = await listing();
    await http().get(`/garages/${w.nord.slug}`).expect(200);
    const key = cacheKey('profile', w.nord.slug, NO_BRAND);
    expect(await redis.get(key)).not.toBeNull();

    await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
    }).expect(200);
    await purgeAudience(redis, (await fieldsOf(w.nord.id)).audience);

    expect(await redis.get(key)).toBeNull();
    const open = await http().get(`/garages/${w.nord.slug}`);
    expect(open.body.facilities).toContain('pickup_dropoff');
  });

  it('carries the search audience whenever the facilities or payments move', async () => {
    const w = await listing();

    await saveGroup(w, {
      paymentMethods: { card: true, cash: true, transfer: false },
    }).expect(200);

    const event = await fieldsOf(w.nord.id);
    expect(event.payload).toEqual({
      fields: ['payment_methods'],
      garageId: w.nord.id,
    });
    expect(event.audience).toContain('public:search');
  });

  it('lets a card search find the garage on the first read after the save', async () => {
    const w = await listing({ latitude: 46.771, longitude: 23.624 });
    const slug = `dacia-${randomUUID()}`;
    const { id: brandId } = await prisma.brand.create({
      data: { key: slug, name: 'Dacia', slug },
    });
    await prisma.garageBrand.create({
      data: { brandId, garageId: w.nord.id, stance: 'works_on' },
    });
    const search = () =>
      http()
        .get('/search/garages')
        .query({ brand: slug, card: '1', near: '46.771,23.624' });
    expect((await search().expect(200)).body.total).toBe(0);

    await saveGroup(w, {
      paymentMethods: { card: true, cash: true, transfer: false },
    }).expect(200);
    // As the relay hands the event: the tags, then the search generation, so
    // the next read never depends on another suite's relay getting there first.
    const { audience } = await fieldsOf(w.nord.id);
    await purgeAudience(redis, audience);
    await dropSearches(redis, audience);

    expect((await search().expect(200)).body.total).toBe(1);
  });

  it('keeps search out of the audience for the note alone', async () => {
    const w = await listing();

    await saveGroup(w, { facilitiesNote: 'Cafea' }).expect(200);

    expect((await fieldsOf(w.nord.id)).audience).not.toContain('public:search');
  });
});

// @traces 1248-FR-002
// @traces 1248-FR-003
// @traces 1248-FR-006
describe('PATCH /garages/:garageId/profile: the courtesy car', () => {
  it('prices the car at 150 lei a day with one entry per column', async () => {
    const w = await listing();

    const res = await saveGroup(w, {
      courtesyCar: { paid: true, pricePerDayBani: 15_000 },
    });

    expect(res.status).toBe(200);
    expect(res.body.courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 15_000,
    });
    expect(await terms(w.nord.id)).toMatchObject({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 15_000,
    });
    expect(await changes(w.nord.id)).toEqual([
      ['courtesy_car_paid', false, true],
      ['courtesy_car_price_per_day_bani', null, 15_000],
    ]);
    for (const entry of await history(w.nord.id)) {
      expect(entry).toMatchObject({ action: 'update', actorId: w.mihai });
    }
    expect((await fieldsOf(w.nord.id)).payload).toEqual({
      fields: ['courtesy_car'],
      garageId: w.nord.id,
    });
  });

  it('makes a paid car free and clears its price', async () => {
    const w = await listing({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 15_000,
    });

    await saveGroup(w, { courtesyCar: { paid: false } }).expect(200);

    expect(await terms(w.nord.id)).toMatchObject({
      courtesyCarPaid: false,
      courtesyCarPricePerDayBani: null,
    });
  });

  it('ticks the car and prices it in one save', async () => {
    const w = await listing();
    await prisma.garageFacility.deleteMany({
      where: { facility: 'courtesy_car', garageId: w.nord.id },
    });

    await saveGroup(w, {
      courtesyCar: { paid: true, pricePerDayBani: 5000 },
    }).expect(200);

    expect(await facilities(w.nord.id)).toContain('courtesy_car');
    expect((await terms(w.nord.id)).courtesyCarPricePerDayBani).toBe(5000);
  });

  it('keeps the stored terms, unaudited, when the car is unticked', async () => {
    const w = await listing({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 15_000,
    });

    const res = await saveGroup(w, {
      courtesyCar: undefined,
      facilities: ['waiting_area'],
    });

    expect(res.status).toBe(200);
    expect(res.body.courtesyCar).toBeUndefined();
    expect(await terms(w.nord.id)).toMatchObject({
      courtesyCarPaid: true,
      courtesyCarPricePerDayBani: 15_000,
    });
    expect(await changes(w.nord.id)).toEqual([]);
  });

  it.each([100, 200_000])('takes a price of %p bani', async (price) => {
    const w = await listing();

    await saveGroup(w, {
      courtesyCar: { paid: true, pricePerDayBani: price },
    }).expect(200);

    expect((await terms(w.nord.id)).courtesyCarPricePerDayBani).toBe(price);
  });

  it.each([
    ['99 bani', { paid: true, pricePerDayBani: 99 }],
    ['200,100 bani', { paid: true, pricePerDayBani: 200_100 }],
    ['150 bani, off the step', { paid: true, pricePerDayBani: 150 }],
    ['paid without a price', { paid: true }],
    ['free with a price', { paid: false, pricePerDayBani: 5000 }],
  ])('answers 400 to %s naming the price', async (_, courtesyCar) => {
    const w = await listing();
    const before = await stored(w.nord.id);

    const res = await saveGroup(w, { courtesyCar });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'facilities.courtesyCar.pricePerDayBani',
    ]);
    await nothingWritten(w, before);
  });

  it.each([
    [
      'terms without the car',
      { courtesyCar: { paid: false }, facilities: ['waiting_area'] },
    ],
    ['the car without terms', { courtesyCar: undefined }],
  ])(
    'answers 400 no_courtesy_car to %s, and writes nothing',
    async (_, group) => {
      const w = await listing();
      const before = await stored(w.nord.id);

      const res = await saveGroup(w, group);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'no_courtesy_car', field: 'courtesyCar' }],
      });
      await nothingWritten(w, before);
      expect(await facilityHistory(w.nord.id)).toEqual([]);
    },
  );
});

// @traces 1248-FR-002
// @traces 1248-FR-006
// @traces 1248-FR-008
describe('PATCH /garages/:garageId/profile: the payment methods', () => {
  it.each([
    ['card', { card: true, cash: true, transfer: false }],
    ['transfer', { card: false, cash: true, transfer: true }],
  ])('ticks %s with one entry', async (method, paymentMethods) => {
    const w = await listing();

    const res = await saveGroup(w, { paymentMethods });

    expect(res.status).toBe(200);
    expect(res.body.paymentMethods).toEqual(paymentMethods);
    expect(await changes(w.nord.id)).toEqual([
      [`payment_${method}`, false, true],
    ]);
  });

  it('swaps cash for card with one entry each', async () => {
    const w = await listing();

    await saveGroup(w, {
      paymentMethods: { card: true, cash: false, transfer: false },
    }).expect(200);

    expect(await changes(w.nord.id)).toEqual([
      ['payment_card', false, true],
      ['payment_cash', true, false],
    ]);
  });

  it('answers 400 when no method is ticked, and writes nothing', async () => {
    const w = await listing();
    const before = await stored(w.nord.id);

    const res = await saveGroup(w, {
      paymentMethods: { card: false, cash: false, transfer: false },
    });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'facilities.paymentMethods',
    ]);
    await nothingWritten(w, before);
  });
});

// @traces 1248-FR-001
// @traces 1248-FR-002
// @traces 1248-FR-006
describe('PATCH /garages/:garageId/profile: the facilities note', () => {
  it('stores the note trimmed with one facilitiesNote entry', async () => {
    const w = await listing();

    await saveGroup(w, { facilitiesNote: '  Cafea, Wi-Fi și ziare ' }).expect(
      200,
    );

    expect((await terms(w.nord.id)).facilitiesNote).toBe(
      'Cafea, Wi-Fi și ziare',
    );
    expect(await changes(w.nord.id)).toEqual([
      ['facilitiesNote', 'Cafea și Wi-Fi', 'Cafea, Wi-Fi și ziare'],
    ]);
    expect((await fieldsOf(w.nord.id)).payload).toEqual({
      fields: ['facilities_note'],
      garageId: w.nord.id,
    });
  });

  it.each([[''], ['   '], [undefined]])(
    'clears the note sent as %p',
    async (facilitiesNote) => {
      const w = await listing();

      await saveGroup(w, { facilitiesNote }).expect(200);

      expect((await terms(w.nord.id)).facilitiesNote).toBeNull();
    },
  );

  it('takes a note of 200 characters', async () => {
    const w = await listing();
    const note = 'ș'.repeat(200);

    const res = await saveGroup(w, { facilitiesNote: note });

    expect(res.status).toBe(200);
    expect(res.body.facilitiesNote).toBe(note);
  });

  it.each([
    ['201 characters', 'ș'.repeat(201)],
    ['a line break', 'Cafea\nWi-Fi'],
  ])('answers 400 to a note of %s naming it', async (_, facilitiesNote) => {
    const w = await listing();
    const before = await stored(w.nord.id);

    const res = await saveGroup(w, { facilitiesNote });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'facilities.facilitiesNote',
    ]);
    await nothingWritten(w, before);
  });
});

// @traces 1248-FR-006
// @traces 1248-FR-007
// @traces 1248-FR-015
describe('PATCH /garages/:garageId/profile: the facilities group, refused or unchanged', () => {
  it('answers 403 to the receptionist and writes nothing', async () => {
    const w = await listing();
    const before = await stored(w.nord.id);

    const res = await patch(
      w,
      { facilities: facilitiesGroup(), version: '0' },
      w.receptionist,
    );

    expect(res.status).toBe(403);
    await nothingWritten(w, before);
  });

  it("answers 404 to another garage's owner", async () => {
    const w = await listing();

    const res = await patch(
      w,
      { facilities: facilitiesGroup(), version: '0' },
      w.other,
    );

    expect(res.status).toBe(404);
  });

  it('answers 410 for a suspended garage', async () => {
    const w = await listing({ status: 'suspended' });

    const res = await saveGroup(w);

    expect(res.status).toBe(410);
  });

  it('answers the second of two saves at one stamp 409 and writes nothing of it', async () => {
    const w = await listing();
    await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
    }).expect(200);
    await checkpoint();
    const before = await stored(w.nord.id);

    const res = await saveGroup(w, {
      courtesyCar: undefined,
      facilities: ['waiting_area'],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('profile_changed');
    await nothingWritten(w, before);
    expect(await facilityHistory(w.nord.id)).toEqual([]);
    expect(await facilities(w.nord.id)).toContain('pickup_dropoff');
  });

  it('writes nothing and keeps the stamp when the group is unchanged', async () => {
    const w = await listing();
    const before = await stored(w.nord.id);

    const res = await saveGroup(w, {
      facilities: ['waiting_area', 'courtesy_car'],
      facilitiesNote: ' Cafea și Wi-Fi ',
    });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('0');
    await nothingWritten(w, before);
    expect(await facilityHistory(w.nord.id)).toEqual([]);
  });

  it('leaves no row, entry or event when a write of the save fails', async () => {
    const w = await listing();
    const before = await stored(w.nord.id);
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));

    const res = await saveGroup(w, {
      facilities: ['courtesy_car', 'pickup_dropoff'],
      paymentMethods: { card: true, cash: true, transfer: false },
    });

    expect(res.status).toBe(500);
    await nothingWritten(w, before);
    expect(await facilities(w.nord.id)).toEqual([
      'courtesy_car',
      'waiting_area',
    ]);
    expect((await terms(w.nord.id)).paymentCard).toBe(false);
  });
});
