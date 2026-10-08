import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import {
  dropProfiles,
  generationKey,
  profileKey,
} from './public-garages.cache';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { OutboxRelay } from '../../events/outbox-relay/outbox-relay';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
const other = new Redis(redisUrl);

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const get = (path: string) => request(app.getHttpServer()).get(path);

const approved = (data: Record<string, unknown> = {}) =>
  prisma.garage.create({
    data: {
      name: 'Service Auto Militari',
      slug: `militari-${randomUUID()}`,
      status: 'approved',
      ...data,
    },
  });

const brand = (name: string) => {
  const slug = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { active: true, key: slug, name, popularity: null, slug },
  });
};

describe('a profile read with a damaged brand parameter', () => {
  const damaged: [string, string][] = [
    ['an empty value', 'brand='],
    ['blanks only', 'brand=%20%20%20'],
    ['a control character', 'brand=da%07cia'],
    ['a NUL byte', 'brand=da%00cia'],
    ['a newline', 'brand=dacia%0A'],
    ['an array', 'brand[]=dacia&brand[]=bmw'],
    ['an object', 'brand[a]=b'],
    ['a value ten thousand characters long', `brand=${'a'.repeat(10_000)}`],
    ['a lone surrogate', 'brand=%ED%A0%80'],
    ['bytes that are not UTF-8', 'brand=%FF%FE'],
    ['a UTF-8 look-alike', 'brand=d%C4%83cia'],
  ];

  it.each(damaged)(
    'answers the garage with no brand for %s',
    async (_, query) => {
      const garage = await approved();

      const res = await get(`/garages/${garage.slug}?${query}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(garage.id);
      expect(res.body).not.toHaveProperty('brand');
    },
  );

  it('does not match a catalogue brand by letter case or padding', async () => {
    const garage = await approved();
    const dacia = await brand('Dacia');

    for (const value of [
      dacia.slug.toUpperCase(),
      ` ${dacia.slug}`,
      `${dacia.slug} `,
    ]) {
      const res = await get(
        `/garages/${garage.slug}?brand=${encodeURIComponent(value)}`,
      );

      expect([value, res.status, 'brand' in res.body]).toEqual([
        value,
        200,
        false,
      ]);
    }
  });

  it('ignores a query parameter it does not know', async () => {
    const garage = await approved();

    const res = await get(`/garages/${garage.slug}?colour=red&brand=`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(garage.id);
  });

  it('does not answer 500 to a slug that is not valid UTF-8 or percent-encoding', async () => {
    for (const slug of ['%FF%FE', '%E0%A4%A', '%00', '%']) {
      const res = await get(`/garages/${slug}`);

      expect([slug, res.status < 500]).toEqual([slug, true]);
    }
  });

  it('does not grow the garage cache with every brand a visitor makes up', async () => {
    const garage = await approved();
    const dacia = await brand('Dacia');

    await get(`/garages/${garage.slug}`);
    await get(`/garages/${garage.slug}?brand=${dacia.slug}`);
    for (let i = 0; i < 40; i++) {
      await get(`/garages/${garage.slug}?brand=nobody-${i}`);
    }

    expect(await other.hlen(profileKey(garage.id))).toBeLessThanOrEqual(2);
  });
});

describe('the brand answer through the cache', () => {
  it('keeps one brand in context from leaking into another read of the same garage', async () => {
    const garage = await approved();
    const dacia = await brand('Dacia');
    const bmw = await brand('BMW');
    await prisma.garageBrand.create({
      data: {
        brandId: dacia.id,
        diesel: true,
        electric: true,
        garageId: garage.id,
        hybrid: true,
        petrol: true,
        stance: 'works_on',
      },
    });

    const reads = [];
    for (const query of [
      `?brand=${dacia.slug}`,
      `?brand=${bmw.slug}`,
      '',
      `?brand=${dacia.slug}`,
      `?brand=${bmw.slug}`,
      '',
    ]) {
      reads.push((await get(`/garages/${garage.slug}${query}`)).body);
    }

    expect(reads.map((body) => body.brand?.stance ?? null)).toEqual([
      'works_on',
      'does_not_take',
      null,
      'works_on',
      'does_not_take',
      null,
    ]);
    expect(reads[3]).toEqual(reads[0]);
    expect(reads[4]).toEqual(reads[1]);
    expect(reads[5]).toEqual(reads[2]);
  });

  it('answers the same body to thirty reads at once, with and without a brand', async () => {
    const garage = await approved({ knownFor: 'Frâne și suspensii' });
    const dacia = await brand('Dacia');

    const bodies = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        get(
          `/garages/${garage.slug}${i % 2 ? `?brand=${dacia.slug}` : ''}`,
        ).then((res) => [res.status, res.body] as const),
      ),
    );

    expect(new Set(bodies.map(([status]) => status))).toEqual(new Set([200]));
    const plain = bodies.filter((_, i) => i % 2 === 0).map(([, b]) => b);
    const branded = bodies.filter((_, i) => i % 2 === 1).map(([, b]) => b);
    expect(
      plain.every((b) => JSON.stringify(b) === JSON.stringify(plain[0])),
    ).toBe(true);
    expect(
      branded.every((b) => JSON.stringify(b) === JSON.stringify(branded[0])),
    ).toBe(true);
    expect(branded[0].brand.stance).toBe('does_not_take');
    expect(plain[0]).not.toHaveProperty('brand');
  });

  it('gives back the description exactly as written after a cache round trip', async () => {
    const line = 'Frâne 🚗 „Ștefan” — 日本車 <b>&amp;</b> "q"';
    const garage = await approved({ knownFor: line });

    const first = await get(`/garages/${garage.slug}`);
    const second = await get(`/garages/${garage.slug}`);

    expect(first.body.description).toBe(line);
    expect(second.body).toEqual(first.body);
  });
});

// @traces 307-FR-001 307-FR-006
describe('the slug and the cache', () => {
  // A change to a garage commits with its event, and the relay drops the
  // cached profile when it hands the event on. Other spec files share the
  // outbox: their rows can fill a batch ahead of this one, or another
  // worker's relay can hold it, so relay until this event is handed on.
  const changed = async (id: string, write: () => Promise<unknown>) => {
    await write();
    const event = await prisma.outboxEvent.create({
      data: {
        audience: [`public:garage:${id}`],
        kind: 'garage.updated',
        subjectId: id,
      },
    });
    const relay = new OutboxRelay(prisma, other);
    for (let lap = 0; lap < 50; lap++) {
      await relay.relay();
      const row = await prisma.outboxEvent.findUnique({
        where: { id: event.id },
      });
      if (row?.relayedAt) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`outbox event ${event.id} was never relayed`);
  };

  it('answers 404 for a slug the garage gave up, even if it was read a moment ago', async () => {
    const garage = await approved();
    expect((await get(`/garages/${garage.slug}`)).status).toBe(200);
    const renamed = `renamed-${randomUUID()}`;

    await changed(garage.id, () =>
      prisma.garage.update({
        data: { slug: renamed },
        where: { id: garage.id },
      }),
    );

    expect((await get(`/garages/${garage.slug}`)).status).toBe(404);
  });

  it('answers 404 for the old slug once the new one has filled the cache again', async () => {
    const garage = await approved();
    expect((await get(`/garages/${garage.slug}`)).status).toBe(200);
    const renamed = `renamed-${randomUUID()}`;
    await changed(garage.id, () =>
      prisma.garage.update({
        data: { slug: renamed },
        where: { id: garage.id },
      }),
    );

    expect((await get(`/garages/${renamed}`)).status).toBe(200);

    expect((await get(`/garages/${garage.slug}`)).status).toBe(404);
  });

  it('answers the garage that holds a slug now, not the one that held it before', async () => {
    const first = await approved({ name: 'Primul' });
    expect((await get(`/garages/${first.slug}`)).body.name).toBe('Primul');
    await changed(first.id, () =>
      prisma.garage.update({
        data: { slug: `moved-${randomUUID()}` },
        where: { id: first.id },
      }),
    );
    const second = await approved({ name: 'Al doilea', slug: first.slug });

    const res = await get(`/garages/${first.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(second.id);
    expect(res.body.name).toBe('Al doilea');
  });
});

// @traces 307-FR-002
describe('the verification date', () => {
  it('falls back to the approval time when the approved file holds no decision time', async () => {
    const garage = await approved({
      approvedAt: new Date('2026-03-03T08:00:00.000Z'),
    });
    await prisma.verificationFile.create({
      data: { decidedAt: null, garageId: garage.id, status: 'approved' },
    });

    const res = await get(`/garages/${garage.slug}`);

    expect(res.body.verifiedAt).toBe('2026-03-03T08:00:00.000Z');
  });

  it('ignores the decision time of a file that was not approved', async () => {
    const garage = await approved({
      approvedAt: new Date('2026-03-03T08:00:00.000Z'),
    });
    for (const status of ['rejected', 'more_requested'] as const) {
      await prisma.verificationFile.create({
        data: {
          decidedAt: new Date('2030-01-01T00:00:00.000Z'),
          garageId: garage.id,
          status,
        },
      });
    }

    const res = await get(`/garages/${garage.slug}`);

    expect(res.body.verifiedAt).toBe('2026-03-03T08:00:00.000Z');
  });

  it('keeps a description of exactly 160 multi-byte characters whole', async () => {
    const line = 'ă'.repeat(160);
    const garage = await approved({ knownFor: line });

    const res = await get(`/garages/${garage.slug}`);

    expect(res.body.description).toBe(line);
  });
});

// @traces 307-FR-006
describe('dropping the profile when an event reaches a public garage channel', () => {
  const seed = async (id: string, fields: string[]) => {
    for (const field of fields) {
      await other.hset(profileKey(id), field, '{"id":"x"}');
    }
  };

  it('removes every brand field of the garages named, and only those', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await seed(a, ['-', 'dacia', 'bmw']);
    await seed(b, ['-', 'dacia']);
    await seed(c, ['-']);

    await dropProfiles(other, [`public:garage:${a}`, `public:garage:${b}`]);

    expect(await other.exists(profileKey(a))).toBe(0);
    expect(await other.exists(profileKey(b))).toBe(0);
    expect(await other.hlen(profileKey(c))).toBe(1);
    expect(await other.get(generationKey(a))).toBe('1');
    expect(await other.ttl(generationKey(a))).toBeGreaterThan(0);
    expect(await other.exists(generationKey(c))).toBe(0);
  });

  it('leaves a profile alone for audiences that only look like the public one', async () => {
    const id = randomUUID();
    await seed(id, ['-']);

    await dropProfiles(other, [
      `garage:${id}`,
      `account:${id}`,
      ` public:garage:${id}`,
      `public:garage:`,
      'public:garage',
      '',
    ]);

    expect(await other.hlen(profileKey(id))).toBe(1);
  });

  it('advances the generation once for each time the garage is named', async () => {
    const id = randomUUID();

    await dropProfiles(other, [`public:garage:${id}`]);
    await dropProfiles(other, [`public:garage:${id}`]);

    expect(await other.get(generationKey(id))).toBe('2');
  });

  it('drops nothing and does not fail for an empty audience', async () => {
    await expect(dropProfiles(other, [])).resolves.toBeUndefined();
  });

  // A drop Redis refuses fails the relay's batch, which leaves the event
  // unrelayed and retries it, so no profile outlives its change.
  it('fails the drop when Redis refuses it, so the relay retries the event', async () => {
    const broken = {
      del: () => Promise.reject(new Error('Connection is closed.')),
      expire: () => Promise.reject(new Error('Connection is closed.')),
      incr: () => Promise.reject(new Error('Connection is closed.')),
    };

    await expect(
      dropProfiles(broken, [`public:garage:${randomUUID()}`]),
    ).rejects.toThrow('Connection is closed.');
  });
});
