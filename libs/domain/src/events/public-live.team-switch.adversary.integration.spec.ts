import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { EventsModule } from './events.module';
import { OutboxRelayModule } from './outbox-relay/outbox-relay.module';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let app: INestApplication;
const opened: IncomingMessage[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl,
        tokenSecret: 'test-secret',
      }),
      EventsModule.register({ redisUrl }),
      OutboxRelayModule.register({ databaseUrl, redisUrl }),
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
  app.enableShutdownHooks();
  await app.listen(0);
});

afterAll(async () => {
  for (const res of opened) res.destroy();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_event, account, garage, brand CASCADE',
  );
});

afterEach(() => {
  for (const res of opened.splice(0)) res.destroy();
});

function stream(query: Record<string, string>) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const search = new URLSearchParams(query).toString();
  return new Promise<{
    kinds: () => string[];
    has: (k: string) => Promise<void>;
  }>((resolve, reject) => {
    const req = get(
      { host: '127.0.0.1', path: `/live/public?${search}`, port },
      (res) => {
        opened.push(res);
        let body = '';
        res.setEncoding('utf8');
        const kinds = () =>
          body
            .split('\n\n')
            .filter((b) => b.startsWith('event:'))
            .map((b) => (b.split('\n')[0] ?? '').replace(/^event: /, ''))
            .filter((k) => k !== 'hello' && k !== 'bye');
        res.on('data', (c: string) => {
          body += c;
        });
        const has = (kind: string) =>
          new Promise<void>((ok, fail) => {
            const timer = setTimeout(
              () => fail(new Error(`no ${kind}`)),
              2_000,
            );
            const check = () => {
              if (body.includes(`event: ${kind}`)) {
                clearTimeout(timer);
                ok();
              }
            };
            check();
            res.on('data', check);
          });
        resolve({ has, kinds });
      },
    );
    req.on('error', reject);
  });
}

async function shownMechanic() {
  const garage = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `atelier-${randomUUID()}`,
      status: 'approved',
    },
  });
  const { id: accountId } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `m-${randomUUID()}` },
    name: 'Elena',
    roles: ['mechanic'],
  });
  const mechanic = await prisma.mechanic.create({
    data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
  });
  return { garageId: garage.id, mechanicId: mechanic.id };
}

async function reaches(mechanicId: string, id = mechanicId) {
  const live = await stream({ mechanics: id });
  await prisma.outboxEvent.create({
    data: {
      audience: [`public:mechanic:${mechanicId}`],
      kind: 'mechanic.updated',
      payload: {},
      subjectId: mechanicId,
    },
  });
  const marker = await prisma.outboxEvent.create({
    data: {
      audience: ['system'],
      kind: 'platform_rule.changed',
      payload: {},
      subjectId: randomUUID(),
    },
  });
  await live.has('platform_rule.changed');
  void marker;
  return live.kinds().includes('mechanic.updated');
}

describe('the public live stream and the team switch', () => {
  it('joins a shown mechanic named in upper case', async () => {
    const { mechanicId } = await shownMechanic();

    expect(await reaches(mechanicId, mechanicId.toUpperCase())).toBe(true);
  });

  it('stops joining once the garage hides its team and joins again when it shows it', async () => {
    const { garageId, mechanicId } = await shownMechanic();
    const answers: boolean[] = [];

    answers.push(await reaches(mechanicId));
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: garageId },
    });
    answers.push(await reaches(mechanicId));
    await prisma.garage.update({
      data: { teamOnProfile: true },
      where: { id: garageId },
    });
    answers.push(await reaches(mechanicId));

    expect(answers).toEqual([true, false, true]);
  });

  it('stops joining a mechanic who hides themselves and one whose garage is suspended', async () => {
    const hidden = await shownMechanic();
    await prisma.mechanic.update({
      data: { onProfile: false },
      where: { id: hidden.mechanicId },
    });
    const suspended = await shownMechanic();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: suspended.garageId },
    });

    expect(await reaches(hidden.mechanicId)).toBe(false);
    expect(await reaches(suspended.mechanicId)).toBe(false);
  });

  it('stops joining a mechanic whose account was detached', async () => {
    const { mechanicId } = await shownMechanic();
    await prisma.mechanic.update({
      data: { accountId: null },
      where: { id: mechanicId },
    });

    expect(await reaches(mechanicId)).toBe(false);
  });
});
