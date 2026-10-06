import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditService } from './audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';

// Boots the auth module over HTTP for a whole spec file, with an empty
// database before each case, and returns the helpers that call
// GET /audit-history.
export function auditHistoryApp() {
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const tokenSecret = 'test-secret';
  const prisma = createPrisma(databaseUrl);
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);
  serialDatabase(databaseUrl);

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  });

  async function account(name: string, roles: Role[]) {
    const { id } = await accounts.createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${name}-${randomUUID()}` },
      name,
      roles,
    });
    return id;
  }

  const bearer = (accountId: string, role: Role) =>
    `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

  const http = () => request(app.getHttpServer());

  // A string is sent as the raw query, so malformed input reaches the API
  // as written.
  const get = (query: string | Record<string, string> = {}, auth?: string) => {
    const call = http().get(
      typeof query === 'string' ? `/audit-history?${query}` : '/audit-history',
    );
    if (typeof query !== 'string') call.query(query);
    return auth ? call.set('Authorization', auth) : call;
  };

  return { account, bearer, get, http, prisma };
}
