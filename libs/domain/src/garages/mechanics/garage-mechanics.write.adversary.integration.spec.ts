import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
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
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  brevo.reset();
  mark = await outboxMark(prisma);
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const http = () => request(app.getHttpServer());
const add = (garageId: string, body: unknown, auth: string) =>
  http()
    .post(`/garages/${garageId}/mechanics`)
    .set('Authorization', auth)
    .send(body as object);
const edit = (garageId: string, id: string, body: unknown, auth: string) =>
  http()
    .patch(`/garages/${garageId}/mechanics/${id}`)
    .set('Authorization', auth)
    .send(body as object);
const remove = (garageId: string, id: string, auth: string) =>
  http()
    .delete(`/garages/${garageId}/mechanics/${id}`)
    .set('Authorization', auth);

async function world() {
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage', 'mechanic']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  const ownerCard = await prisma.mechanic.create({
    data: {
      accountId: mihai,
      garageId: dinamo.id,
      isOwner: true,
      name: 'Mihai Pop',
    },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  return { auth: bearer(mihai, 'garage'), dinamo, mihai, nord, ownerCard };
}

const card = (garageId: string, name: string, extra: object = {}) =>
  prisma.mechanic.create({ data: { garageId, name, ...extra } });

async function dacia(garageId: string, stance: 'works_on' = 'works_on') {
  const tag = randomUUID().slice(0, 8);
  const brand = await prisma.brand.create({
    data: { key: `d-${tag}`, name: `Dacia ${tag}`, slug: `d-${tag}` },
  });
  await prisma.garageBrand.create({
    data: { brandId: brand.id, garageId, stance },
  });
  return brand;
}

const rows = (garageId: string) =>
  prisma.mechanic.findMany({ orderBy: { id: 'asc' }, where: { garageId } });
const audit = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { subjectId, subjectType: 'mechanic' },
  });
const events = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });

