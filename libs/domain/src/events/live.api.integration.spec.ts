import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { EventsModule } from './events.module';
import { LIVE_CHANNEL } from './live.hub';
import { OutboxRelayModule } from './outbox-relay.module';
import { AuditService } from '../audit/audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

async function boot(redis = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      EventsModule.register({ redisUrl: redis }),
      // Each copy runs a relay, as the worker does beside the API.
      OutboxRelayModule.register({ databaseUrl, redisUrl: redis }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(0);
  return app;
}

let app: INestApplication;
let second: INestApplication;
const opened: IncomingMessage[] = [];

beforeAll(async () => {
  app = await boot();
  second = await boot();
});

afterAll(async () => {
  for (const res of opened) res.destroy();
  await app.close();
  await second.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_event, account, garage CASCADE',
  );
});

afterEach(() => {
  for (const res of opened.splice(0)) res.destroy();
});

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${name}-subject` },
    name,
    roles,
  });
  return id;
}

const token = (accountId: string, role: Role, minutes = 15) =>
  signAccessToken({ accountId, role }, tokenSecret, Date.now(), minutes);

interface Message {
  event: string;
  data: Record<string, unknown>;
}

// Opens the stream and collects what arrives, so a test can wait for a kind.
function stream(target: INestApplication, auth?: string) {
  const { port } = target.getHttpServer().address() as AddressInfo;
  return new Promise<{
    res: IncomingMessage;
    body: string;
    messages: Message[];
    next: (kind: string, ms?: number) => Promise<Message>;
    ended: Promise<void>;
  }>((resolve, reject) => {
    const req = get(
      {
        headers: auth ? { Authorization: auth } : {},
        host: '127.0.0.1',
        path: '/live',
        port,
      },
      (res) => {
        opened.push(res);
        const out = {
          body: '',
          ended: new Promise<void>((done) => res.on('close', () => done())),
          messages: [] as Message[],
          next: (kind: string, ms = 2_000) =>
            new Promise<Message>((ok, fail) => {
              const seen = () => out.messages.find((m) => m.event === kind);
              const found = seen();
              if (found) return ok(found);
              const timer = setTimeout(
                () => fail(new Error(`no ${kind} within ${ms} ms`)),
                ms,
              );
              res.on('data', () => {
                const m = seen();
                if (m) {
                  clearTimeout(timer);
                  ok(m);
                }
              });
            }),
          res,
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          out.body += chunk;
          const blocks = out.body.split('\n\n');
          out.messages = blocks
            .filter((b) => b.startsWith('event:'))
            .map((b) => {
              const [event, data] = b.split('\n');
              return {
                data: JSON.parse((data ?? '').replace(/^data: /, '')),
                event: (event ?? '').replace(/^event: /, ''),
              };
            });
        });
        resolve(out);
      },
    );
    req.on('error', reject);
  });
}

const sendTest = (accountId: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .post('/admin/live/test')
    .send({ accountId });
  return auth ? call.set('Authorization', auth) : call;
};

async function garageWith(
  members: { accountId: string; role: 'owner' | 'receptionist' }[],
) {
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `atelier-${randomUUID()}` },
  });
  for (const m of members) {
    await prisma.garageMember.create({
      data: { accountId: m.accountId, garageId: garage.id, role: m.role },
    });
  }
  return garage.id;
}

describe('the live stream', () => {
  it('opens a server-sent events stream for a signed-in driver and greets it with hello', async () => {
    const driver = await account('Andrei', ['driver']);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);

    expect(live.res.statusCode).toBe(200);
    expect(live.res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(live.res.headers['cache-control']).toBe('no-cache');
    expect(live.res.headers['x-accel-buffering']).toBe('no');
    const hello = await live.next('hello');
    expect(hello.data).toEqual({
      at: expect.any(String),
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: 'hello',
    });
    expect(live.messages[0]?.event).toBe('hello');
  });

  it('answers 401 and opens no stream without a valid access token', async () => {
    const driver = await account('Andrei', ['driver']);

    for (const auth of [
      undefined,
      'Bearer not-a-token',
      `Bearer ${signAccessToken({ accountId: driver, role: 'driver' }, 'other-secret')}`,
      `Bearer ${token(driver, 'driver', -1)}`,
    ]) {
      const live = await stream(app, auth);
      expect(live.res.statusCode).toBe(401);
      expect(live.res.headers['content-type']).not.toMatch(/event-stream/);
    }
  });

  it('never takes the token from the address', async () => {
    const driver = await account('Andrei', ['driver']);
    const { port } = app.getHttpServer().address() as AddressInfo;

    const status = await new Promise<number | undefined>((ok) =>
      get(
        `http://127.0.0.1:${port}/live?access_token=${token(driver, 'driver')}`,
        (res) => {
          opened.push(res);
          ok(res.statusCode);
        },
      ),
    );

    expect(status).toBe(401);
  });

  it('answers 403 to a suspended account', async () => {
    const driver = await account('Andrei', ['driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: driver },
    });

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);

    expect(live.res.statusCode).toBe(403);
  });
});

