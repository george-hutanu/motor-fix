import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { LIVE_CHANNEL } from './live.hub';
import { AuditService } from '../../audit/audit.service';
import { signAccessToken } from '../../auth/access-token';
import { AccountsService } from '../../auth/accounts.service';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { createPrisma } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { timersArmedBy, until } from '../../waits.testing';
import { noEvents } from '../event.port';
import { EventsModule } from '../events.module';
import { OutboxRelayModule } from '../outbox-relay/outbox-relay.module';

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
  id?: string;
}

// Opens the stream and collects what arrives, so a test can wait for a kind.
function stream(
  target: INestApplication,
  auth?: string,
  extra: { headers?: Record<string, string>; path?: string } = {},
) {
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
        headers: { ...(auth && { Authorization: auth }), ...extra.headers },
        host: '127.0.0.1',
        path: extra.path ?? '/live',
        port,
      },
      (res) => {
        opened.push(res);
        const out = {
          body: '',
          ended: new Promise<void>((done) => res.on('close', () => done())),
          messages: [] as Message[],
          // Waits for a message of `kind`; the limit only turns a message
          // that never comes into a failure, and leaves room for a loaded
          // machine.
          next: (kind: string, ms = 15_000) =>
            new Promise<Message>((ok, fail) => {
              const seen = () => out.messages.find((m) => m.event === kind);
              const found = seen();
              if (found) return ok(found);
              const onData = () => {
                const m = seen();
                if (m) {
                  clearTimeout(timer);
                  res.off('data', onData);
                  ok(m);
                }
              };
              const timer = setTimeout(() => {
                res.off('data', onData);
                fail(new Error(`no ${kind} within ${ms} ms`));
              }, ms);
              res.on('data', onData);
            }),
          res,
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          out.body += chunk;
          const blocks = out.body.split('\n\n');
          // The last block may still be arriving.
          out.messages = blocks.slice(0, -1).flatMap((b) => {
            const lines = new Map(
              b
                .split('\n')
                .map((l) => [
                  l.slice(0, l.indexOf(':')),
                  l.slice(l.indexOf(':') + 2),
                ]),
            );
            const event = lines.get('event');
            if (event === undefined) return [];
            const id = lines.get('id');
            return [
              {
                data: JSON.parse(lines.get('data') ?? 'null'),
                event,
                ...(id !== undefined && { id }),
              },
            ];
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
    expect(live.res.headers['cache-control']).toBe('no-cache, no-transform');
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
  // @traces 976-FR-002 976-FR-004
  it('reaches the target on every open stream within two seconds, once each', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const phone = await stream(app, `Bearer ${token(driver, 'driver')}`);
    const laptop = await stream(second, `Bearer ${token(driver, 'driver')}`);
    await phone.next('hello');
    await laptop.next('hello');

    const {
      log,
      value: [res, a, b],
    } = await timersArmedBy('outbox-relay.ts', async (log) => {
      const sent = await sendTest(driver, `Bearer ${token(admin, 'admin')}`);
      // The wait is long enough for a loaded machine; the two seconds are
      // proved by the relay's timers below.
      const heard = await Promise.all([
        phone.next('live.test'),
        laptop.next('live.test'),
      ]);
      await until('the relay to poll again', () => log.length > 0);
      return [sent, ...heard] as const;
    });

    expect(res.status).toBe(202);
    // Within two seconds: the only wait between the message and the streams
    // is the relay's poll, a fifth of a second; the hub forwards at once.
    expect(log.every((entry) => entry.endsWith(' 200'))).toBe(true);
    expect(a.data).toEqual({
      at: expect.any(String),
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: 'live.test',
    });
    expect(a.data['id']).not.toBe(driver);
    expect(b.data['id']).toBe(a.data['id']);
    // Long enough for a wrong message to arrive.
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
    // Long enough for a wrong message to arrive.
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
    // Long enough for a wrong message to arrive.
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
    const bye = await live.next('bye');
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
  // An absence window, after the wait for what did arrive: long enough for
  // a wrong message to arrive. Never a wait for work.
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
    await until(
      'every staff stream to hear its kinds',
      () =>
        seen(ownerLive).length >= 3 &&
        seen(deskLive).length >= 2 &&
        seen(mihaiLive).length >= 2,
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
    await until('the request to arrive', () =>
      seen(ownerLive).includes('request.created'),
    );
    await settle();

    expect(seen(ownerLive)).toEqual(['request.created']);
  });

  it('takes a removed member off the garage at once', async () => {
    const { deskLive, garageId, ownerLive, receptionist } = await team();
    await fanOut([`garage:${garageId}`], 'member.removed', receptionist);
    await fanOut([`garage:${garageId}`], 'request.created');
    await until('the owner to hear both', () => seen(ownerLive).length >= 2);
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

// A bell row as the notifications use case writes it: the position comes
// from the database, the account's count moves with it.
async function bellRow(accountId: string, at = new Date()) {
  const [row] = await prisma.$transaction([
    prisma.notification.create({
      data: {
        accountId,
        channel: 'in_app',
        createdAt: at,
        eventId: randomUUID(),
        kind: 'TEST_MESSAGE',
        params: {},
        sentAt: at,
        status: 'sent',
      },
    }),
    prisma.account.update({
      data: { unreadCount: { increment: 1 } },
      where: { id: accountId },
    }),
  ]);
  return row;
}

const settle = () => new Promise((r) => setTimeout(r, 300));
const created = (live: { messages: Message[] }) =>
  live.messages.filter((m) => m.event === 'notification.created');

// @traces 1190-FR-002
// @traces 1190-FR-003
// @traces 1190-FR-004
describe('a stream that comes back', () => {
  it('replays the rows it missed in order, each with its position and the count, before newer live events', async () => {
    const driver = await account('Andrei', ['driver']);
    const seen = await bellRow(driver);
    const missed = [];
    for (let i = 0; i < 5; i++) missed.push(await bellRow(driver));
    const redis = new Redis(redisUrl);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      headers: { 'Last-Event-ID': String(seen.position) },
    });
    await live.next('hello');
    await until('the replay', () => created(live).length >= 5);
    await redis.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience: [`account:${driver}`],
        event: {
          at: new Date().toISOString(),
          id: randomUUID(),
          kind: 'notification.created',
          unreadCount: 7,
        },
        position: String(missed.at(-1)!.position + 1000n),
      }),
    );
    await until('the live one', () => created(live).length >= 6);
    redis.disconnect();

    expect(created(live).slice(0, 5)).toEqual(
      missed.map((row) => ({
        data: {
          at: row.createdAt.toISOString(),
          id: row.id,
          kind: 'notification.created',
          unreadCount: 6,
        },
        event: 'notification.created',
        id: String(row.position),
      })),
    );
    expect(created(live)[5]?.data['unreadCount']).toBe(7);
  });

  it('replays at most 200 rows and then goes live', async () => {
    const driver = await account('Andrei', ['driver']);
    const first = await bellRow(driver);
    await prisma.notification.createMany({
      data: Array.from({ length: 249 }, (_, i) => ({
        accountId: driver,
        channel: 'in_app' as const,
        createdAt: new Date(Date.now() + i),
        eventId: randomUUID(),
        kind: 'TEST_MESSAGE',
        params: {},
        status: 'sent' as const,
      })),
    });

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      path: `/live?since=${first.position}`,
    });
    await live.next('hello');
    await until('the replay', () => created(live).length >= 200);
    await settle();

    const ids = created(live).map((m) => BigInt(m.id ?? '0'));
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBeGreaterThan(first.position);
    expect([...ids].sort((a, b) => (a < b ? -1 : 1))).toEqual(ids);
    expect(live.res.complete).toBe(false);
  });

  it('takes the header over the query', async () => {
    const driver = await account('Andrei', ['driver']);
    const a = await bellRow(driver);
    const b = await bellRow(driver);
    await bellRow(driver);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      headers: { 'Last-Event-ID': String(b.position) },
      path: `/live?since=${a.position}`,
    });
    await live.next('hello');
    await until('the replay', () => created(live).length >= 1);
    await settle();

    expect(created(live)).toHaveLength(1);
  });

  it.each([
    ['no position', {}],
    [
      'a position that is not a number',
      { headers: { 'Last-Event-ID': 'abc' } },
    ],
    ['a position of zero', { path: '/live?since=0' }],
    ['a negative position', { path: '/live?since=-5' }],
  ])('replays nothing for %s', async (_, extra) => {
    const driver = await account('Andrei', ['driver']);
    await bellRow(driver);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, extra);
    await live.next('hello');
    await settle();

    expect(created(live)).toEqual([]);
  });

  it("opens as a first stream on another account's position: what comes live still arrives", async () => {
    const driver = await account('Andrei', ['driver']);
    const other = await account('Ion', ['driver']);
    const mine = await bellRow(driver);
    const theirs = await bellRow(other);
    const redis = new Redis(redisUrl);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      headers: { 'Last-Event-ID': String(theirs.position + 1000n) },
    });
    await live.next('hello');
    await settle();
    // Below the position the client named, above the account's own rows.
    await redis.publish(
      LIVE_CHANNEL,
      JSON.stringify({
        audience: [`account:${driver}`],
        event: {
          at: new Date().toISOString(),
          id: randomUUID(),
          kind: 'notification.created',
          unreadCount: 2,
        },
        position: String(mine.position + 1n),
      }),
    );
    await until('the live one', () => created(live).length >= 1);
    redis.disconnect();

    expect(created(live).map((e) => e.id)).toEqual([
      String(mine.position + 1n),
    ]);
  });

  it("replays nothing of another account's rows", async () => {
    const driver = await account('Andrei', ['driver']);
    const other = await account('Ion', ['driver']);
    const mine = await bellRow(driver);
    await bellRow(other);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      headers: { 'Last-Event-ID': String(mine.position) },
    });
    await live.next('hello');
    await settle();

    expect(created(live)).toEqual([]);
  });
});

