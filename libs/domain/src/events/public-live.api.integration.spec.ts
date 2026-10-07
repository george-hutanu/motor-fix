import { randomUUID } from 'node:crypto';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { EventsModule } from './events.module';
import { OutboxRelayModule } from './outbox-relay.module';
import { AuditService } from '../audit/audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
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
const opened: IncomingMessage[] = [];

beforeAll(async () => {
  app = await boot();
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

interface Message {
  event: string;
  data: Record<string, unknown>;
}

interface Stream {
  res: IncomingMessage;
  body: string;
  messages: Message[];
  events: () => string[];
  next: (kind: string, ms?: number) => Promise<Message>;
  ended: Promise<void>;
}

function stream(
  target: INestApplication,
  query: Record<string, string> = {},
  auth?: string,
) {
  const { port } = target.getHttpServer().address() as AddressInfo;
  const search = new URLSearchParams(query).toString();
  return new Promise<Stream>((resolve, reject) => {
    const req = get(
      {
        headers: auth ? { Authorization: auth } : {},
        host: '127.0.0.1',
        path: `/live/public${search ? `?${search}` : ''}`,
        port,
      },
      (res) => {
        opened.push(res);
        const out: Stream = {
          body: '',
          ended: new Promise<void>((done) => res.on('close', () => done())),
          events: () =>
            out.messages
              .map((m) => m.event)
              .filter((kind) => kind !== 'hello' && kind !== 'bye'),
          messages: [],
          next: (kind, ms = 2_000) =>
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

// What a refused request answered, read to its end.
async function refusal(query: Record<string, string>, target = app) {
  const live = await stream(target, query);
  await live.ended;
  return {
    body: JSON.parse(live.body || '{}'),
    contentType: live.res.headers['content-type'],
    status: live.res.statusCode,
  };
}

const record = (kind: string, subjectId: string, audience: string[]) =>
  prisma.outboxEvent.create({
    data: { audience, kind, payload: { secret: 'x' }, subjectId },
  });

// Nothing more arrives: a recorded marker on the same stream comes first.
async function quiet(live: Stream, marker: string[]) {
  await record('platform_rule.changed', randomUUID(), marker);
  await live.next('platform_rule.changed');
}

async function garage(status: 'approved' | 'draft' | 'suspended' = 'approved') {
  return (
    await prisma.garage.create({
      data: { name: 'Atelier Dinamo', slug: `atelier-${randomUUID()}`, status },
    })
  ).id;
}

async function mechanicOf(garageId: string) {
  const { id: accountId } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `mechanic-${randomUUID()}` },
    name: 'Mihai',
    roles: ['mechanic'],
  });
  return (await prisma.mechanic.create({ data: { accountId, garageId } })).id;
}

async function brand(active = true) {
  const key = `brand-${randomUUID()}`;
  return (
    await prisma.brand.create({
      data: { active, key, name: key, slug: key },
    })
  ).id;
}

describe('the public live stream', () => {
  it('opens for a visitor without a session and greets it with hello', async () => {
    const live = await stream(app);

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

  it("carries a public kind about an approved garage to that garage's profile within two seconds, as kind, id and time only", async () => {
    const garageId = await garage();
    const live = await stream(app, { garages: garageId });
    await live.next('hello');

    await record('garage.updated', garageId, [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
    ]);

    const message = await live.next('garage.updated');
    expect(message.data).toEqual({
      at: expect.any(String),
      id: garageId,
      kind: 'garage.updated',
    });
  });

  it("carries a review kind to the profile of the review's mechanic", async () => {
    const garageId = await garage();
    const mechanicId = await mechanicOf(garageId);
    const live = await stream(app, { mechanics: mechanicId });
    await live.next('hello');

    await record('review.posted', randomUUID(), [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      `public:mechanic:${mechanicId}`,
    ]);

    await live.next('review.posted');
  });

  it("carries nothing about another garage to a garage's profile", async () => {
    const mine = await garage();
    const other = await garage();
    const live = await stream(app, { garages: mine });
    await live.next('hello');

    await record('garage.updated', other, [`public:garage:${other}`]);
    await quiet(live, ['system']);

    expect(live.events()).toEqual(['platform_rule.changed']);
  });

  it('never carries a private kind, even when the publisher named a public key', async () => {
    const garageId = await garage();
    const live = await stream(app, { garages: garageId });
    await live.next('hello');

    await record('request.created', randomUUID(), [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
    ]);
    await record('account.updated', randomUUID(), [
      `public:garage:${garageId}`,
    ]);
    await quiet(live, ['system']);

    expect(live.events()).toEqual(['platform_rule.changed']);
  });

  it('carries approval, suspension, restoration and profile changes of any garage to a results view', async () => {
    const brandId = await brand();
    const garageId = await garage();
    const live = await stream(app, { brand: brandId });
    await live.next('hello');

    await record('verification.decided', randomUUID(), [
      'admin',
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      'public:search',
    ]);
    await record('garage.suspended', garageId, [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      'public:search',
    ]);
    await record('garage.restored', garageId, [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      'public:search',
    ]);
    await record('garage.updated', garageId, [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      'public:search',
    ]);
    await live.next('garage.updated');

    expect(live.events()).toEqual([
      'verification.decided',
      'garage.suspended',
      'garage.restored',
      'garage.updated',
    ]);
  });

  it("carries a brand stance change to that brand's results only", async () => {
    const mine = await brand();
    const other = await brand();
    const garageId = await garage();
    const theirs = await stream(app, { brand: other });
    const live = await stream(app, { brand: mine });
    await Promise.all([live.next('hello'), theirs.next('hello')]);

    await record('garage.updated', garageId, [
      `garage:${garageId}`,
      `public:garage:${garageId}`,
      `public:search:${mine}`,
    ]);
    await live.next('garage.updated');
    await quiet(theirs, ['system']);

    expect(theirs.events()).toEqual(['platform_rule.changed']);
  });

  it('joins the results of a retired brand', async () => {
    const retired = await brand(false);
    const live = await stream(app, { brand: retired });
    await live.next('hello');

    await record('garage.updated', randomUUID(), [`public:search:${retired}`]);

    await live.next('garage.updated');
  });

  it('carries the platform rule kinds to every public stream', async () => {
    const bare = await stream(app);
    const profile = await stream(app, { garages: await garage() });
    await Promise.all([bare.next('hello'), profile.next('hello')]);

    await record('platform_rule.changed', randomUUID(), ['admin', 'system']);

    await Promise.all([
      bare.next('platform_rule.changed'),
      profile.next('platform_rule.changed'),
    ]);
  });

  it('writes nothing to the database', async () => {
    const garageId = await garage();
    const before = await Promise.all([
      prisma.outboxEvent.count(),
      prisma.activityLog.count(),
    ]);

    const live = await stream(app, { garages: garageId });
    await live.next('hello');

    expect(
      await Promise.all([
        prisma.outboxEvent.count(),
        prisma.activityLog.count(),
      ]),
    ).toEqual(before);
  });

  it('says bye with reason shutdown when the copy shuts down', async () => {
    const copy = await boot();
    const live = await stream(copy);
    await live.next('hello');

    await copy.close();

    const bye = await live.next('bye');
    expect(bye.data).toMatchObject({ kind: 'bye', reason: 'shutdown' });
  });

  describe('what it ignores', () => {
    it.each([
      ['a draft garage', () => garage('draft'), 'garages'],
      ['a suspended garage', () => garage('suspended'), 'garages'],
      ['an unknown garage', async () => randomUUID(), 'garages'],
      [
        'a mechanic of a garage that is not approved',
        async () => mechanicOf(await garage('draft')),
        'mechanics',
      ],
      ['an unknown mechanic', async () => randomUUID(), 'mechanics'],
      ['an unknown brand', async () => randomUUID(), 'brand'],
    ])('opens for %s and joins nothing for it', async (_, make, field) => {
      const id = await make();
      const live = await stream(app, { [field]: id });
      await live.next('hello');

      await record('garage.updated', id, [
        `public:garage:${id}`,
        `public:mechanic:${id}`,
        `public:search:${id}`,
      ]);
      await record('mechanic.updated', id, [`public:mechanic:${id}`]);
      await quiet(live, ['system']);

      expect(live.res.statusCode).toBe(200);
      expect(live.events()).toEqual(['platform_rule.changed']);
    });

    it('treats a signed-in caller as a visitor', async () => {
      const { id: owner } = await accounts.createAccount({
        consent: CURRENT_CONSENT,
        identity: { method: 'google', subject: `owner-${randomUUID()}` },
        name: 'Ioana',
        roles: ['garage'],
      });
      const garageId = await garage();
      await prisma.garageMember.create({
        data: { accountId: owner, garageId, role: 'owner' },
      });
      const auth = `Bearer ${signAccessToken({ accountId: owner, role: 'garage' }, tokenSecret, Date.now())}`;
      const live = await stream(app, {}, auth);
      await live.next('hello');

      await record('live.test', owner, [`account:${owner}`]);
      await record('invite.sent', randomUUID(), [`garage:${garageId}`]);
      await record('document.uploaded', randomUUID(), ['admin']);
      await quiet(live, ['system']);

      expect(live.events()).toEqual(['platform_rule.changed']);
    });
  });

  describe('what it refuses', () => {
    it.each([
      ['two garages', { garages: [randomUUID(), randomUUID()] }],
      ['two mechanics', { mechanics: [randomUUID(), randomUUID()] }],
      ['two brands', { brand: [randomUUID(), randomUUID()] }],
      ['a garage that is not a uuid', { garages: 'atelier-dinamo' }],
      ['an unknown parameter', { token: 'abc' }],
    ])('answers 400 to %s before any stream data', async (_, query) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        for (const v of [value].flat()) search.append(key, v);
      }
      const { port } = app.getHttpServer().address() as AddressInfo;

      const res = await fetch(`http://127.0.0.1:${port}/live/public?${search}`);

      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await res.text()).not.toMatch(/^event:/m);
    });
  });

  describe('streams per address', () => {
    let limited: INestApplication;

    beforeAll(async () => {
      limited = await boot();
    });

    afterAll(async () => {
      await limited.close();
    });

    it('refuses the 21st stream from one address with 429 too_many_streams, and frees a place when one closes', async () => {
      const streams: Stream[] = [];
      for (let i = 0; i < 20; i++) {
        const live = await stream(limited);
        await live.next('hello');
        streams.push(live);
      }

      const refused = await refusal({}, limited);
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'too_many_streams' });

      expect((await refusal({ garages: 'not-a-uuid' }, limited)).status).toBe(
        400,
      );

      streams[0]?.res.destroy();
      await streams[0]?.ended;
      let reopened: Stream | undefined;
      for (
        let tries = 0;
        tries < 20 && reopened?.res.statusCode !== 200;
        tries++
      ) {
        await new Promise((ok) => setTimeout(ok, 50));
        reopened = await stream(limited);
      }
      expect(reopened?.res.statusCode).toBe(200);
      await reopened?.next('hello');
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

    it('still opens a public stream with hello', async () => {
      const live = await stream(deaf, { garages: await garage() });

      expect(live.res.statusCode).toBe(200);
      await live.next('hello');
    });
  });
});
