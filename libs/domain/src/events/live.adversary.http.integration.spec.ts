import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import {
  type AddressInfo,
  connect,
  createServer,
  type Server,
  type Socket,
} from 'node:net';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { EventsModule } from './events.module';
import { LIVE_CHANNEL } from './live.hub';
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
const publishers: Redis[] = [];

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
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

afterEach(() => {
  for (const res of opened.splice(0)) res.destroy();
  for (const p of publishers.splice(0)) p.disconnect();
});

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
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
          out.messages = out.body
            .split('\n\n')
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

const settle = () => new Promise((r) => setTimeout(r, 250));

const publish = async (audience: string[], kind = 'live.test') => {
  const publisher = new Redis(redisUrl);
  publishers.push(publisher);
  const id = randomUUID();
  await publisher.publish(
    LIVE_CHANNEL,
    JSON.stringify({
      audience,
      event: { at: new Date().toISOString(), id, kind },
    }),
  );
  return id;
};

const kinds = (live: { messages: Message[] }, kind: string) =>
  live.messages.filter((m) => m.event === kind);

const sendTest = (body: unknown, auth?: string, target = app) => {
  const call = request(target.getHttpServer())
    .post('/admin/live/test')
    .send(body as object);
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

describe('the live stream audiences', () => {
  it('puts each role in exactly its own channels', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const owner = await account('Ion', ['garage']);
    const receptionist = await account('Maria', ['receptionist']);
    const mechanicAccount = await account('Vlad', ['mechanic']);
    const stranger = await account('Gigi', ['garage']);
    const garageId = await garageWith([
      { accountId: owner, role: 'owner' },
      { accountId: receptionist, role: 'receptionist' },
    ]);
    const otherGarageId = await garageWith([
      { accountId: stranger, role: 'owner' },
    ]);
    const mechanic = await prisma.mechanic.create({
      data: { accountId: mechanicAccount, garageId },
    });
    const people: [string, Role][] = [
      [driver, 'driver'],
      [owner, 'garage'],
      [receptionist, 'receptionist'],
      [mechanicAccount, 'mechanic'],
      [admin, 'admin'],
      [stranger, 'garage'],
    ];
    const [d, o, r, m, a, s] = await Promise.all(
      people.map(([id, role]) => stream(app, `Bearer ${token(id, role)}`)),
    );
    for (const live of [d, o, r, m, a, s]) await live?.next('hello');

    await publish([`garage:${garageId}`], 'garage.ping');
    await publish([`mechanic:${mechanic.id}`], 'mechanic.ping');
    await publish(['admin'], 'admin.ping');
    await publish(['system'], 'system.ping');
    await publish([`garage:${otherGarageId}`], 'other.ping');
    await settle();

    const seen = (live: typeof d) =>
      (live?.messages ?? []).map((x) => x.event).sort();
    expect(seen(d)).toEqual(['hello', 'system.ping']);
    expect(seen(o)).toEqual(['garage.ping', 'hello', 'system.ping']);
    expect(seen(r)).toEqual(['garage.ping', 'hello', 'system.ping']);
    expect(seen(m)).toEqual([
      'garage.ping',
      'hello',
      'mechanic.ping',
      'system.ping',
    ]);
    expect(seen(a)).toEqual(['admin.ping', 'hello', 'system.ping']);
    expect(seen(s)).toEqual(['hello', 'other.ping', 'system.ping']);
  });

  it('uses the role in use, so an admin signed in as a driver gets no admin events', async () => {
    const both = await account('Dual', ['driver', 'admin']);
    const asDriver = await stream(app, `Bearer ${token(both, 'driver')}`);
    const asAdmin = await stream(app, `Bearer ${token(both, 'admin')}`);
    await asDriver.next('hello');
    await asAdmin.next('hello');

    await publish(['admin'], 'admin.ping');
    await asAdmin.next('admin.ping');
    await settle();

    expect(kinds(asDriver, 'admin.ping')).toHaveLength(0);
  });

  it('joins only the garage of the role in use when the account is staff at two', async () => {
    const both = await account('Ion', ['garage', 'receptionist']);
    const owned = await garageWith([{ accountId: both, role: 'owner' }]);
    const desk = await garageWith([{ accountId: both, role: 'receptionist' }]);
    const live = await stream(app, `Bearer ${token(both, 'garage')}`);
    await live.next('hello');

    await publish([`garage:${owned}`], 'owned.ping');
    await publish([`garage:${desk}`], 'desk.ping');
    await live.next('owned.ping');
    await settle();

    expect(kinds(live, 'desk.ping')).toHaveLength(0);
  });

  it('gives a driver neither a garage nor an admin channel even when asked for both', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await publish([`garage:${randomUUID()}`, 'admin', 'mechanic:x'], 'nope');
    await settle();

    expect(kinds(live, 'nope')).toHaveLength(0);
  });

  it('never reaches a different account through the account channel', async () => {
    const one = await account('Andrei', ['driver']);
    const two = await account('Elena', ['driver']);
    const a = await stream(app, `Bearer ${token(one, 'driver')}`);
    const b = await stream(second, `Bearer ${token(two, 'driver')}`);
    await a.next('hello');
    await b.next('hello');

    await publish([`account:${one}`], 'private.ping');
    await a.next('private.ping');
    await settle();

    expect(kinds(b, 'private.ping')).toHaveLength(0);
  });
});

