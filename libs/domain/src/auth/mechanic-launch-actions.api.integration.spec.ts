// @traces 1381-FR-001 1381-FR-003
// @traces 1381-FR-004 1381-FR-005 1381-FR-008
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AuthModule } from './auth.module';
import { serialDatabase } from './serial-db.testing';
import { GaragesModule } from '../garages/garages.module';
import { GarageFiguresService } from '../insights/garage-figures/garage-figures.service';
import { BrevoMock } from '../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';
import { QuotesModule } from '../quotes/quotes.module';
import { garageActor, quotesWorld } from '../quotes/quotes.testing';
import { UNUSED_STORAGE } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { WorkshopModule } from '../workshop/workshop.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const HOUR = 3_600_000;
const world = quotesWorld();
const { prisma } = world;
const figures = new GarageFiguresService(prisma);
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: INestApplication;

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
      QuotesModule,
      WorkshopModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
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
  await app?.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(() => world.reset());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const call = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  auth: string,
  body?: object,
) => {
  const req = request(app.getHttpServer())
    [method](path)
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID());
  return body ? req.send(body) : req;
};

const ALL = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

// Atelier Dinamo with its owner, a mechanic who may answer quotes, one who
// may not, and a driver's request waiting on the garage's answer.
async function garage() {
  const garage = await world.garage('Atelier Dinamo');
  const owner = await world.account('Mihai Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const answering = await world.account('Elena Fixer', ['mechanic']);
  const answeringCard = await prisma.mechanic.create({
    data: {
      accountId: answering,
      canAnswerQuotes: true,
      garageId: garage.id,
      name: 'Elena',
    },
  });
  const plain = await world.account('Costel Hand', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: plain, garageId: garage.id, name: 'Costel' },
  });
  const driver = await world.account('Andrei Ion Marin');
  const asked = await world.request(driver);
  await world.recipient(asked.id, garage.id, 'waiting', owner);
  return {
    answering,
    answeringCard,
    asked,
    garage,
    owner,
    plain,
  };
}

type Garage = Awaited<ReturnType<typeof garage>>;

const sendQuote = (g: Garage, auth: string) =>
  call('post', '/quotes', auth, {
    durationMinutes: 120,
    fromLei: 650,
    requestId: g.asked.id,
    slot: new Date(Date.now() + 48 * HOUR).toISOString(),
    toLei: 800,
  });

const decline = (g: Garage, auth: string) =>
  call('post', `/garage/requests/${g.asked.id}/decline`, auth, {
    reason: 'fully_booked',
  });

describe('a removed mechanic', () => {
  it('loses the garage on her first account read after the owner removes her, and every garage read answers 404', async () => {
    const g = await garage();
    const elena = bearer(g.answering, 'mechanic');
    expect((await call('get', '/me', elena)).body.garageAccess).toHaveLength(1);

    const removed = await call(
      'delete',
      `/garages/${g.garage.id}/mechanics/${g.answeringCard.id}`,
      bearer(g.owner, 'garage'),
    );

    expect(removed.status).toBeLessThan(300);
    const me = await call('get', '/me', elena);
    expect(me.status).toBe(200);
    expect(me.body.garageAccess).toEqual([]);
    expect((await call('get', '/garage/jobs', elena)).status).toBe(404);
    expect((await call('get', '/garage/requests', elena)).status).toBe(404);
  });

  it('answers 404 under the garage for a removed card that still holds its account', async () => {
    const g = await garage();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: g.answeringCard.id },
    });
    const elena = bearer(g.answering, 'mechanic');

    expect((await call('get', '/me', elena)).body.garageAccess).toEqual([]);
    expect((await call('get', '/garage/jobs', elena)).status).toBe(404);
  });
});

describe('the quote actions, only with the right to answer quotes', () => {
  it('lets the mechanic who may answer quotes read the inbox, send a quote and decline', async () => {
    const g = await garage();
    const elena = bearer(g.answering, 'mechanic');

    expect((await call('get', '/garage/requests', elena)).status).toBe(200);
    expect((await sendQuote(g, elena)).status).toBe(201);

    const other = await garage();
    expect(
      (await decline(other, bearer(other.answering, 'mechanic'))).status,
    ).toBeLessThan(300);
  });

  it('answers 403 to the mechanic who may not, on each of them', async () => {
    const g = await garage();
    const costel = bearer(g.plain, 'mechanic');

    expect((await call('get', '/garage/requests', costel)).status).toBe(403);
    expect((await sendQuote(g, costel)).status).toBe(403);
    expect((await decline(g, costel)).status).toBe(403);
    expect(await prisma.quote.count({ where: { requestId: g.asked.id } })).toBe(
      0,
    );
  });

  it('refuses the very next call once the right is unticked, on the same session', async () => {
    const g = await garage();
    const elena = bearer(g.answering, 'mechanic');
    expect((await call('get', '/garage/requests', elena)).status).toBe(200);

    // No route writes a card's permissions today; the row is what each
    // call reads.
    await prisma.mechanic.update({
      data: { canAnswerQuotes: false },
      where: { id: g.answeringCard.id },
    });

    expect((await call('get', '/garage/requests', elena)).status).toBe(403);
  });
});

describe('the owner’s actions, never a mechanic’s', () => {
  it('answers 403 to a mechanic holding every permission, and to one holding none', async () => {
    const g = await garage();
    await prisma.mechanic.update({
      data: ALL,
      where: { id: g.answeringCard.id },
    });
    const elena = bearer(g.answering, 'mechanic');
    const waiting = await world.booked(
      g.garage.id,
      new Date(Date.now() + 48 * HOUR).toISOString(),
      'awaiting_confirmation',
    );
    const oil = await world.jobType('Schimb ulei');
    const at = `/garages/${g.garage.id}`;

    // The plain mechanic holds none of the three permissions.
    for (const who of [elena, bearer(g.plain, 'mechanic')]) {
      const answers = {
        confirm: await call('post', `/bookings/${waiting.id}/confirm`, who, {
          mechanicId: g.answeringCard.id,
        }),
        confirmOptions: await call(
          'get',
          `/bookings/${waiting.id}/confirm-options`,
          who,
        ),
        feature: await call('put', `${at}/features/team_mechanics`, who, {
          enabled: false,
        }),
        prices: await call('get', `${at}/prices`, who),
        priceWrite: await call('post', `${at}/prices`, who, {
          durationMinutes: 45,
          fromBani: 28_000,
          jobTypeId: oil.id,
          toBani: 36_000,
        }),
        settings: await call('patch', at, who, {
          paymentMethods: { card: true, cash: true, transfer: false },
        }),
        team: await call('get', `${at}/members`, who),
      };

      for (const [action, res] of Object.entries(answers)) {
        expect([action, res.status]).toEqual([action, 403]);
      }
    }
    await expect(
      figures.get(
        garageActor(g.answering, g.garage.id, 'mechanic', ALL),
        {},
        new Date(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: waiting.id } }))
        .status,
    ).toBe('awaiting_confirmation');
  });
});
