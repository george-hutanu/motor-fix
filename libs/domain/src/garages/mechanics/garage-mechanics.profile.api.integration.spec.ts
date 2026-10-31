import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
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

// Who the profile shows and who takes direct requests, through the team's
// endpoints: the list's lamps, the card's switch, the refused consent field
// and the card events' public channels.

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let mark: bigint;

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

beforeEach(async () => {
  await reset();
  mark = await outboxMark(prisma);
});

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

// Atelier Dinamo (approved) with its owner Mihai, a receptionist, Vlad (joined,
// on the profile), Ana (joined, chose not to appear) and Elena (no account);
// Atelier Nord with its owner Radu; a driver and an admin.
async function world() {
  const dinamo = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  const vladCard = await prisma.mechanic.create({
    data: {
      accountId: vlad,
      garageId: dinamo.id,
      name: 'Tudor Vlad',
      onProfile: true,
    },
  });
  const ana = await account('ana', ['mechanic']);
  const anaCard = await prisma.mechanic.create({
    data: { accountId: ana, garageId: dinamo.id, name: 'Ana Pop' },
  });
  const elenaCard = await prisma.mechanic.create({
    data: { garageId: dinamo.id, name: 'Elena Stan' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  const driver = await account('andrei', ['driver']);
  const admin = await account('admin', ['admin']);
  return {
    admin: bearer(admin, 'admin'),
    anaCard,
    dinamo,
    driver: bearer(driver, 'driver'),
    elenaCard,
    mechanic: bearer(vlad, 'mechanic'),
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
    vladCard,
  };
}

const outbox = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });
const entries = (mechanicId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { subjectId: mechanicId, subjectType: 'mechanic' },
  });
const stored = (mechanicId: string) =>
  prisma.mechanic.findUniqueOrThrow({ where: { id: mechanicId } });
const hideTeam = (garageId: string) =>
  prisma.garage.update({
    data: { teamOnProfile: false },
    where: { id: garageId },
  });

type Item = {
  hasAccount: boolean;
  id: string;
  onProfile: boolean;
  shown: boolean;
  takesDirectRequests: boolean;
};
const lamps = (items: Item[]) =>
  Object.fromEntries(
    items.map((item) => [
      item.id,
      [item.shown, item.onProfile, item.hasAccount, item.takesDirectRequests],
    ]),
  );

// @traces 059-FR-012 059-FR-001
describe("the team list's lamps", () => {
  it('answers the garage switch at the top and, per card, shown by the rule and whether it takes direct requests', async () => {
    const w = await world();
    await prisma.mechanic.update({
      data: { takesDirectRequests: false },
      where: { id: w.elenaCard.id },
    });

    const res = await team(w.dinamo.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body.teamOnProfile).toBe(true);
    expect(lamps(res.body.items)).toEqual({
      [w.anaCard.id]: [false, false, true, true],
      [w.elenaCard.id]: [false, false, false, false],
      [w.vladCard.id]: [true, true, true, true],
    });
  });

  it('shows no card while the garage hides its team', async () => {
    const w = await world();
    await hideTeam(w.dinamo.id);

    const res = await team(w.dinamo.id, w.owner);

    expect(res.body.teamOnProfile).toBe(false);
    expect(
      res.body.items.map((item: Item) => item.shown).every((s: boolean) => !s),
    ).toBe(true);
    const vlad = res.body.items.find((item: Item) => item.id === w.vladCard.id);
    expect(vlad).toMatchObject({ onProfile: true, shown: false });
  });

  it('shows no card of a garage that is not approved', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: w.dinamo.id },
    });

    const res = await team(w.dinamo.id, w.owner);

    expect(
      res.body.items.find((item: Item) => item.id === w.vladCard.id),
    ).toMatchObject({ shown: false });
  });
});

