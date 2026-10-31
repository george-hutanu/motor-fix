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

async function world() {
  const garage = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: garage.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: garage.id, role: 'receptionist' },
  });
  const radu = await account('radu', ['garage']);
  const other = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: other.id, role: 'owner' },
  });
  const elenaAccount = await account('elena', ['mechanic']);
  const elena = await prisma.mechanic.create({
    data: {
      accountId: elenaAccount,
      garageId: garage.id,
      name: 'Elena',
      onProfile: true,
    },
  });
  return {
    elena,
    elenaAuth: bearer(elenaAccount, 'mechanic'),
    garage,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}
type World = Awaited<ReturnType<typeof world>>;

const edit = (
  w: World,
  body: unknown,
  as: string | null = w.owner,
  id: string = w.elena.id,
) => {
  const req = http()
    .patch(`/garages/${w.garage.id}/mechanics/${id}`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};
const list = (w: World, as: string = w.owner) =>
  http().get(`/garages/${w.garage.id}/mechanics`).set('Authorization', as);
const row = (id: string) =>
  prisma.mechanic.findUniqueOrThrow({ where: { id } });
const audit = (id: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { field: 'takes_direct_requests', subjectId: id },
  });
const events = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });

describe('PATCH a card with takesDirectRequests under hostile input', () => {
  it.each([
    ['a string', 'false'],
    ['zero', 0],
    ['one', 1],
    ['null', null],
    ['an array', [false]],
    ['an object', { value: false }],
  ])('refuses %s and keeps the card on', async (_label, value) => {
    const w = await world();

    const res = await edit(w, { takesDirectRequests: value });

    expect([400, 422]).toContain(res.status);
    expect((await row(w.elena.id)).takesDirectRequests).toBe(true);
    expect(await audit(w.elena.id)).toEqual([]);
    expect(await events('mechanic.updated')).toEqual([]);
  });

  it('refuses a card POST that carries takesDirectRequests and creates no card', async () => {
    const w = await world();

    const res = await http()
      .post(`/garages/${w.garage.id}/mechanics`)
      .set('Authorization', w.owner)
      .send({ name: 'Costel', takesDirectRequests: false });

    expect(res.status).toBe(400);
    expect(
      await prisma.mechanic.count({
        where: { garageId: w.garage.id, name: 'Costel' },
      }),
    ).toBe(0);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['null', null],
    ['a string', 'yes'],
  ])(
    'answers 403 mechanic_owned_field to onProfile %s beside a good takesDirectRequests and writes neither',
    async (_label, onProfile) => {
      const w = await world();

      const res = await edit(w, { onProfile, takesDirectRequests: false });

      expect(res.status).toBe(403);
      expect(res.body.code ?? res.body.error).toBe('mechanic_owned_field');
      const after = await row(w.elena.id);
      expect(after.takesDirectRequests).toBe(true);
      expect(after.onProfile).toBe(true);
    },
  );

  it('answers 403 for onProfile before judging a bad years value in the same body', async () => {
    const w = await world();

    const res = await edit(w, { onProfile: true, years: -5 });

    expect(res.status).toBe(403);
  });

  it('keeps a mechanic who hid themselves hidden whatever the owner sends', async () => {
    const w = await world();
    await prisma.mechanic.update({
      data: { onProfile: false },
      where: { id: w.elena.id },
    });

    const res = await edit(w, { onProfile: true });

    expect(res.status).toBe(403);
    expect((await row(w.elena.id)).onProfile).toBe(false);
  });
});