describe('the live stream refusals', () => {
  it('answers 401 to a token for an account that does not exist', async () => {
    const live = await stream(app, `Bearer ${token(randomUUID(), 'driver')}`);

    expect(live.res.statusCode).toBe(401);
    expect(live.res.headers['content-type']).not.toMatch(/event-stream/);
  });

  it.each([
    ['an empty bearer', 'Bearer '],
    ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['a bare scheme', 'Bearer'],
    ['a ten kilobyte token', `Bearer ${'a'.repeat(10_000)}`],
  ])('answers 401 to %s and sends no stream data', async (_, auth) => {
    const live = await stream(app, auth);

    expect(live.res.statusCode).toBe(401);
    expect(live.res.headers['content-type']).not.toMatch(/event-stream/);
    await settle();
    expect(live.body).not.toContain('hello');
  });

  it('answers 403 with no stream data to a suspended account', async () => {
    const driver = await account('Andrei', ['driver']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: driver },
    });

    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await settle();

    expect(live.res.statusCode).toBe(403);
    expect(live.res.headers['content-type']).not.toMatch(/event-stream/);
    expect(live.body).not.toContain('hello');
  });

  it('opens with the role the account holds, never the admin role a token claims for a driver', async () => {
    const driver = await account('Andrei', ['driver']);

    const live = await stream(app, `Bearer ${token(driver, 'admin')}`);
    await live.next('hello');
    await publish(['admin'], 'admin.ping');
    await publish([`account:${driver}`], 'own.ping');
    await live.next('own.ping');
    await settle();

    expect(kinds(live, 'admin.ping')).toHaveLength(0);
  });
});

