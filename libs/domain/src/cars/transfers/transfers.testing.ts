import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CarTransfersModule } from './transfers.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { localDay } from '../../bucharest';
import { outboxMark } from '../../events/outbox.testing';
import type { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { DirectSendModule } from '../../notifications/direct-send/direct-send.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { CarHistoryModule } from '../history/history.module';
import { CarsModule } from '../my-cars/cars/cars.module';

export const WEB_URL = 'https://motorfix.example';
const tokenSecret = 'test-secret';

// The app with the cars, their transfers and their history, WhatsApp through
// the direct-send worker and `brevo` with both languages' transfer templates
// named and every +407 number allowed.
export async function transfersApp(brevo: BrevoMock) {
  const redisUrl = redisUrlFor(15);
  // The worker's WhatsApp configuration, which a test may change.
  const sending = {
    config: testPhoneConfig({
      PHONE_ALLOWLIST: '+407*',
      WHATSAPP_TEMPLATES:
        'motorfix_car_transfer_link_ro=41,motorfix_car_transfer_link_en=42',
    }),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl,
        tokenSecret,
      }),
      CarHistoryModule,
      CarsModule,
      CarTransfersModule.register(WEB_URL, DirectSendModule.register(redisUrl)),
      DirectSendModule.registerWorker({
        email: testConfig(brevo.url),
        phone: sending.config,
        redisUrl,
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  const asBuilt = { ...sending.config };
  return {
    app,
    // Puts back the sending configuration a test changed.
    restore: () => Object.assign(sending.config, asBuilt),
    sending,
  };
}

// The rows a transfer test reads and writes, on the shared test database.
export function transfersWorld() {
  const { account, prisma, reset } = fixtures();
  const world = quotesWorld(prisma);

  async function driver(
    name = 'andrei',
    options: { phone?: string; language?: 'ro' | 'en' } = {},
  ) {
    const id = await account(name, ['driver'], { language: options.language });
    if (options.phone) {
      await prisma.account.update({
        data: { phone: options.phone, phoneVerifiedAt: new Date() },
        where: { id },
      });
    }
    return { auth: bearer(id, 'driver'), id };
  }

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

  // A repair the owner logged by hand, done `daysAgo` days ago.
  async function logged(
    carId: string,
    options: { daysAgo?: number; what?: string; deleted?: boolean } = {},
  ) {
    return prisma.repair.create({
      data: {
        carId,
        deletedAt: options.deleted ? new Date() : null,
        doneOn: new Date(
          `${localDay(new Date(Date.now() - (options.daysAgo ?? 30) * 86_400_000))}T00:00:00Z`,
        ),
        garageName: 'Service Popescu',
        source: 'logged',
        what: options.what ?? 'Plăcuțe frână față',
      },
    });
  }

  // A repair done through MotorFix: a request on the car, quoted, booked and
  // worked on by a garage.
  async function throughMotorFix(driverId: string, carId: string) {
    const garage = await world.garage('Garajul Ion');
    const req = await world.request(driverId, { carId, status: 'done' });
    const quote = await world.quote(req.id, garage.id, 'accepted');
    const booking = await world.booking(quote.id, 'completed');
    const job = await world.job(booking.id, 'done');
    return prisma.repair.create({
      data: {
        carId,
        doneOn: new Date(`${localDay(new Date())}T00:00:00Z`),
        garageId: garage.id,
        garageName: garage.name,
        jobId: job.id,
        source: 'motorfix',
        what: 'Schimb ulei',
      },
    });
  }

  // The newest outbox row and the database's clock now: what a test writes
  // afterwards is above the one and after the other.
  async function marks() {
    const [{ now }] = await prisma.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return { mark: await outboxMark(prisma), since: now };
  }

  const transferEvents = (mark: bigint) =>
    prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: { id: { gt: mark }, kind: { startsWith: 'car_transfer.' } },
    });

  // The car's ownership rows, oldest first.
  const ownerships = (carId: string) =>
    prisma.carOwnership.findMany({
      orderBy: [{ openedAt: 'asc' }],
      where: { carId },
    });

  const transferAudit = (since: Date) =>
    prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { at: { gte: since }, subjectType: 'car_transfer' },
    });

  return {
    account,
    bearer,
    car: world.car,
    driver,
    logged,
    marks,
    ownerships,
    prisma,
    request: world.request,
    reset,
    throughMotorFix,
    transferAudit,
    transferEvents,
  };
}

// Sends a transfer through the API.
export const sendTransfer = (
  app: NestExpressApplication,
  auth: string,
  carId: string,
  body: Record<string, unknown>,
) =>
  request(app.getHttpServer())
    .post(`/cars/${carId}/transfers`)
    .set('Authorization', auth)
    .send(body);

// The token at the end of a transfer link.
export const tokenOf = (link: string) => link.split('/').at(-1) ?? '';

// Takes a transfer over through the API, as the account `auth` names.
export const acceptTransfer = (
  app: NestExpressApplication,
  auth: string | null,
  token: string,
) => {
  const call = request(app.getHttpServer()).post(
    `/car-transfers/${token}/accept`,
  );
  return auth ? call.set('Authorization', auth) : call;
};