// @traces 059-FR-006 059-FR-007 059-FR-008
describe("the card's direct requests switch", () => {
  it('starts a new card taking direct requests', async () => {
    const w = await world();

    const res = await add(w.dinamo.id, { name: 'Ion Marin' }, w.owner);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ shown: false, takesDirectRequests: true });
    expect((await stored(res.body.id)).takesDirectRequests).toBe(true);
  });

  it('writes it with the other fields, one history entry and one mechanic.updated naming it', async () => {
    const w = await world();

    const res = await edit(
      w.dinamo.id,
      w.vladCard.id,
      { takesDirectRequests: false, years: 9 },
      w.owner,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ takesDirectRequests: false, years: 9 });
    expect(await stored(w.vladCard.id)).toMatchObject({
      takesDirectRequests: false,
      years: 9,
    });
    expect(
      (await entries(w.vladCard.id))
        .filter((e) => e.field === 'takes_direct_requests')
        .map((e) => [e.action, e.oldValue, e.newValue]),
    ).toEqual([['update', true, false]]);
    const events = await outbox('mechanic.updated');
    expect(events).toHaveLength(1);
    expect(
      [...(events[0].payload as { fields: string[] }).fields].sort(),
    ).toEqual(['takesDirectRequests', 'years']);
  });

  it('writes it on a card without an account and one whose mechanic chose not to appear', async () => {
    const w = await world();

    for (const id of [w.elenaCard.id, w.anaCard.id]) {
      const res = await edit(
        w.dinamo.id,
        id,
        { takesDirectRequests: false },
        w.owner,
      );
      expect(res.status).toBe(200);
      expect((await stored(id)).takesDirectRequests).toBe(false);
    }
  });

  it('records nothing for an equal value', async () => {
    const w = await world();

    const res = await edit(
      w.dinamo.id,
      w.vladCard.id,
      { takesDirectRequests: true },
      w.owner,
    );

    expect(res.status).toBe(200);
    expect(await entries(w.vladCard.id)).toEqual([]);
    expect(await outbox('mechanic.updated')).toEqual([]);
  });

  it('answers 422 invalid to a value that is not a boolean', async () => {
    const w = await world();

    const res = await edit(
      w.dinamo.id,
      w.vladCard.id,
      { takesDirectRequests: 'da' },
      w.owner,
    );

    expect(res.status).toBe(422);
    expect(res.body.errors).toContainEqual({
      code: 'invalid',
      field: 'takesDirectRequests',
    });
    expect((await stored(w.vladCard.id)).takesDirectRequests).toBe(true);
  });

  it('refuses a new card carrying it as an unknown field', async () => {
    const w = await world();

    const res = await add(
      w.dinamo.id,
      { name: 'Ion Marin', takesDirectRequests: false },
      w.owner,
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(
      'property takesDirectRequests should not exist',
    );
    expect(await prisma.mechanic.count({ where: { name: 'Ion Marin' } })).toBe(
      0,
    );
  });

  it('answers 401 without a session, 403 to staff, 404 to anyone else and with the team switched off', async () => {
    const w = await world();
    const body = { takesDirectRequests: false };

    expect((await edit(w.dinamo.id, w.vladCard.id, body)).status).toBe(401);
    for (const as of [w.receptionist, w.mechanic]) {
      expect((await edit(w.dinamo.id, w.vladCard.id, body, as)).status).toBe(
        403,
      );
    }
    for (const as of [w.other, w.driver, w.admin]) {
      expect((await edit(w.dinamo.id, w.vladCard.id, body, as)).status).toBe(
        404,
      );
    }
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.dinamo.id, key: 'team_mechanics' },
    });
    const off = await edit(w.dinamo.id, w.vladCard.id, body, w.owner);
    expect(off.status).toBe(404);
    expect(off.body.code).toBe('feature_off');
    expect((await stored(w.vladCard.id)).takesDirectRequests).toBe(true);
  });
});

// @traces 059-FR-009
describe("the mechanic's consent", () => {
  it.each([
    ['alone', { onProfile: true }],
    [
      'with the direct requests switch',
      { onProfile: true, takesDirectRequests: false },
    ],
    ['with a field that is not valid', { onProfile: false, years: -4 }],
  ])(
    'refuses a body carrying onProfile %s with 403 mechanic_owned_field, writing nothing',
    async (_, body) => {
      const w = await world();

      const res = await edit(w.dinamo.id, w.anaCard.id, body, w.owner);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('mechanic_owned_field');
      expect(await stored(w.anaCard.id)).toMatchObject({
        onProfile: false,
        takesDirectRequests: true,
        years: null,
      });
      expect(await entries(w.anaCard.id)).toEqual([]);
      expect(await outbox('mechanic.updated')).toEqual([]);
    },
  );
});

// @traces 059-FR-011
describe("the card events' public channels", () => {
  it('reach the public pages of a shown card', async () => {
    const w = await world();

    await edit(w.dinamo.id, w.vladCard.id, { years: 9 }, w.owner);

    const [event] = await outbox('mechanic.updated');
    expect(event.audience).toEqual(
      expect.arrayContaining([
        `public:garage:${w.dinamo.id}`,
        `public:mechanic:${w.vladCard.id}`,
      ]),
    );
  });

  it('stay with the staff while the garage hides its team', async () => {
    const w = await world();
    await hideTeam(w.dinamo.id);

    await edit(w.dinamo.id, w.vladCard.id, { years: 9 }, w.owner);
    await remove(w.dinamo.id, w.vladCard.id, w.owner);

    for (const kind of ['mechanic.updated', 'mechanic.removed']) {
      const [event] = await outbox(kind);
      expect(event.audience).toEqual([
        `garage:${w.dinamo.id}`,
        `mechanic:${w.vladCard.id}`,
      ]);
    }
  });

  it('stay with the staff for a card that is on the profile but has no account', async () => {
    const w = await world();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: w.elenaCard.id },
    });

    await edit(w.dinamo.id, w.elenaCard.id, { years: 3 }, w.owner);

    const [event] = await outbox('mechanic.updated');
    expect(event.audience).toEqual([
      `garage:${w.dinamo.id}`,
      `mechanic:${w.elenaCard.id}`,
    ]);
  });

  it('say a removed card was public from its state before the removal', async () => {
    const w = await world();

    await remove(w.dinamo.id, w.vladCard.id, w.owner);

    const [event] = await outbox('mechanic.removed');
    expect(event.audience).toEqual(
      expect.arrayContaining([`public:mechanic:${w.vladCard.id}`]),
    );
  });
});