describe('the stream cap over HTTP', () => {
  it('closes the oldest of eleven streams with bye evicted and keeps the other ten', async () => {
    const driver = await account('Andrei', ['driver']);
    const auth = `Bearer ${token(driver, 'driver')}`;
    const streams = [];
    for (let i = 0; i < 11; i++) {
      const live = await stream(app, auth);
      await live.next('hello');
      streams.push(live);
    }

    const [oldest, ...rest] = streams;
    await oldest?.ended;
    expect(oldest?.messages.at(-1)).toMatchObject({
      data: { reason: 'evicted' },
      event: 'bye',
    });
    for (const live of rest) expect(live.res.destroyed).toBe(false);
  });

  it('counts the cap per API copy, so ten on each copy evicts nothing', async () => {
    const driver = await account('Andrei', ['driver']);
    const auth = `Bearer ${token(driver, 'driver')}`;
    const streams = [];
    for (const target of [app, second]) {
      for (let i = 0; i < 10; i++) {
        const live = await stream(target, auth);
        await live.next('hello');
        streams.push(live);
      }
    }

    await settle();

    for (const live of streams) expect(kinds(live, 'bye')).toHaveLength(0);
  });

  it('frees the slot when a client disconnects', async () => {
    const driver = await account('Andrei', ['driver']);
    const auth = `Bearer ${token(driver, 'driver')}`;
    const streams = [];
    for (let i = 0; i < 10; i++) {
      const live = await stream(app, auth);
      await live.next('hello');
      streams.push(live);
    }
    streams[0]?.res.destroy();
    await settle();

    const extra = await stream(app, auth);
    await extra.next('hello');
    await settle();

    for (const live of streams.slice(1))
      expect(kinds(live, 'bye')).toHaveLength(0);
  });
});

describe('malformed fan-out messages over Redis', () => {
  it.each([
    ['not json', '{nope'],
    ['an empty message', ''],
    ['json null', 'null'],
    ['no audience', JSON.stringify({ event: { at: 'x', id: 'y', kind: 'k' } })],
    [
      'an audience that is a string',
      JSON.stringify({
        audience: 'system',
        event: { at: 'x', id: 'y', kind: 'k' },
      }),
    ],
    ['no event', JSON.stringify({ audience: ['system'] })],
  ])('drops %s and keeps every stream open', async (_, raw) => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');
    const publisher = new Redis(redisUrl);
    publishers.push(publisher);

    await publisher.publish(LIVE_CHANNEL, raw);
    await publish(['system'], 'after.ping');

    await live.next('after.ping');
    expect(live.res.destroyed).toBe(false);
    expect(live.messages.map((m) => m.event)).toEqual(['hello', 'after.ping']);
  });
});

describe('the admin test update refusals', () => {
  it('answers 401 before it looks at a bad body', async () => {
    const res = await sendTest({ accountId: 'nope' });

    expect(res.status).toBe(401);
  });

  it('answers 401 to an expired admin token', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);

    const res = await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin', -1)}`,
    );

    expect(res.status).toBe(401);
  });

  it('answers 404 and sends nothing when a driver forges an admin role in the token', async () => {
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    const res = await sendTest(
      { accountId: driver },
      `Bearer ${token(driver, 'admin')}`,
    );
    await settle();

    expect([401, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(202);
    expect(kinds(live, 'live.test')).toHaveLength(0);
  });

  it('answers 403 to a suspended admin and sends nothing', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: admin },
    });

    const res = await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin')}`,
    );
    await settle();

    expect(res.status).toBe(403);
    expect(kinds(live, 'live.test')).toHaveLength(0);
  });

  it.each([
    ['null', null],
    ['an array', ['a']],
    ['an empty string', ''],
    ['an object', { id: 'x' }],
    ['a uuid with trailing text', `${randomUUID()}x`],
    ['a boolean', true],
  ])('answers 400 to an account id that is %s', async (_, accountId) => {
    const admin = await account('Admin', ['admin']);

    const res = await sendTest(
      { accountId },
      `Bearer ${token(admin, 'admin')}`,
    );

    expect(res.status).toBe(400);
  });

  it('answers 400 to an extra field in the body', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);

    const res = await sendTest(
      { accountId: driver, audience: ['system'] },
      `Bearer ${token(admin, 'admin')}`,
    );

    expect(res.status).toBe(400);
  });

  it('answers 400 to an empty body and sends nothing', async () => {
    const admin = await account('Admin', ['admin']);

    const res = await request(app.getHttpServer())
      .post('/admin/live/test')
      .set('Authorization', `Bearer ${token(admin, 'admin')}`);

    expect(res.status).toBe(400);
  });

  it('answers 404 for a well formed uuid in upper case that matches no account', async () => {
    const admin = await account('Admin', ['admin']);

    const res = await sendTest(
      { accountId: randomUUID().toUpperCase() },
      `Bearer ${token(admin, 'admin')}`,
    );

    expect(res.status).toBe(404);
  });
});