describe('PATCH a card with takesDirectRequests, access and history', () => {
  it('stores off with one audit entry of true to false and one mechanic.updated naming the field', async () => {
    const w = await world();

    const res = await edit(w, { takesDirectRequests: false });

    expect(res.status).toBe(200);
    expect(res.body.takesDirectRequests).toBe(false);
    const entries = await audit(w.elena.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ newValue: false, oldValue: true });
    const updated = await events('mechanic.updated');
    expect(updated).toHaveLength(1);
    expect(
      updated.map((e) => (e.payload as { fields: string[] }).fields),
    ).toEqual([['takes_direct_requests']]);
  });

  it('writes nothing the second time the same value is sent', async () => {
    const w = await world();
    await edit(w, { takesDirectRequests: false });
    const before = await events('mechanic.updated');

    const res = await edit(w, { takesDirectRequests: false });

    expect(res.status).toBe(200);
    expect(await audit(w.elena.id)).toHaveLength(1);
    expect(await events('mechanic.updated')).toHaveLength(before.length);
  });

  it('writes nothing when the value sent equals the default on a fresh card', async () => {
    const w = await world();

    const res = await edit(w, { takesDirectRequests: true });

    expect(res.status).toBe(200);
    expect(await audit(w.elena.id)).toEqual([]);
    expect(await events('mechanic.updated')).toEqual([]);
  });

  it('ends consistent with its history after twelve alternating concurrent writes', async () => {
    const w = await world();

    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        edit(w, { takesDirectRequests: n % 2 === 0 }),
      ),
    );

    expect(answers.map((a) => a.status)).toEqual(Array(12).fill(200));
    const entries = await audit(w.elena.id);
    const stored = (await row(w.elena.id)).takesDirectRequests;
    const down = entries.filter((e) => e.oldValue === true).length;
    const up = entries.filter((e) => e.oldValue === false).length;
    expect(down - up).toBe(stored ? 0 : 1);
    expect(entries.length).toBe((await events('mechanic.updated')).length);
  });

  it('answers 403 to the receptionist and the mechanic herself, 404 to another owner, 401 signed out', async () => {
    const w = await world();
    const body = { takesDirectRequests: false };

    expect((await edit(w, body, w.receptionist)).status).toBe(403);
    expect((await edit(w, body, w.elenaAuth)).status).toBe(403);
    expect((await edit(w, body, w.other)).status).toBe(404);
    expect((await edit(w, body, null)).status).toBe(401);
    expect((await row(w.elena.id)).takesDirectRequests).toBe(true);
  });

  it('answers 404 feature_off with the team feature off', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.garage.id, key: 'team_mechanics' },
    });

    const res = await edit(w, { takesDirectRequests: false });

    expect(res.status).toBe(404);
    expect(res.body.code ?? res.body.error).toBe('feature_off');
  });

  it('answers 404 for a removed card and an unknown card without writing', async () => {
    const w = await world();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: w.elena.id },
    });

    expect((await edit(w, { takesDirectRequests: false })).status).toBe(404);
    expect(
      (await edit(w, { takesDirectRequests: false }, w.owner, randomUUID()))
        .status,
    ).toBe(404);
    expect((await row(w.elena.id)).takesDirectRequests).toBe(true);
  });

  it("answers 404 for a card of another garage by this garage's path", async () => {
    const w = await world();
    const foreign = await prisma.mechanic.create({
      data: {
        garageId: (
          await prisma.garage.findFirstOrThrow({
            where: { id: { not: w.garage.id } },
          })
        ).id,
        name: 'Strain',
      },
    });

    const res = await edit(
      w,
      { takesDirectRequests: false },
      w.owner,
      foreign.id,
    );

    expect(res.status).toBe(404);
    expect((await row(foreign.id)).takesDirectRequests).toBe(true);
  });
});

describe('the team list under the shown rule', () => {
  const byName = (
    body: { items: { name: string; shown: boolean }[] },
    name: string,
  ) => body.items.find((i) => i.name === name);

  it('keeps takesDirectRequests as stored while shown is false for a hidden mechanic', async () => {
    const w = await world();
    await prisma.mechanic.update({
      data: { onProfile: false, takesDirectRequests: true },
      where: { id: w.elena.id },
    });

    const res = await list(w);

    expect(byName(res.body, 'Elena')).toMatchObject({
      onProfile: false,
      shown: false,
      takesDirectRequests: true,
    });
  });

  it('shows nobody and reports the garage switch off when the team is hidden', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: w.garage.id },
    });

    const res = await list(w);

    expect(res.body.teamOnProfile).toBe(false);
    expect(res.body.items.map((i: { shown: boolean }) => i.shown)).toEqual([
      false,
    ]);
  });

  it('shows nobody of a garage that is suspended', async () => {
    const w = await world();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: w.garage.id },
    });

    const res = await list(w);

    expect(res.body.items.every((i: { shown: boolean }) => !i.shown)).toBe(
      true,
    );
  });

  it('never shows a card with no account even when its own consent is stored on', async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: { garageId: w.garage.id, name: 'Mihai Card', onProfile: true },
    });

    const res = await list(w);

    expect(byName(res.body, 'Mihai Card')).toMatchObject({
      hasAccount: false,
      shown: false,
    });
  });

  it('leaves a removed card that still holds an account out of the list', async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: {
        accountId: await account('gone', ['mechanic']),
        garageId: w.garage.id,
        name: 'Plecat',
        onProfile: true,
        removedAt: new Date(),
      },
    });

    const res = await list(w);

    expect(byName(res.body, 'Plecat')).toBeUndefined();
  });

  it('shows the mechanic again once the garage switch comes back on, with nothing written to the card', async () => {
    const w = await world();
    const before = await row(w.elena.id);
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: w.garage.id },
    });
    await prisma.garage.update({
      data: { teamOnProfile: true },
      where: { id: w.garage.id },
    });

    const res = await list(w);

    expect(byName(res.body, 'Elena')?.shown).toBe(true);
    expect(await row(w.elena.id)).toEqual(before);
  });
});