// @traces 1190-FR-006
describe('the limits a stream lives within', () => {
  it('tells the client to wait three seconds before it reconnects, before hello', async () => {
    const driver = await account('Andrei', ['driver']);

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    expect(live.body.startsWith('retry: 3000\n\n')).toBe(true);
  });

  it('sends a comment within 25 seconds of silence', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await until(
      'a heartbeat',
      () => live.body.includes('\n\n: ping\n\n'),
      27_000,
    );
  }, 40_000);

  it('asks the client to reconnect and ends the stream at the planned time', async () => {
    const short = await Test.createTestingModule({
      imports: [
        AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
        EventsModule.register({ reconnectAfterMs: 1500, redisUrl }),
      ],
    }).compile();
    const copy = short.createNestApplication();
    await copy.listen(0);
    try {
      const driver = await account('Andrei', ['driver']);
      const live = await stream(copy, `Bearer ${token(driver, 'driver')}`);
      const hello = await live.next('hello');

      const reconnect = await live.next('reconnect');
      await live.ended;

      expect(reconnect.data).toEqual({
        at: expect.any(String),
        id: hello.data['id'],
        kind: 'reconnect',
      });
    } finally {
      await copy.close();
    }
  });
});

// @traces 1190-FR-012
describe('nothing between the stream and the browser holds it', () => {
  it('answers both streams uncompressed, uncached and unbuffered to a client that accepts compression', async () => {
    const driver = await account('Andrei', ['driver']);
    const headers = { 'Accept-Encoding': 'gzip, br' };

    const signedIn = await stream(app, `Bearer ${token(driver, 'driver')}`, {
      headers,
    });
    const visitor = await stream(app, undefined, {
      headers,
      path: '/live/public',
    });

    for (const live of [signedIn, visitor]) {
      expect(live.res.statusCode).toBe(200);
      expect(live.res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(live.res.headers['x-accel-buffering']).toBe('no');
      expect(live.res.headers['content-encoding']).toBeUndefined();
    }
  });
});
