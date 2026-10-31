import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
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

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
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
  const [{ id }] = await prisma.$queryRaw<
    { id: bigint }[]
  >`SELECT COALESCE(MAX(id), 0)::bigint AS id FROM outbox_event`;
  lastEvent = id;
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function world() {
  const garage = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: garage.id, role: 'owner' },
  });
  return { garage, owner: bearer(mihai, 'garage') };
}
type World = Awaited<ReturnType<typeof world>>;

const patch = (w: World, body: unknown) =>
  request(app.getHttpServer())
    .patch(`/garages/${w.garage.id}`)
    .set('Authorization', w.owner)
    .send(body as object);
const team = (w: World) =>
  prisma.garage
    .findUniqueOrThrow({
      select: { teamOnProfile: true },
      where: { id: w.garage.id },
    })
    .then((g) => g.teamOnProfile);
const trail = (w: World) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { field: 'team_on_profile', garageId: w.garage.id },
  });
const sent = (w: World) =>
  prisma.outboxEvent.findMany({
    where: {
      id: { gt: lastEvent },
      kind: 'garage.updated',
      subjectId: w.garage.id,
    },
  });
const cash = { card: false, cash: true, transfer: false };

describe('PATCH a garage with teamOnProfile under hostile input', () => {
  it.each([
    ['a string', 'false'],
    ['zero', 0],
    ['one', 1],
    ['null', null],
    ['an array', [false]],
    ['an object', { on: false }],
  ])('answers 400 to %s and writes nothing', async (_label, value) => {
    const w = await world();

    const res = await patch(w, { teamOnProfile: value });

    expect(res.status).toBe(400);
    expect(await team(w)).toBe(true);
    expect(await trail(w)).toEqual([]);
    expect(await sent(w)).toEqual([]);
  });

  it('answers 400 to an empty body and to a body of only unknown keys', async () => {
    const w = await world();

    expect((await patch(w, {})).status).toBe(400);
    expect((await patch(w, { team_on_profile: false })).status).toBe(400);
    expect(await team(w)).toBe(true);
  });

  it('refuses the whole body when teamOnProfile is good and paymentMethods is bad', async () => {
    const w = await world();

    const res = await patch(w, {
      paymentMethods: { card: false, cash: false, transfer: false },
      teamOnProfile: false,
    });

    expect(res.status).toBe(400);
    expect(await team(w)).toBe(true);
    expect(await trail(w)).toEqual([]);
  });

  it('saves teamOnProfile beside good payment methods in one answer', async () => {
    const w = await world();

    const res = await patch(w, { paymentMethods: cash, teamOnProfile: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentMethods: cash,
      teamOnProfile: false,
    });
    expect(await team(w)).toBe(false);
  });

  it('leaves teamOnProfile alone when only payment methods are sent', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: w.garage.id },
    });

    const res = await patch(w, { paymentMethods: cash });

    expect(res.status).toBe(200);
    expect(res.body.teamOnProfile).toBe(false);
    expect(await trail(w)).toEqual([]);
  });

  it('records one entry and one event per real change across off, off, on', async () => {
    const w = await world();

    await patch(w, { teamOnProfile: false });
    await patch(w, { teamOnProfile: false });
    await patch(w, { teamOnProfile: true });

    const entries = await trail(w);
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(
      (await sent(w)).map((e) => (e.payload as { fields: string[] }).fields),
    ).toEqual([['team_on_profile'], ['team_on_profile']]);
  });

  it('leaves the audience of the event with no removed card and no card of another garage', async () => {
    const w = await world();
    const live = await prisma.mechanic.create({
      data: { garageId: w.garage.id, name: 'Elena' },
    });
    const gone = await prisma.mechanic.create({
      data: { garageId: w.garage.id, name: 'Plecat', removedAt: new Date() },
    });
    const foreignGarage = await prisma.garage.create({
      data: { name: 'Alt', slug: `alt-${randomUUID()}` },
    });
    const foreign = await prisma.mechanic.create({
      data: { garageId: foreignGarage.id, name: 'Strain' },
    });

    await patch(w, { teamOnProfile: false });

    const audience = (await sent(w))[0]?.audience ?? [];
    expect(audience).toContain(`public:mechanic:${live.id}`);
    expect(audience).not.toContain(`public:mechanic:${gone.id}`);
    expect(audience).not.toContain(`public:mechanic:${foreign.id}`);
  });

  it('ends consistent with its history after twelve alternating concurrent writes', async () => {
    const w = await world();

    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        patch(w, { teamOnProfile: n % 2 === 0 }),
      ),
    );

    expect(answers.map((a) => a.status)).toEqual(Array(12).fill(200));
    const entries = await trail(w);
    const down = entries.filter((e) => e.oldValue === true).length;
    const up = entries.filter((e) => e.oldValue === false).length;
    expect(down - up).toBe((await team(w)) ? 0 : 1);
    expect((await sent(w)).length).toBe(entries.length);
  });
});
