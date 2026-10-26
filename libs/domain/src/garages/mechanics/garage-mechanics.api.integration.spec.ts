import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
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
import { quotesWorld } from '../../quotes/quotes.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const HOUR = 3_600_000;
const { account, prisma, reset } = fixtures();
const bookings = quotesWorld(prisma);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
// The outbox is never emptied: each test reads the rows above its mark.
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    {
      databaseUrl,
      email,
      push: {
        privateKey: 'private',
        publicKey: 'public',
        subject: 'mailto:ops@example.test',
      },
      redisUrl,
    },
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

afterEach(() => jest.restoreAllMocks());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const http = () => request(app.getHttpServer());
const signed = (call: request.Test, auth?: string) =>
  auth ? call.set('Authorization', auth) : call;
const team = (garageId: string, auth?: string) =>
  signed(http().get(`/garages/${garageId}/mechanics`), auth);
const add = (garageId: string, body: object, auth?: string) =>
  signed(http().post(`/garages/${garageId}/mechanics`), auth).send(body);
const edit = (
  garageId: string,
  mechanicId: string,
  body: object,
  auth?: string,
) =>
  signed(
    http().patch(`/garages/${garageId}/mechanics/${mechanicId}`),
    auth,
  ).send(body);
const remove = (garageId: string, mechanicId: string, auth?: string) =>
  signed(http().delete(`/garages/${garageId}/mechanics/${mechanicId}`), auth);

// Atelier Dinamo: its owner Mihai (who has a card of his own), a receptionist,
// a mechanic with an account, and cards with none; Atelier Nord with its owner.
// `ownerRow` marks Mihai's card as the owner's row garage creation writes.
async function world({ ownerRow = false } = {}) {
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
  const mihaiCard = await prisma.mechanic.create({
    data: { accountId: mihai, garageId: dinamo.id, name: 'Mihai Pop' },
  });
  if (ownerRow) {
    await prisma.$executeRaw`UPDATE mechanic SET is_owner = true WHERE id = ${mihaiCard.id}::uuid`;
  }
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic'], { language: 'en' });
  const vladCard = await prisma.mechanic.create({
    data: {
      accountId: vlad,
      garageId: dinamo.id,
      name: 'Tudor Vlad',
      onProfile: true,
      rating: 4.9,
      reviewCount: 58,
      speciality: 'Frâne, suspensie',
    },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  return { dinamo, ioana, mihai, mihaiCard, nord, radu, vlad, vladCard };
}

const card = (garageId: string, name: string, extra: object = {}) =>
  prisma.mechanic.create({ data: { garageId, name, ...extra } });

const switchOff = (garageId: string) =>
  prisma.garageFeature.create({
    data: { enabled: false, garageId, key: 'team_mechanics' },
  });

// The card fields the dialog edits, written straight to the row.
const fill = (mechanicId: string, brandIds: string[] = []) =>
  prisma.$executeRaw`
    UPDATE mechanic SET
      role_title = 'Mecanic șef',
      specialties = ARRAY['Frâne', 'Suspensie'],
      certifications = ARRAY['Bosch Service'],
      years = 12,
      brand_ids = ${`{${brandIds.join(',')}}`}::uuid[],
      speciality = 'Frâne, Suspensie'
    WHERE id = ${mechanicId}::uuid`;

// Brand names are unique and the brand table outlives each test's reset.
async function brands(garageId: string) {
  const tag = randomUUID().slice(0, 8);
  const brand = (key: string, name: string) =>
    prisma.brand.create({
      data: {
        key: `${key}-${tag}`,
        name: `${name} ${tag}`,
        slug: `${key}-${tag}`,
      },
    });
  const skoda = await brand('skoda', 'Škoda');
  const audi = await brand('audi', 'Audi');
  const dacia = await brand('dacia', 'Dacia');
  const bmw = await brand('bmw', 'BMW');
  await prisma.garageBrand.createMany({
    data: [
      ...[skoda, audi, dacia].map(({ id }) => ({
        brandId: id,
        garageId,
        stance: 'works_on' as const,
      })),
      // A brand the garage refuses carries no fuel (garage_brand_fuel_check).
      {
        brandId: bmw.id,
        diesel: false,
        electric: false,
        garageId,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take' as const,
      },
    ],
  });
  return { audi, bmw, dacia, skoda };
}

const inHours = (hours: number) =>
  new Date(Date.now() + hours * HOUR).toISOString();

const outbox = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });
const entries = (mechanicId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { subjectId: mechanicId, subjectType: 'mechanic' },
  });

// Everything a refused write must leave as it was.
async function writesOf(garageId: string) {
  const [cards, audit, events] = await Promise.all([
    prisma.mechanic.findMany({ orderBy: { id: 'asc' }, where: { garageId } }),
    prisma.activityLog.count({ where: { garageId, subjectType: 'mechanic' } }),
    prisma.outboxEvent.count({
      where: { id: { gt: mark }, kind: { startsWith: 'mechanic.' } },
    }),
  ]);
  return { audit, cards, events };
}