describe('ids and bodies the routes were not written for', () => {
  it.each([
    [
      'PATCH',
      (g: string, a: string) => edit(g, 'not-a-uuid', { name: 'Elena' }, a),
    ],
    ['DELETE', (g: string, a: string) => remove(g, 'not-a-uuid', a)],
  ])(
    'answers a %s for a card id that is no uuid with a client error, never 500',
    async (_m, call) => {
      const { auth, dinamo } = await world();

      const res = await call(dinamo.id, auth);

      expect([400, 404]).toContain(res.status);
    },
  );

  it('answers a POST to a garage id that is no uuid with 400', async () => {
    const { auth } = await world();

    const res = await add('not-a-uuid', { name: 'Elena Stan' }, auth);

    expect(res.status).toBe(400);
  });

  it.each([
    { isOwner: true },
    { accountId: randomUUID() },
    { onProfile: true },
    { removedAt: '2020-01-01T00:00:00Z' },
    { rating: 5 },
    { Bio: 'x' },
  ])('refuses an add that slips in %j, creating no card', async (extra) => {
    const { auth, dinamo } = await world();
    const before = await rows(dinamo.id);

    const res = await add(dinamo.id, { name: 'Elena Stan', ...extra }, auth);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await rows(dinamo.id)).toEqual(before);
  });

  it('keeps the owner mark off a card when an edit asks for it', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');

    const res = await edit(dinamo.id, elena.id, { isOwner: true }, auth);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(
      (await prisma.mechanic.findUniqueOrThrow({ where: { id: elena.id } }))
        .isOwner,
    ).toBe(false);
  });

  it.each([
    ['an array', [{ name: 'Elena Stan' }]],
    ['null', null],
    ['a string', 'Elena Stan'],
  ])('refuses %s as a body with a client error', async (_what, body) => {
    const { auth, dinamo } = await world();
    const before = await rows(dinamo.id);

    const res = await add(dinamo.id, body, auth);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await rows(dinamo.id)).toEqual(before);
  });

  it.each([
    { name: 12345 },
    { name: ['Elena', 'Stan'] },
    { name: { first: 'Elena' } },
    { name: 'Elena Stan', specialties: 'Frâne, Suspensie' },
    { name: 'Elena Stan', specialties: [null] },
    { name: 'Elena Stan', specialties: [12] },
    { certifications: 'Bosch', name: 'Elena Stan' },
    { name: 'Elena Stan', roleTitle: 7 },
    { name: 'Elena Stan', years: '12' },
    { name: 'Elena Stan', years: true },
    { name: 'Elena Stan', years: 1e21 },
    { brandIds: 'x', name: 'Elena Stan' },
    { brandIds: ['not-a-uuid'], name: 'Elena Stan' },
    { brandIds: [null], name: 'Elena Stan' },
  ])(
    'refuses the wrong type in %j with a client error and writes nothing',
    async (body) => {
      const { auth, dinamo } = await world();
      const before = await rows(dinamo.id);

      const res = await add(dinamo.id, body, auth);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await rows(dinamo.id)).toEqual(before);
    },
  );

  it.each([
    { name: 'Elena\u0000Stan' },
    { name: 'Elena Stan', roleTitle: 'Șef\u0000' },
    { name: 'Elena Stan', specialties: ['Frâne\u0000'] },
    { certifications: ['Bosch\u0000'], name: 'Elena Stan' },
  ])(
    'never answers 500 for a NUL character in %j, and stores none',
    async (body) => {
      const { auth, dinamo } = await world();

      const res = await add(dinamo.id, body, auth);

      expect([201, 400, 422]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain('\\u0000');
      const stored = await rows(dinamo.id);
      expect(JSON.stringify(stored)).not.toContain('\\u0000');
    },
  );

  it('refuses a tag of spaces only and a tag over its length once trimmed', async () => {
    const { auth, dinamo } = await world();

    const blank = await add(
      dinamo.id,
      { name: 'Elena Stan', specialties: ['Frâne', '   '] },
      auth,
    );
    const padded = await add(
      dinamo.id,
      { name: 'Elena Stan', specialties: [` ${'a'.repeat(40)} `] },
      auth,
    );
    const over = await add(
      dinamo.id,
      { name: 'Elena Stan', specialties: [` ${'a'.repeat(41)} `] },
      auth,
    );

    expect([blank.status, blank.body.code]).toEqual([422, 'validation_failed']);
    expect(padded.status).toBe(201);
    expect(padded.body.specialties).toEqual(['a'.repeat(40)]);
    expect([over.status, over.body.code]).toEqual([422, 'validation_failed']);
  });

  it('counts characters, not UTF-16 units: forty emoji make a tag at the limit', async () => {
    const { auth, dinamo } = await world();

    const atLimit = await add(
      dinamo.id,
      { name: 'Elena Stan', specialties: ['🔧'.repeat(40)] },
      auth,
    );
    const past = await add(
      dinamo.id,
      { name: 'Elena Stan', specialties: ['🔧'.repeat(41)] },
      auth,
    );

    expect(atLimit.status).toBe(201);
    expect(past.status).toBe(422);
  });

  it('refuses ten thousand specialties with one too_many error, fast', async () => {
    const { auth, dinamo } = await world();
    const started = Date.now();

    const res = await add(
      dinamo.id,
      {
        name: 'Elena Stan',
        specialties: Array.from({ length: 10_000 }, () => 'x'),
      },
      auth,
    );

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { code: 'too_many', field: 'specialties' },
    ]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports every field at fault in one answer', async () => {
    const { auth, dinamo } = await world();

    const res = await add(
      dinamo.id,
      { name: 'E', roleTitle: 'a'.repeat(41), years: 61 },
      auth,
    );

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { code: 'too_short', field: 'name' },
        { code: 'too_long', field: 'roleTitle' },
        { code: 'out_of_range', field: 'years' },
      ]),
    );
  });
});

describe('the order of the checks', () => {
  it('answers 404 not_found, not 403, for a mechanic-owned field on a card that does not exist', async () => {
    const { auth, dinamo } = await world();

    const res = await edit(dinamo.id, randomUUID(), { bio: 'x' }, auth);

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('answers 404 feature_off, not 403, for a mechanic-owned field with the team off', async () => {
    const { auth, dinamo } = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: dinamo.id, key: 'team_mechanics' },
    });

    const res = await add(dinamo.id, { bio: 'x', name: 'Elena Stan' }, auth);

    expect([res.status, res.body.code]).toEqual([404, 'feature_off']);
  });

  it('answers the owner row 404 feature_off on remove with the team off, not 409', async () => {
    const { auth, dinamo, ownerCard } = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: dinamo.id, key: 'team_mechanics' },
    });

    const res = await remove(dinamo.id, ownerCard.id, auth);

    expect([res.status, res.body.code]).toEqual([404, 'feature_off']);
  });

  it("answers 404 not_found for the owner of another garage on that garage's owner row", async () => {
    const { dinamo, nord, ownerCard } = await world();
    const radu = (
      await prisma.garageMember.findFirstOrThrow({
        where: { garageId: nord.id },
      })
    ).accountId;

    const res = await remove(dinamo.id, ownerCard.id, bearer(radu, 'garage'));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });
});

