import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { QuotesModule } from './quotes.module';
import { databaseUrl, quotesWorld } from './quotes.testing';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { WorkshopModule } from '../workshop/workshop.module';

// Boots the auth, quotes and workshop modules over HTTP for a whole spec
// file, with an empty database before each case.
export function quotesApp() {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const tokenSecret = 'test-secret';
  const world = quotesWorld();
  const { prisma } = world;
  serialDatabase(databaseUrl);

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
        QuotesModule,
        WorkshopModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // The API's own pipe options (apps/api bootstrap).
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
    await prisma.$disconnect();
  });

  beforeEach(() => world.reset());

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

  // A string query is sent as written, so malformed input reaches the API.
  const get = (path: string, auth?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return auth ? call.set('Authorization', auth) : call;
  };

  // A write, its body sent as JSON.
  const send = (
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    auth: string,
    body?: object,
    headers: Record<string, string> = {},
  ) => {
    const call = request(app.getHttpServer())
      [method](path)
      .set('Authorization', auth)
      .set(headers);
    return body ? call.send(body) : call;
  };

  // A garage with its owner, a receptionist, a mechanic who may answer
  // quotes and one who may not.
  async function team(name: string) {
    const garage = await world.garage(name);
    const owner = await world.account(`${name} Owner`, ['garage']);
    const receptionist = await world.account(`${name} Desk`, ['receptionist']);
    const answering = await world.account(`${name} Fixer`, ['mechanic']);
    const plain = await world.account(`${name} Hand`, ['mechanic']);
    await prisma.garageMember.createMany({
      data: [
        { accountId: owner, garageId: garage.id, role: 'owner' },
        { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
      ],
    });
    const answeringMechanic = await prisma.mechanic.create({
      data: {
        accountId: answering,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Fixer',
      },
    });
    const plainMechanic = await prisma.mechanic.create({
      data: { accountId: plain, garageId: garage.id, name: 'Hand' },
    });
    return {
      answering,
      answeringMechanic,
      garage,
      owner,
      plain,
      plainMechanic,
      receptionist,
    };
  }

  return { bearer, get, send, team, world };
}
