import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import { MAINTENANCE, type Maintenance } from '../../../auth/maintenance';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';
import { PlatformRulesModule } from '../platform-rules.module';

const redisUrl = redisUrlFor(14);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;

const maintenanceOff = async () => {
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: false },
    where: { key: 'maintenance_mode' },
  });
  await app.get<Maintenance>(MAINTENANCE, { strict: false }).set(false);
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      PlatformRulesModule.register({ production: false }),
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
  await maintenanceOff();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await maintenanceOff();
});

const status = () => request(app.getHttpServer()).get('/platform-status');

async function switchTo(id: string, value: boolean) {
  const res = await request(app.getHttpServer())
    .patch('/admin/platform-rules/maintenance_mode')
    .set(
      'Authorization',
      `Bearer ${signAccessToken({ accountId: id, role: 'admin' }, tokenSecret)}`,
    )
    .send({ seen: !value, value });
  expect(res.status).toBe(200);
}

describe('GET /platform-status', () => {
  it('answers a visitor the platform state, never cached', async () => {
    const res = await status();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maintenance: false });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('follows a switch on the very next call, and answers while maintenance is on', async () => {
    const admin = await account('Ioana Popa', ['admin']);
    await switchTo(admin, true);
    const on = await status();

    expect(on.status).toBe(200);
    expect(on.body).toEqual({ maintenance: true });

    await switchTo(admin, false);
    expect((await status()).body).toEqual({ maintenance: false });
  });
});