describe('removing twice, and at once', () => {
  it('removes once: the second call is 404 and adds no entry, event or notice', async () => {
    const { auth, dinamo } = await world();
    const vlad = await account('vlad', ['mechanic']);
    const vladCard = await card(dinamo.id, 'Tudor Vlad', { accountId: vlad });

    const first = await remove(dinamo.id, vladCard.id, auth);
    const second = await remove(dinamo.id, vladCard.id, auth);

    expect(first.status).toBe(204);
    expect([second.status, second.body.code]).toEqual([404, 'not_found']);
    expect(await audit(vladCard.id)).toHaveLength(1);
    expect(await events('mechanic.removed')).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: { accountId: vlad, channel: 'email', kind: 'STAFF_REMOVED' },
      }),
    ).toBe(1);
  });

  it('removes once when two removals arrive together', async () => {
    const { auth, dinamo } = await world();
    const vlad = await account('vlad', ['mechanic']);
    const vladCard = await card(dinamo.id, 'Tudor Vlad', { accountId: vlad });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => remove(dinamo.id, vladCard.id, auth)),
    );

    expect(results.map((r) => r.status).sort()).toEqual([
      204,
      ...Array(7).fill(404),
    ]);
    expect(await audit(vladCard.id)).toHaveLength(1);
    expect(await events('mechanic.removed')).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: { accountId: vlad, channel: 'email', kind: 'STAFF_REMOVED' },
      }),
    ).toBe(1);
  });

  it('never edits a card back to life: a patch after the removal is 404 and the card stays removed', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');
    await remove(dinamo.id, elena.id, auth);

    const res = await edit(dinamo.id, elena.id, { name: 'Elena Nouă' }, auth);

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: elena.id },
    });
    expect([row.name, row.removedAt === null]).toEqual(['Elena Stan', false]);
  });

  it('answers an edit racing a removal with 200 or 404 and leaves one consistent card', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');

    const [patched, removed] = await Promise.all([
      edit(dinamo.id, elena.id, { years: 5 }, auth),
      remove(dinamo.id, elena.id, auth),
    ]);

    expect(removed.status).toBe(204);
    expect([200, 404]).toContain(patched.status);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: elena.id },
    });
    expect(row.removedAt).not.toBeNull();
  });

  it('lets the same person be added again by name after a removal, as a new card', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');
    await remove(dinamo.id, elena.id, auth);

    const again = await add(dinamo.id, { name: 'Elena Stan' }, auth);

    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(elena.id);
  });
});

describe('editing to values that look like no change, or like a lot of change', () => {
  it('writes no entry and no event when a name comes back padded with spaces', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');

    const res = await edit(
      dinamo.id,
      elena.id,
      { name: '  Elena Stan  ' },
      auth,
    );

    expect(res.status).toBe(200);
    expect(await audit(elena.id)).toEqual([]);
    expect(await events('mechanic.updated')).toEqual([]);
  });

  it('records 12 to 0 for years, and keeps 0 as 0 rather than clearing it', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan', { years: 12 });

    const res = await edit(dinamo.id, elena.id, { years: 0 }, auth);

    expect([res.status, res.body.years]).toEqual([200, 0]);
    const written = await audit(elena.id);
    expect(
      written.map(({ field, oldValue, newValue }) => ({
        field,
        newValue,
        oldValue,
      })),
    ).toEqual([{ field: 'years', newValue: 0, oldValue: 12 }]);
  });

  it('records a reordered specialties list as a change, not a no-op', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan', {
      speciality: 'Frâne, Suspensie',
      specialties: ['Frâne', 'Suspensie'],
    });

    const res = await edit(
      dinamo.id,
      elena.id,
      { specialties: ['Suspensie', 'Frâne'] },
      auth,
    );

    expect(res.body.speciality).toBe('Suspensie, Frâne');
    expect((await audit(elena.id)).map((e) => e.field)).toEqual([
      'specialties',
    ]);
  });

  it('writes no entry for clearing what is already empty', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan');

    const res = await edit(
      dinamo.id,
      elena.id,
      {
        brandIds: [],
        certifications: [],
        roleTitle: null,
        specialties: [],
        years: null,
      },
      auth,
    );

    expect(res.status).toBe(200);
    expect(await audit(elena.id)).toEqual([]);
    expect(await events('mechanic.updated')).toEqual([]);
  });

  it('clears the speciality line to null, not an empty string, when the specialties are emptied', async () => {
    const { auth, dinamo } = await world();
    const elena = await card(dinamo.id, 'Elena Stan', {
      speciality: 'Frâne',
      specialties: ['Frâne'],
    });

    const res = await edit(dinamo.id, elena.id, { specialties: [] }, auth);

    expect(res.body.speciality).toBeNull();
    expect(
      (await prisma.mechanic.findUniqueOrThrow({ where: { id: elena.id } }))
        .speciality,
    ).toBeNull();
  });

  it('keeps the owner row owner, linked and permitted after an edit of every field', async () => {
    const { auth, dinamo, mihai, ownerCard } = await world();

    const res = await edit(
      dinamo.id,
      ownerCard.id,
      { name: 'Mihai P.', roleTitle: 'Patron', years: 30 },
      auth,
    );

    expect([res.status, res.body.isOwner, res.body.hasAccount]).toEqual([
      200,
      true,
      true,
    ]);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: ownerCard.id },
    });
    expect([row.accountId, row.isOwner, row.removedAt]).toEqual([
      mihai,
      true,
      null,
    ]);
  });
});