describe('the admin test update', () => {
  it('reaches the target on every open stream within two seconds, once each', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const phone = await stream(app, `Bearer ${token(driver, 'driver')}`);
    const laptop = await stream(second, `Bearer ${token(driver, 'driver')}`);
    await phone.next('hello');
    await laptop.next('hello');

    const started = Date.now();
    const res = await sendTest(driver, `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBe(202);
    const [a, b] = await Promise.all([
      phone.next('live.test'),
      laptop.next('live.test'),
    ]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(a.data).toEqual({
      at: expect.any(String),
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: 'live.test',
    });
    expect(a.data['id']).not.toBe(driver);
    expect(b.data['id']).toBe(a.data['id']);
    await new Promise((r) => setTimeout(r, 200));
    for (const live of [phone, laptop]) {
      expect(live.messages.filter((m) => m.event === 'live.test')).toHaveLength(
        1,
      );
    }
  });

  it('reaches the dashboard of each role and nobody else', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const owner = await account('Ion', ['garage']);
    const receptionist = await account('Maria', ['receptionist']);
    const mechanic = await account('Vlad', ['mechanic']);
    const garageId = await garageWith([
      { accountId: owner, role: 'owner' },
      { accountId: receptionist, role: 'receptionist' },
    ]);
    await prisma.mechanic.create({
      data: { accountId: mechanic, garageId, name: 'Mecanic' },
    });
    const people: [string, Role][] = [
      [driver, 'driver'],
      [owner, 'garage'],
      [receptionist, 'receptionist'],
      [mechanic, 'mechanic'],
      [admin, 'admin'],
    ];
    const streams = await Promise.all(
      people.map(([id, role]) => stream(app, `Bearer ${token(id, role)}`)),
    );
    await Promise.all(streams.map((s) => s.next('hello')));

    for (const [index, [id]] of people.entries()) {
      await sendTest(id, `Bearer ${token(admin, 'admin')}`).expect(202);
      await streams[index]?.next('live.test');
    }
    await new Promise((r) => setTimeout(r, 200));

    for (const live of streams) {
      expect(live.messages.filter((m) => m.event === 'live.test')).toHaveLength(
        1,
      );
    }
  });

  it('answers 404 to a driver, a garage owner, a receptionist and a mechanic, and sends nothing', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');
    const owner = await account('Ion', ['garage']);
    const receptionist = await account('Maria', ['receptionist']);
    const mechanic = await account('Vlad', ['mechanic']);
    const garageId = await garageWith([
      { accountId: owner, role: 'owner' },
      { accountId: receptionist, role: 'receptionist' },
    ]);
    await prisma.mechanic.create({
      data: { accountId: mechanic, garageId, name: 'Mecanic' },
    });

    for (const [id, role] of [
      [driver, 'driver'],
      [owner, 'garage'],
      [receptionist, 'receptionist'],
      [mechanic, 'mechanic'],
    ] as [string, Role][]) {
      const res = await sendTest(driver, `Bearer ${token(id, role)}`);
      expect(res.status).toBe(404);
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(live.messages.map((m) => m.event)).toEqual(['hello']);
  });

  it('records who sent it, to whom, with the update it queued', async () => {
    const admin = await account('Ana', ['admin']);
    const driver = await account('Andrei', ['driver']);

    const res = await sendTest(driver, `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBe(202);
    const entries = await prisma.activityLog.findMany({
      where: { actorId: admin, kind: 'live.test' },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'create',
        actorName: 'Ana',
        actorRole: 'admin',
        kind: 'live.test',
        newValue: { accountId: driver },
        oldValue: null,
        subjectId: driver,
        subjectType: 'account',
        viaAssistant: false,
      }),
    ]);
    expect(
      await prisma.outboxEvent.count({ where: { kind: 'live.test' } }),
    ).toBe(1);
  });

  it.each([
    ['an account that does not exist', () => randomUUID()],
    ['an account id that is not a uuid', () => 'andrei'],
  ])('records nothing for %s', async (_, target) => {
    const admin = await account('Ana', ['admin']);

    const res = await sendTest(target(), `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.activityLog.count({
        where: { actorId: admin, kind: 'live.test' },
      }),
    ).toBe(0);
  });

  it('answers 404, not 400, to a non-admin whose body is invalid', async () => {
    const driver = await account('Andrei', ['driver']);

    const res = await sendTest('andrei', `Bearer ${token(driver, 'driver')}`);

    expect(res.status).toBe(404);
  });

  it('answers 401 without a token', async () => {
    const driver = await account('Andrei', ['driver']);

    const res = await sendTest(driver);

    expect(res.status).toBe(401);
  });

  it('answers 404 for an account that does not exist', async () => {
    const admin = await account('Admin', ['admin']);

    const res = await sendTest(randomUUID(), `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBe(404);
  });

  it.each([
    ['not a uuid', 'andrei'],
    ['missing', undefined],
    ['a number', 7],
  ])('answers 400 to an account id that is %s', async (_, accountId) => {
    const admin = await account('Admin', ['admin']);

    const res = await sendTest(accountId, `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBe(400);
  });
});

describe('the fan-out across API copies', () => {
  it('forwards a published event only to the streams in its audience, once each', async () => {
    const driver = await account('Andrei', ['driver']);
    const other = await account('Elena', ['driver']);
    const mine = await stream(app, `Bearer ${token(driver, 'driver')}`);
    const theirs = await stream(second, `Bearer ${token(other, 'driver')}`);
    await mine.next('hello');
    await theirs.next('hello');
    const publisher = new Redis(redisUrl);

    await publisher.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience: [`account:${driver}`],
        event: {
          at: new Date().toISOString(),
          id: randomUUID(),
          kind: 'live.test',
        },
      }),
    );
    await mine.next('live.test');
    await publisher.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience: ['system'],
        event: { at: 'x', id: 'y', kind: 'system.ping' },
      }),
    );
    await Promise.all([mine.next('system.ping'), theirs.next('system.ping')]);
    publisher.disconnect();

    expect(theirs.messages.map((m) => m.event)).toEqual([
      'hello',
      'system.ping',
    ]);
    expect(mine.messages.map((m) => m.event)).toEqual([
      'hello',
      'live.test',
      'system.ping',
    ]);
  });

  it('keeps a stream open after a malformed fan-out message', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');
    const publisher = new Redis(redisUrl);

    await publisher.publish(LIVE_CHANNEL, '{not json');
    await publisher.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience: [`account:${driver}`],
        event: {
          at: new Date().toISOString(),
          id: randomUUID(),
          kind: 'live.test',
        },
      }),
    );
    publisher.disconnect();

    await live.next('live.test');
    expect(live.res.destroyed).toBe(false);
  });
});

describe('a copy whose Redis does not answer', () => {
  let deaf: INestApplication;

  beforeAll(async () => {
    deaf = await boot('redis://127.0.0.1:1');
  });

  afterAll(async () => {
    await deaf.close();
  });

  it('still opens a stream with hello and records the test update in the outbox', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);

    const live = await stream(deaf, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');
    const res = await request(deaf.getHttpServer())
      .post('/admin/live/test')
      .set('Authorization', `Bearer ${token(admin, 'admin')}`)
      .send({ accountId: driver });

    expect(live.res.statusCode).toBe(200);
    expect(res.status).toBe(202);
    expect(
      await prisma.outboxEvent.findMany({
        select: { audience: true, kind: true },
      }),
    ).toEqual([{ audience: [`account:${driver}`], kind: 'live.test' }]);
  });
});

describe('the end of a stream', () => {
  it('says bye with reason expired when the access token expires', async () => {
    const driver = await account('Andrei', ['driver']);
    const shortLived = signAccessToken(
      { accountId: driver, role: 'driver' },
      tokenSecret,
      Date.now() - 15 * 60_000 + 1_000,
    );

    const live = await stream(app, `Bearer ${shortLived}`);
    const bye = await live.next('bye', 3_000);
    await live.ended;

    expect(bye.data).toMatchObject({ kind: 'bye', reason: 'expired' });
  });

  it('says bye with reason shutdown when the copy shuts down', async () => {
    const leaving = await boot();
    const driver = await account('Andrei', ['driver']);
    const live = await stream(leaving, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await leaving.close();
    await live.ended;

    expect(live.messages.at(-1)).toMatchObject({
      data: { kind: 'bye', reason: 'shutdown' },
      event: 'bye',
    });
  });
});

describe('who gets an event at a garage', () => {
  const fanOut = async (
    audience: string[],
    kind: string,
    id: string = randomUUID(),
  ) => {
    const publisher = new Redis(redisUrl);
    await publisher.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience,
        event: { at: new Date().toISOString(), id, kind },
      }),
    );
    publisher.disconnect();
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const seen = (live: { messages: Message[] }) =>
    live.messages.map((m) => m.event).filter((k) => k !== 'hello');

  async function team() {
    const owner = await account('Ion', ['garage']);
    const receptionist = await account('Maria', ['receptionist']);
    const elena = await account('Elena', ['mechanic']);
    const mihai = await account('Mihai', ['mechanic']);
    const garageId = await garageWith([
      { accountId: owner, role: 'owner' },
      { accountId: receptionist, role: 'receptionist' },
    ]);
    await prisma.mechanic.create({
      data: {
        accountId: elena,
        canAnswerQuotes: false,
        garageId,
        name: 'Mecanic',
      },
    });
    const mechanic = await prisma.mechanic.create({
      data: {
        accountId: mihai,
        canAnswerQuotes: true,
        garageId,
        name: 'Mecanic',
      },
    });
    const people = [
      [owner, 'garage'],
      [receptionist, 'receptionist'],
      [elena, 'mechanic'],
      [mihai, 'mechanic'],
    ] as const;
    const live = [];
    for (const [id, role] of people) {
      const s = await stream(app, `Bearer ${token(id, role)}`);
      await s.next('hello');
      live.push(s);
    }
    const [ownerLive, deskLive, elenaLive, mihaiLive] = live;
    if (!ownerLive || !deskLive || !elenaLive || !mihaiLive) throw new Error();
    return {
      deskLive,
      elenaLive,
      garageId,
      mechanicId: mechanic.id,
      mihaiLive,
      ownerLive,
      receptionist,
    };
  }

  it('gives each staff role only the kinds its role and rights allow', async () => {
    const { deskLive, elenaLive, garageId, mechanicId, mihaiLive, ownerLive } =
      await team();

    await fanOut([`garage:${garageId}`], 'request.created');
    await fanOut([`garage:${garageId}`], 'price_list.updated');
    await fanOut(
      [`garage:${garageId}`, `mechanic:${mechanicId}`],
      'job.updated',
    );
    await settle();

    expect(seen(ownerLive)).toEqual([
      'request.created',
      'price_list.updated',
      'job.updated',
    ]);
    expect(seen(deskLive)).toEqual(['request.created', 'job.updated']);
    expect(seen(elenaLive)).toEqual([]);
    expect(seen(mihaiLive)).toEqual(['request.created', 'job.updated']);
  });

  it('forwards no media event to the staff of a garage with live media off', async () => {
    const { garageId, ownerLive } = await team();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId, key: 'live_media' },
    });

    await fanOut([`garage:${garageId}`], 'media.added');
    await fanOut([`garage:${garageId}`], 'request.created');
    await settle();

    expect(seen(ownerLive)).toEqual(['request.created']);
  });

  it('takes a removed member off the garage at once', async () => {
    const { deskLive, garageId, ownerLive, receptionist } = await team();
    await fanOut([`garage:${garageId}`], 'member.removed', receptionist);
    await fanOut([`garage:${garageId}`], 'request.created');
    await settle();

    expect(seen(deskLive)).toEqual([]);
    expect(seen(ownerLive)).toEqual(['member.removed', 'request.created']);
  });

  it('ends the streams of a suspended account with bye evicted', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await fanOut([`account:${driver}`], 'account.suspended', driver);
    await live.ended;

    expect(live.messages.at(-1)).toMatchObject({
      data: { kind: 'bye', reason: 'evicted' },
    });
  });
});