describe('the admin test update repeated', () => {
  it('sends two events with different ids when called twice', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin')}`,
    ).expect(202);
    await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin')}`,
    ).expect(202);
    await settle();

    const tests = kinds(live, 'live.test');
    expect(tests).toHaveLength(2);
    expect(tests[0]?.data['id']).not.toBe(tests[1]?.data['id']);
  });

  it('lets an admin send the update to their own account', async () => {
    const admin = await account('Admin', ['admin']);
    const live = await stream(app, `Bearer ${token(admin, 'admin')}`);
    await live.next('hello');

    await sendTest(
      { accountId: admin },
      `Bearer ${token(admin, 'admin')}`,
    ).expect(202);

    expect((await live.next('live.test')).data['kind']).toBe('live.test');
  });

  it('delivers an update sent to one copy on a stream held by the other copy', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const live = await stream(second, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin')}`,
      app,
    ).expect(202);
    await live.next('live.test');
    await settle();

    expect(kinds(live, 'live.test')).toHaveLength(1);
  });

  it('keeps the response free of the account id and personal data on the stream', async () => {
    const admin = await account('Admin', ['admin']);
    const driver = await account('Andrei', ['driver']);
    const live = await stream(app, `Bearer ${token(driver, 'driver')}`);
    await live.next('hello');

    await sendTest(
      { accountId: driver },
      `Bearer ${token(admin, 'admin')}`,
    ).expect(202);
    await live.next('live.test');

    expect(live.body).not.toContain(driver);
    expect(live.body).not.toContain('Andrei');
  });
});

// A TCP relay to Redis that the test can cut and bring back on the same port.
function relay(targetUrl: string) {
  const target = new URL(targetUrl);
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;
  const start = () =>
    new Promise<void>((resolve) => {
      server = createServer((client) => {
        const upstream = connect(Number(target.port || 6379), target.hostname);
        sockets.add(client);
        sockets.add(upstream);
        client.pipe(upstream);
        upstream.pipe(client);
        const drop = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on('error', drop);
        upstream.on('error', drop);
        client.on('close', drop);
        upstream.on('close', drop);
      });
      server.listen(port, '127.0.0.1', () => {
        port = (server?.address() as AddressInfo).port;
        resolve();
      });
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      sockets.clear();
      server?.close(() => resolve());
    });
  return {
    port: () => port,
    start,
    stop,
  };
}

describe('Redis going away and coming back', () => {
  it('resumes delivery to an open stream without a reconnect and answers 503 while down', async () => {
    const proxy = relay(redisUrl);
    await proxy.start();
    const flaky = await boot(`redis://127.0.0.1:${proxy.port()}`);
    try {
      const admin = await account('Admin', ['admin']);
      const driver = await account('Andrei', ['driver']);
      const live = await stream(flaky, `Bearer ${token(driver, 'driver')}`);
      await live.next('hello');
      await publish([`account:${driver}`], 'before.ping');
      await live.next('before.ping');

      await proxy.stop();
      await new Promise((r) => setTimeout(r, 500));
      const down = await sendTest(
        { accountId: driver },
        `Bearer ${token(admin, 'admin')}`,
        flaky,
      );
      const during = await stream(flaky, `Bearer ${token(driver, 'driver')}`);
      await during.next('hello');

      await proxy.start();
      await new Promise((r) => setTimeout(r, 3_000));
      await publish([`account:${driver}`], 'after.ping');

      expect(down.status).toBe(503);
      expect(live.res.destroyed).toBe(false);
      await live.next('after.ping', 5_000);
      await during.next('after.ping', 5_000);
      expect(kinds(live, 'after.ping')).toHaveLength(1);
      expect(kinds(live, 'hello')).toHaveLength(1);
    } finally {
      await flaky.close();
      await proxy.stop();
    }
  }, 30_000);
});