describe('brands', () => {
  it("refuses another garage's brand and an upper-cased duplicate id", async () => {
    const { auth, dinamo, nord } = await world();
    const mine = await dacia(dinamo.id);
    const theirs = await dacia(nord.id);

    const foreign = await add(
      dinamo.id,
      { brandIds: [theirs.id], name: 'Elena Stan' },
      auth,
    );
    const twice = await add(
      dinamo.id,
      { brandIds: [mine.id, mine.id.toUpperCase()], name: 'Elena Stan' },
      auth,
    );

    expect(foreign.body.errors).toContainEqual({
      code: 'not_taken',
      field: 'brandIds',
    });
    expect(twice.status).toBe(422);
  });

  it('keeps a brand the garage stopped taking when an edit leaves brandIds out, and refuses it when sent again', async () => {
    const { auth, dinamo } = await world();
    const brand = await dacia(dinamo.id);
    const elena = await card(dinamo.id, 'Elena Stan');
    await prisma.$executeRaw`UPDATE mechanic SET brand_ids = ARRAY[${brand.id}]::uuid[] WHERE id = ${elena.id}::uuid`;
    await prisma.garageBrand.deleteMany({ where: { garageId: dinamo.id } });

    const renamed = await edit(dinamo.id, elena.id, { name: 'Elena S.' }, auth);
    const resent = await edit(
      dinamo.id,
      elena.id,
      { brandIds: [brand.id] },
      auth,
    );
    const dropped = await edit(dinamo.id, elena.id, { brandIds: [] }, auth);

    expect([renamed.status, renamed.body.brandIds]).toEqual([200, [brand.id]]);
    expect(resent.status).toBe(422);
    expect([dropped.status, dropped.body.brandIds]).toEqual([200, []]);
  });
});

describe('the removal reaches the right invites and the right account', () => {
  it('revokes an invite only for the card it removes, not for a second garage the account also staffs', async () => {
    const { auth, dinamo, nord } = await world();
    const vlad = await account('vlad', ['mechanic']);
    const vladCard = await card(dinamo.id, 'Tudor Vlad', { accountId: vlad });
    const email = (
      await prisma.account.findUniqueOrThrow({ where: { id: vlad } })
    ).email;
    const make = (garageId: string, status: 'sent' | 'accepted' | 'revoked') =>
      prisma.staffInvite.create({
        data: {
          email: (email ?? '').toLowerCase(),
          expiresAt: new Date(Date.now() + 86_400_000),
          garageId,
          kind: 'mechanic',
          name: 'Tudor Vlad',
          status,
          tokenHash: randomUUID(),
        },
      });
    const open = await make(dinamo.id, 'sent');
    const accepted = await make(dinamo.id, 'accepted');
    const elsewhere = await make(nord.id, 'sent');

    await remove(dinamo.id, vladCard.id, auth);

    const status = async (id: string) =>
      (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status;
    expect([
      await status(open.id),
      await status(accepted.id),
      await status(elsewhere.id),
    ]).toEqual(['revoked', 'accepted', 'sent']);
  });
});