const invite = (
  garageId: string,
  email: string,
  kind: 'mechanic' | 'receptionist' = 'mechanic',
) =>
  prisma.staffInvite.create({
    data: {
      email,
      expiresAt: new Date(Date.now() + 24 * HOUR),
      garageId,
      kind,
      name: 'Tudor Vlad',
      tokenHash: randomUUID(),
    },
  });

const inviteStatus = async (id: string) =>
  (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status;

// Every insert into `table` for which `when` holds fails until the undo runs,
// as a write lost inside the transaction would.
async function refuseInserts(
  table: 'notification' | 'outbox_event',
  when: string,
) {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION refuse_mechanic_write() RETURNS trigger AS $$
     BEGIN
       IF ${when} THEN RAISE EXCEPTION 'refused'; END IF;
       RETURN NEW;
     END $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER refuse_mechanic_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse_mechanic_write()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS refuse_mechanic_write ON ${table}`,
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS refuse_mechanic_write()',
    );
  };
}

const quiet = () => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
};

// A list item as a card holding nothing but its name has it.
const blank = {
  brandIds: [],
  certifications: [],
  futureBookings: 0,
  hasAccount: false,
  isOwner: false,
  onProfile: false,
  rating: null,
  reviewCount: 0,
  roleTitle: null,
  speciality: null,
  specialties: [],
  years: null,
};

// @traces 056-FR-011 055-FR-001 055-FR-016
describe("reading the garage's team", () => {
  it("answers the owner's row first, then each current card by Romanian order, without a removed one", async () => {
    const { dinamo, mihai, mihaiCard, vladCard } = await world({
      ownerRow: true,
    });
    const andrei = await card(dinamo.id, 'Andrei Zaharia');
    const stefan = await card(dinamo.id, 'Ștefan Ilie');
    const stan = await card(dinamo.id, 'stan Ion', { onProfile: true });
    await card(dinamo.id, 'Andrei Gone', { removedAt: new Date() });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brands: [],
      items: [
        {
          ...blank,
          hasAccount: true,
          id: mihaiCard.id,
          isOwner: true,
          name: 'Mihai Pop',
        },
        { ...blank, id: andrei.id, name: 'Andrei Zaharia' },
        { ...blank, id: stan.id, name: 'stan Ion', onProfile: true },
        { ...blank, id: stefan.id, name: 'Ștefan Ilie' },
        {
          ...blank,
          hasAccount: true,
          id: vladCard.id,
          name: 'Tudor Vlad',
          onProfile: true,
          rating: '4.9',
          reviewCount: 58,
          speciality: 'Frâne, suspensie',
        },
      ],
    });
  });

  it('answers an empty list for a garage with no card', async () => {
    const { nord, radu } = await world({ ownerRow: true });

    const res = await team(nord.id, bearer(radu, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brands: [], items: [] });
  });

  // @traces 055-FR-004
  it('leaves out a card that moved to another garage and one whose account was deleted', async () => {
    const { dinamo, mihai, nord, vlad } = await world({ ownerRow: true });
    await prisma.mechanic.update({
      data: { garageId: nord.id },
      where: { accountId: vlad },
    });
    await card(dinamo.id, 'Elena Pop', {
      onProfile: false,
      removedAt: new Date(),
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body.items.map((item: { name: string }) => item.name)).toEqual([
      'Mihai Pop',
    ]);
  });

  it("answers each card's role, tags, years and brands", async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });
    const { dacia } = await brands(dinamo.id);
    await fill(vladCard.id, [dacia.id]);

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body.items[1]).toMatchObject({
      brandIds: [dacia.id],
      certifications: ['Bosch Service'],
      id: vladCard.id,
      isOwner: false,
      roleTitle: 'Mecanic șef',
      speciality: 'Frâne, Suspensie',
      specialties: ['Frâne', 'Suspensie'],
      years: 12,
    });
  });

  it("counts each card's confirmed bookings that start after now, and no other", async () => {
    const { dinamo, mihai, mihaiCard, vladCard } = await world({
      ownerRow: true,
    });
    const rows = [
      [inHours(24), 'confirmed', vladCard.id],
      [inHours(72), 'confirmed', vladCard.id],
      [inHours(-24), 'confirmed', vladCard.id],
      [inHours(48), 'cancelled', vladCard.id],
      [inHours(48), 'awaiting_confirmation', vladCard.id],
      [inHours(24), 'confirmed', mihaiCard.id],
    ] as const;
    for (const [startsAt, status, mechanicId] of rows) {
      await bookings.booked(dinamo.id, startsAt, status, { mechanicId });
    }

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(
      res.body.items.map(
        ({ futureBookings, id }: { futureBookings: number; id: string }) => ({
          futureBookings,
          id,
        }),
      ),
    ).toEqual([
      { futureBookings: 1, id: mihaiCard.id },
      { futureBookings: 2, id: vladCard.id },
    ]);
  });

  it('answers the brands the garage works on, A to Z, and none it refuses or another garage takes', async () => {
    const { dinamo, mihai, nord } = await world({ ownerRow: true });
    const { audi, dacia, skoda } = await brands(dinamo.id);
    await brands(nord.id);

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body.brands).toEqual(
      [audi, dacia, skoda].map(({ id, name }) => ({ id, name })),
    );
  });
});

// @traces 055-FR-002 055-FR-003 055-FR-016
describe('who reads the team', () => {
  it('answers the garage staff 403 forbidden', async () => {
    const { dinamo, ioana, vlad } = await world();

    for (const auth of [
      bearer(ioana, 'receptionist'),
      bearer(vlad, 'mechanic'),
    ]) {
      const res = await team(dinamo.id, auth);
      expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
    }
  });

  it("answers a driver, an admin and another garage's owner 404 not_found", async () => {
    const { dinamo, radu } = await world();
    const driver = await account('andrei', ['driver']);
    const admin = await account('admin', ['admin']);

    for (const auth of [
      bearer(driver, 'driver'),
      bearer(admin, 'admin'),
      bearer(radu, 'garage'),
    ]) {
      const res = await team(dinamo.id, auth);
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
  });

  it('answers 401 without a session', async () => {
    const { dinamo } = await world();

    expect((await team(dinamo.id)).status).toBe(401);
  });

  it('answers 400 to a garage id that is not a uuid', async () => {
    const { mihai } = await world();

    const res = await team('dinamo', bearer(mihai, 'garage'));

    expect(res.status).toBe(400);
  });

  // @traces 102-FR-003
  it('answers the owner 404 feature_off with the team switched off, after the access check', async () => {
    const { dinamo, ioana, mihai, radu, vlad } = await world();
    await switchOff(dinamo.id);

    const owner = await team(dinamo.id, bearer(mihai, 'garage'));
    const staff = await team(dinamo.id, bearer(ioana, 'receptionist'));
    const mechanic = await team(dinamo.id, bearer(vlad, 'mechanic'));
    const other = await team(dinamo.id, bearer(radu, 'garage'));

    expect([owner.status, owner.body.code]).toEqual([404, 'feature_off']);
    expect([staff.status, staff.body.code]).toEqual([403, 'forbidden']);
    expect([mechanic.status, mechanic.body.code]).toEqual([403, 'forbidden']);
    expect([other.status, other.body.code]).toEqual([404, 'not_found']);
  });

  // @traces 056-FR-011
  it('answers the list again once the team is switched back on', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    await switchOff(dinamo.id);
    await prisma.garageFeature.update({
      data: { enabled: true },
      where: { garageId_key: { garageId: dinamo.id, key: 'team_mechanics' } },
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });
});

// @traces 056-FR-003
describe('who adds, edits and removes a card', () => {
  // The add, then the edit and the removal of the card given.
  const writes = (garageId: string, mechanicId: string) =>
    [
      (auth?: string) => add(garageId, { name: 'Elena Stan' }, auth),
      (auth?: string) =>
        edit(garageId, mechanicId, { name: 'Elena Stanciu' }, auth),
      (auth?: string) => remove(garageId, mechanicId, auth),
    ] as const;

  // @traces 056-FR-002 056-FR-006
  it('lets the owner add, edit and remove', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    const [post, patch, del] = writes(dinamo.id, elena.id);
    const auth = bearer(mihai, 'garage');

    expect((await post(auth)).status).toBe(201);
    expect((await patch(auth)).status).toBe(200);
    expect((await del(auth)).status).toBe(204);
  });

  it('answers the garage staff 403 forbidden, writing nothing', async () => {
    const { dinamo, ioana, vlad } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    const before = await writesOf(dinamo.id);

    for (const write of writes(dinamo.id, elena.id)) {
      for (const auth of [
        bearer(ioana, 'receptionist'),
        bearer(vlad, 'mechanic'),
      ]) {
        const res = await write(auth);
        expect([res.status, res.body.code]).toEqual([403, 'forbidden']);
      }
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it("answers a driver, an admin and another garage's owner 404 not_found, writing nothing", async () => {
    const { dinamo, radu } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    const driver = await account('andrei', ['driver']);
    const admin = await account('admin', ['admin']);
    const before = await writesOf(dinamo.id);

    for (const write of writes(dinamo.id, elena.id)) {
      for (const auth of [
        bearer(driver, 'driver'),
        bearer(admin, 'admin'),
        bearer(radu, 'garage'),
      ]) {
        const res = await write(auth);
        expect([res.status, res.body.code]).toEqual([404, 'not_found']);
      }
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('answers 401 without a session', async () => {
    const { dinamo } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');

    for (const write of writes(dinamo.id, elena.id)) {
      expect((await write()).status).toBe(401);
    }
  });

  it('answers the owner 404 feature_off with the team switched off, after the access check', async () => {
    const { dinamo, ioana, mihai, radu } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    await switchOff(dinamo.id);
    const before = await writesOf(dinamo.id);

    for (const write of writes(dinamo.id, elena.id)) {
      const owner = await write(bearer(mihai, 'garage'));
      const staff = await write(bearer(ioana, 'receptionist'));
      const other = await write(bearer(radu, 'garage'));
      expect([owner.status, owner.body.code]).toEqual([404, 'feature_off']);
      expect([staff.status, staff.body.code]).toEqual([403, 'forbidden']);
      expect([other.status, other.body.code]).toEqual([404, 'not_found']);
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it("answers 404 not_found for an unknown card, a removed one and another garage's", async () => {
    const { dinamo, mihai, nord } = await world({ ownerRow: true });
    const gone = await card(dinamo.id, 'Elena Pop', { removedAt: new Date() });
    const foreign = await card(nord.id, 'Sorin Nord');
    const before = await writesOf(dinamo.id);
    const auth = bearer(mihai, 'garage');

    for (const id of [randomUUID(), gone.id, foreign.id]) {
      const patched = await edit(dinamo.id, id, { name: 'Elena Stan' }, auth);
      const removed = await remove(dinamo.id, id, auth);
      expect([patched.status, patched.body.code]).toEqual([404, 'not_found']);
      expect([removed.status, removed.body.code]).toEqual([404, 'not_found']);
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: foreign.id } }),
    ).toMatchObject({ name: 'Sorin Nord', removedAt: null });
  });
});

// @traces 056-FR-004
describe('the fields a mechanic fills in', () => {
  it.each(['photo', 'bio', 'languages'])(
    'refuses %s on an add and an edit with 403 mechanic_owned_field, writing nothing',
    async (field) => {
      const { dinamo, mihai } = await world({ ownerRow: true });
      const elena = await card(dinamo.id, 'Elena Pop');
      const before = await writesOf(dinamo.id);
      const auth = bearer(mihai, 'garage');

      for (const value of ['Mecanic din 2010', null, [], {}]) {
        const body = { name: 'Elena Stan', [field]: value };
        const added = await add(dinamo.id, body, auth);
        const edited = await edit(dinamo.id, elena.id, body, auth);
        expect([added.status, added.body.code]).toEqual([
          403,
          'mechanic_owned_field',
        ]);
        expect([edited.status, edited.body.code]).toEqual([
          403,
          'mechanic_owned_field',
        ]);
      }
      expect(await writesOf(dinamo.id)).toEqual(before);
    },
  );

  it('refuses the field before an out-of-limit name is judged', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    const body = { bio: 'Pasionat de motoare', name: 'E' };
    const auth = bearer(mihai, 'garage');

    const added = await add(dinamo.id, body, auth);
    const edited = await edit(dinamo.id, elena.id, body, auth);

    expect([added.status, added.body.code]).toEqual([
      403,
      'mechanic_owned_field',
    ]);
    expect([edited.status, edited.body.code]).toEqual([
      403,
      'mechanic_owned_field',
    ]);
  });
});

// @traces 056-FR-002
describe('adding a card', () => {
  it('answers 201 with the new card as the list shows it, trimmed', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const { dacia, skoda } = await brands(dinamo.id);

    const res = await add(
      dinamo.id,
      {
        brandIds: [skoda.id, dacia.id],
        certifications: [' Bosch Service '],
        name: '  Elena Stan ',
        roleTitle: ' Mecanic șef ',
        specialties: [' Frâne', 'Suspensie '],
        years: 12,
      },
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ...blank,
      brandIds: [skoda.id, dacia.id],
      certifications: ['Bosch Service'],
      id: expect.any(String),
      name: 'Elena Stan',
      roleTitle: 'Mecanic șef',
      speciality: 'Frâne, Suspensie',
      specialties: ['Frâne', 'Suspensie'],
      years: 12,
    });
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      accountId: null,
      garageId: dinamo.id,
      isOwner: false,
      name: 'Elena Stan',
      onProfile: false,
      removedAt: null,
      speciality: 'Frâne, Suspensie',
      years: 12,
    });
    const list = await team(dinamo.id, bearer(mihai, 'garage'));
    expect(list.body.items).toContainEqual(res.body);
  });

  it('adds a card from its name alone, every other field empty', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });

    const res = await add(
      dinamo.id,
      { name: 'Elena Stan' },
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ...blank,
      id: expect.any(String),
      name: 'Elena Stan',
    });
  });

  it('takes every field at its limit', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const tag = (n: number, length: number) => `${n}`.padEnd(length, 'ă');

    const longest = await add(
      dinamo.id,
      {
        certifications: Array.from({ length: 10 }, (_, i) => tag(i, 80)),
        name: 'ă'.repeat(80),
        roleTitle: 'ș'.repeat(40),
        specialties: Array.from({ length: 6 }, (_, i) => tag(i, 40)),
        years: 60,
      },
      bearer(mihai, 'garage'),
    );
    const shortest = await add(
      dinamo.id,
      { name: 'Ed', years: 0 },
      bearer(mihai, 'garage'),
    );

    expect(longest.status).toBe(201);
    expect(longest.body.speciality).toHaveLength(250);
    expect([shortest.status, shortest.body.years]).toEqual([201, 0]);
  });

  it.each([
    // The JSON body drops an undefined name: the request carries none.
    {
      body: { name: undefined },
      code: 'required',
      field: 'name',
      what: 'no name',
    },
    {
      body: { name: '   ' },
      code: 'required',
      field: 'name',
      what: 'a blank name',
    },
    {
      body: { name: 'E' },
      code: 'too_short',
      field: 'name',
      what: 'a name of one letter',
    },
    {
      body: { name: 'a'.repeat(81) },
      code: 'too_long',
      field: 'name',
      what: 'a name over 80 characters',
    },
    {
      body: { roleTitle: 'a'.repeat(41) },
      code: 'too_long',
      field: 'roleTitle',
      what: 'a role over 40 characters',
    },
    {
      body: { specialties: ['1', '2', '3', '4', '5', '6', '7'] },
      code: 'too_many',
      field: 'specialties',
      what: 'seven specialties',
    },
    {
      body: { specialties: ['a'.repeat(41)] },
      code: 'too_long',
      field: 'specialties',
      what: 'a specialty over 40 characters',
    },
    {
      body: { specialties: ['Frâne', ' '] },
      code: 'invalid',
      field: 'specialties',
      what: 'a blank specialty',
    },
    {
      body: { certifications: [''] },
      code: 'invalid',
      field: 'certifications',
      what: 'an empty certification',
    },
    {
      body: { certifications: Array.from({ length: 11 }, (_, i) => `C${i}`) },
      code: 'too_many',
      field: 'certifications',
      what: 'eleven certifications',
    },
    {
      body: { certifications: ['a'.repeat(81)] },
      code: 'too_long',
      field: 'certifications',
      what: 'a certification over 80 characters',
    },
    {
      body: { years: 61 },
      code: 'out_of_range',
      field: 'years',
      what: 'more than 60 years',
    },
    {
      body: { years: -1 },
      code: 'out_of_range',
      field: 'years',
      what: 'negative years',
    },
    {
      body: { years: 2.5 },
      code: 'invalid',
      field: 'years',
      what: 'years that are not whole',
    },
  ])(
    'refuses $what with 422 validation_failed naming $field, writing nothing',
    async ({ body, code, field }) => {
      const { dinamo, mihai } = await world({ ownerRow: true });
      const before = await writesOf(dinamo.id);

      const res = await add(
        dinamo.id,
        { name: 'Elena Stan', ...body },
        bearer(mihai, 'garage'),
      );

      expect([res.status, res.body.code]).toEqual([422, 'validation_failed']);
      expect(res.body.errors).toContainEqual({ code, field });
      expect(await writesOf(dinamo.id)).toEqual(before);
    },
  );

  it('refuses a brand the garage does not take, an unknown one and a duplicate, naming brandIds', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const { bmw, dacia } = await brands(dinamo.id);
    const before = await writesOf(dinamo.id);

    for (const [brandIds, code] of [
      [[bmw.id], 'not_taken'],
      [[randomUUID()], 'not_taken'],
      [[dacia.id, dacia.id], 'duplicate'],
    ] as const) {
      const res = await add(
        dinamo.id,
        { brandIds, name: 'Elena Stan' },
        bearer(mihai, 'garage'),
      );
      expect([res.status, res.body.code]).toEqual([422, 'validation_failed']);
      expect(res.body.errors).toContainEqual({ code, field: 'brandIds' });
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  // @traces 056-FR-005
  it('records who added the card', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });

    const res = await add(
      dinamo.id,
      { name: 'Elena Stan' },
      bearer(mihai, 'garage'),
    );

    expect(await entries(res.body.id)).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: mihai,
        actorRole: 'owner',
        garageId: dinamo.id,
      }),
    ]);
  });

  // @traces 056-FR-005
  it('tells the garage, and no public channel, of a card off the profile', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });

    const res = await add(
      dinamo.id,
      { name: 'Elena Stan' },
      bearer(mihai, 'garage'),
    );

    const events = await outbox('mechanic.added');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`garage:${dinamo.id}`, `mechanic:${res.body.id}`],
      payload: { garageId: dinamo.id, mechanicId: res.body.id },
      subjectId: res.body.id,
    });
  });

  // @traces 056-FR-005
  it('writes neither the card nor its history when its event cannot be recorded', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    quiet();
    const before = await writesOf(dinamo.id);
    const undo = await refuseInserts(
      'outbox_event',
      "NEW.kind = 'mechanic.added'",
    );
    let status = 0;
    try {
      status = (
        await add(dinamo.id, { name: 'Elena Stan' }, bearer(mihai, 'garage'))
      ).status;
    } finally {
      await undo();
    }

    expect(status).toBeGreaterThanOrEqual(500);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });
});

// @traces 056-FR-002
describe('editing a card', () => {
  it('answers 200 with the card, changing only the fields given', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    await fill(elena.id);

    const res = await edit(
      dinamo.id,
      elena.id,
      { specialties: ['Diagnoză'], years: 13 },
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...blank,
      certifications: ['Bosch Service'],
      id: elena.id,
      name: 'Elena Stan',
      roleTitle: 'Mecanic șef',
      speciality: 'Diagnoză',
      specialties: ['Diagnoză'],
      years: 13,
    });
  });

  it('clears the role and the years with null and a list with an empty one', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const { dacia } = await brands(dinamo.id);
    const elena = await card(dinamo.id, 'Elena Stan');
    await fill(elena.id, [dacia.id]);

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
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brandIds: [],
      certifications: [],
      roleTitle: null,
      speciality: null,
      specialties: [],
      years: null,
    });
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: elena.id } }),
    ).toMatchObject({ roleTitle: null, speciality: null, years: null });
  });

  it('refuses to clear the name, and a field outside its limit, changing nothing', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    const before = await writesOf(dinamo.id);

    for (const [body, code, field] of [
      [{ name: null }, 'required', 'name'],
      [{ name: '' }, 'required', 'name'],
      [{ years: 61 }, 'out_of_range', 'years'],
    ] as const) {
      const res = await edit(
        dinamo.id,
        elena.id,
        body,
        bearer(mihai, 'garage'),
      );
      expect([res.status, res.body.code]).toEqual([422, 'validation_failed']);
      expect(res.body.errors).toContainEqual({ code, field });
    }
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it("edits the owner's own row, leaving the account's name as it is", async () => {
    const { dinamo, mihai, mihaiCard } = await world({ ownerRow: true });

    const res = await edit(
      dinamo.id,
      mihaiCard.id,
      { name: 'Mihai Popescu', years: 20 },
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hasAccount: true,
      id: mihaiCard.id,
      isOwner: true,
      name: 'Mihai Popescu',
      years: 20,
    });
    const owner = await prisma.account.findUniqueOrThrow({
      where: { id: mihai },
    });
    expect(owner.name).toBe('mihai');
  });

  it('keeps the later of two edits in a row', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    const auth = bearer(mihai, 'garage');

    await edit(dinamo.id, elena.id, { years: 5 }, auth);
    await edit(dinamo.id, elena.id, { years: 7 }, auth);

    const list = await team(dinamo.id, auth);
    expect(
      list.body.items.find((item: { id: string }) => item.id === elena.id),
    ).toMatchObject({ years: 7 });
  });

  // @traces 056-FR-005
  it('records one entry per changed field with the old and new value, none for the derived line', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    await fill(elena.id);

    await edit(
      dinamo.id,
      elena.id,
      {
        certifications: ['Bosch Service'],
        name: 'Elena Stan',
        roleTitle: null,
        specialties: ['Frâne', 'Diagnoză'],
        years: 13,
      },
      bearer(mihai, 'garage'),
    );

    const written = await entries(elena.id);
    expect(
      written.map(
        ({ action, actorId, actorRole, field, newValue, oldValue }) => ({
          action,
          actorId,
          actorRole,
          field,
          newValue,
          oldValue,
        }),
      ),
    ).toEqual(
      [
        ['roleTitle', 'Mecanic șef', null],
        ['specialties', 'Frâne, Suspensie', 'Frâne, Diagnoză'],
        ['years', 12, 13],
      ].map(([field, oldValue, newValue]) => ({
        action: 'update',
        actorId: mihai,
        actorRole: 'owner',
        field,
        newValue,
        oldValue,
      })),
    );
  });

  // @traces 056-FR-005
  it('tells the garage which fields changed, and no public channel, for a card off the profile', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    await fill(elena.id);

    await edit(
      dinamo.id,
      elena.id,
      { roleTitle: 'Electrician', years: 12 },
      bearer(mihai, 'garage'),
    );

    const events = await outbox('mechanic.updated');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: [`garage:${dinamo.id}`, `mechanic:${elena.id}`],
      payload: {
        fields: ['roleTitle'],
        garageId: dinamo.id,
        mechanicId: elena.id,
      },
      subjectId: elena.id,
    });
  });

  // @traces 056-FR-005
  it("tells the garage's and the mechanic's public channels of a card on the profile", async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    await edit(dinamo.id, vladCard.id, { years: 9 }, bearer(mihai, 'garage'));

    const [event] = await outbox('mechanic.updated');
    expect([...event.audience].sort()).toEqual(
      [
        `garage:${dinamo.id}`,
        `mechanic:${vladCard.id}`,
        `public:garage:${dinamo.id}`,
        `public:mechanic:${vladCard.id}`,
      ].sort(),
    );
  });

  // @traces 056-FR-005
  it('answers 200 to an edit that changes nothing, recording nothing', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Stan');
    await fill(elena.id);
    const before = await writesOf(dinamo.id);

    const res = await edit(
      dinamo.id,
      elena.id,
      { name: 'Elena Stan', specialties: ['Frâne', 'Suspensie'], years: 12 },
      bearer(mihai, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });
});

// @traces 056-FR-006
describe('removing a card', () => {
  it('answers 204 and takes the card off the team, its account and the profile', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    const res = await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: vladCard.id },
    });
    expect(row).toMatchObject({
      accountId: null,
      name: 'Tudor Vlad',
      onProfile: false,
      removedAt: expect.any(Date),
    });
    const list = await team(dinamo.id, bearer(mihai, 'garage'));
    expect(
      list.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(vladCard.id);
  });

  it("revokes the garage's open mechanic invites to the account's e-mail, and no other", async () => {
    const { dinamo, mihai, nord, vlad, vladCard } = await world({
      ownerRow: true,
    });
    await prisma.account.update({
      data: { email: 'Vlad@Example.test' },
      where: { id: vlad },
    });
    const open = await invite(dinamo.id, 'vlad@example.test');
    const asReceptionist = await invite(
      dinamo.id,
      'vlad@example.test',
      'receptionist',
    );
    const elsewhere = await invite(nord.id, 'vlad@example.test');
    const someoneElse = await invite(dinamo.id, 'elena@example.test');

    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    expect(await inviteStatus(open.id)).toBe('revoked');
    expect(await inviteStatus(asReceptionist.id)).toBe('sent');
    expect(await inviteStatus(elsewhere.id)).toBe('sent');
    expect(await inviteStatus(someoneElse.id)).toBe('sent');
  });

  it('touches no invite when the card has no account', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');
    const open = await invite(dinamo.id, 'elena@example.test');

    const res = await remove(dinamo.id, elena.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(204);
    expect(await inviteStatus(open.id)).toBe('sent');
  });

  it('records who removed the card', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    expect(await entries(vladCard.id)).toEqual([
      expect.objectContaining({
        action: 'delete',
        actorId: mihai,
        actorRole: 'owner',
        garageId: dinamo.id,
      }),
    ]);
  });

  // @traces 056-FR-006
  it('removes a card once when two removes arrive together', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    const answers = await Promise.all([
      remove(dinamo.id, vladCard.id, bearer(mihai, 'garage')),
      remove(dinamo.id, vladCard.id, bearer(mihai, 'garage')),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([204, 404]);
    expect(await entries(vladCard.id)).toHaveLength(1);
    expect(await outbox('mechanic.removed')).toHaveLength(1);
  });

  // @traces 056-FR-005 056-FR-006
  it('writes nothing onto a card a remove took off the team first', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    const [edited] = await Promise.all([
      edit(
        dinamo.id,
        vladCard.id,
        { roleTitle: 'Șef de atelier' },
        bearer(mihai, 'garage'),
      ),
      remove(dinamo.id, vladCard.id, bearer(mihai, 'garage')),
    ]);

    const updated = await outbox('mechanic.updated');
    if (edited.status === 404) {
      expect(updated).toHaveLength(0);
    } else {
      expect(edited.status).toBe(200);
      expect(updated).toHaveLength(1);
    }
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: vladCard.id } }),
    ).toMatchObject({ removedAt: expect.any(Date) });
  });

  it('tells the garage and the public channels of a card that was on the profile', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });

    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    const events = await outbox('mechanic.removed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: { garageId: dinamo.id, mechanicId: vladCard.id },
      subjectId: vladCard.id,
    });
    expect([...events[0].audience].sort()).toEqual(
      [
        `garage:${dinamo.id}`,
        `mechanic:${vladCard.id}`,
        `public:garage:${dinamo.id}`,
        `public:mechanic:${vladCard.id}`,
      ].sort(),
    );
  });

  it('tells only the garage of a card off the profile', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');

    await remove(dinamo.id, elena.id, bearer(mihai, 'garage'));

    const [event] = await outbox('mechanic.removed');
    expect(event.audience).toEqual([
      `garage:${dinamo.id}`,
      `mechanic:${elena.id}`,
    ]);
  });

  it("keeps the card's reviews, jobs and bookings naming it", async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });
    const booking = await bookings.booked(dinamo.id, inHours(48), 'confirmed', {
      mechanicId: vladCard.id,
    });
    const job = await bookings.job(booking.id);
    const review = await prisma.review.create({
      data: {
        driverId: booking.driverId,
        garageId: dinamo.id,
        jobId: job.id,
        mechanicId: vladCard.id,
        rating: 5,
      },
    });
    const before = await prisma.mechanic.findUniqueOrThrow({
      where: { id: vladCard.id },
    });

    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: vladCard.id } }),
    ).toMatchObject({
      name: before.name,
      rating: before.rating,
      reviewCount: before.reviewCount,
    });
    const [kept] = await Promise.all([
      Promise.all([
        prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }),
        prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
        prisma.review.findUniqueOrThrow({ where: { id: review.id } }),
      ]),
    ]);
    expect(kept.map((row) => row.mechanicId)).toEqual([
      vladCard.id,
      vladCard.id,
      vladCard.id,
    ]);
  });

  it("answers 409 owner_row for the owner's own row, changing nothing", async () => {
    const { dinamo, mihai, mihaiCard } = await world({ ownerRow: true });
    const before = await writesOf(dinamo.id);

    const res = await remove(dinamo.id, mihaiCard.id, bearer(mihai, 'garage'));

    expect([res.status, res.body.code]).toEqual([409, 'owner_row']);
    expect(await writesOf(dinamo.id)).toEqual(before);
  });

  it('changes nothing when its event cannot be recorded', async () => {
    const { dinamo, mihai, vladCard } = await world({ ownerRow: true });
    const open = await invite(dinamo.id, 'vlad@example.test');
    quiet();
    const before = await writesOf(dinamo.id);
    const undo = await refuseInserts(
      'outbox_event',
      "NEW.kind = 'mechanic.removed'",
    );
    let status = 0;
    try {
      status = (await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage')))
        .status;
    } finally {
      await undo();
    }

    expect(status).toBeGreaterThanOrEqual(500);
    expect(await writesOf(dinamo.id)).toEqual(before);
    expect(await inviteStatus(open.id)).toBe('sent');
  });
});

// @traces 056-FR-007
describe("the removed card's account", () => {
  it('has no garage from its next request on', async () => {
    const { dinamo, mihai, vlad, vladCard } = await world({ ownerRow: true });
    const before = await team(dinamo.id, bearer(vlad, 'mechanic'));

    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    const after = await team(dinamo.id, bearer(vlad, 'mechanic'));
    expect([before.status, before.body.code]).toEqual([403, 'forbidden']);
    expect([after.status, after.body.code]).toEqual([404, 'not_found']);
  });

  it('gets a new card from a later accepted invite, the removed one left detached', async () => {
    const { dinamo, mihai, vlad, vladCard } = await world({ ownerRow: true });
    await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));
    const sent = await http()
      .post(`/garages/${dinamo.id}/invites`)
      .set('Authorization', bearer(mihai, 'garage'))
      .send({
        email: 'vlad@example.test',
        kind: 'mechanic',
        name: 'Tudor Vlad',
      });
    expect(sent.status).toBe(201);
    const mail = brevo.emails().at(-1)?.body as { textContent: string };
    const token = /\/(?:ro|en)\/invite\/([A-Za-z0-9_-]+)/.exec(
      mail.textContent,
    )?.[1];

    const accepted = await http()
      .post('/invites/accept')
      .set('Authorization', bearer(vlad, 'mechanic'))
      .send({ token });

    expect(accepted.status).toBe(204);
    const fresh = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: vlad },
    });
    expect(fresh.id).not.toBe(vladCard.id);
    expect(fresh.garageId).toBe(dinamo.id);
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: vladCard.id } }),
    ).toMatchObject({ accountId: null, removedAt: expect.any(Date) });
  });
});

// @traces 056-FR-009
describe('telling the removed account', () => {
  const notices = (accountId: string) =>
    prisma.notification.findMany({
      where: { accountId, kind: 'STAFF_REMOVED' },
    });

  it('sends STAFF_REMOVED by e-mail and push, never WhatsApp, even with the garage on WhatsApp', async () => {
    const { dinamo, mihai, vlad, vladCard } = await world({ ownerRow: true });
    await prisma.account.update({
      data: { phone: '+40722000111', phoneVerifiedAt: new Date() },
      where: { id: vlad },
    });
    await prisma.garageFeature.create({
      data: { enabled: true, garageId: dinamo.id, key: 'whatsapp' },
    });
    await prisma.pushSubscription.create({
      data: {
        accountId: vlad,
        auth: 'a',
        endpoint: `https://push.example.test/${vlad}`,
        p256dh: 'p',
      },
    });

    const res = await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(204);
    const sent = await notices(vlad);
    expect(sent.map((n) => n.channel).sort()).toEqual([
      'email',
      'in_app',
      'push',
    ]);
    for (const notice of sent) {
      expect(notice.eventId).toBe(`mechanic.removed:${vladCard.id}`);
      expect(notice.params).toEqual({ garage: 'Atelier Dinamo' });
    }
  });

  it('sends nothing for a card with no account', async () => {
    const { dinamo, mihai } = await world({ ownerRow: true });
    const elena = await card(dinamo.id, 'Elena Pop');

    const res = await remove(dinamo.id, elena.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(204);
    expect(
      await prisma.notification.count({ where: { kind: 'STAFF_REMOVED' } }),
    ).toBe(0);
  });

  it('sends nothing when the removal is rolled back', async () => {
    const { dinamo, mihai, vlad, vladCard } = await world({ ownerRow: true });
    quiet();
    const undo = await refuseInserts(
      'outbox_event',
      "NEW.kind = 'mechanic.removed'",
    );
    try {
      await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage'));
    } finally {
      await undo();
    }

    expect(await notices(vlad)).toEqual([]);
  });

  it('keeps the removal when the notice cannot be written', async () => {
    const { dinamo, mihai, vlad, vladCard } = await world({ ownerRow: true });
    quiet();
    const undo = await refuseInserts(
      'notification',
      "NEW.kind = 'STAFF_REMOVED'",
    );
    let status = 0;
    try {
      status = (await remove(dinamo.id, vladCard.id, bearer(mihai, 'garage')))
        .status;
    } finally {
      await undo();
    }

    expect(status).toBe(204);
    expect(await notices(vlad)).toEqual([]);
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: vladCard.id } }),
    ).toMatchObject({ accountId: null, removedAt: expect.any(Date) });
  });
});
