import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let since: Date;
let mark: bigint;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
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
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  mark = await outboxMark(prisma);
});
const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function brand(name: string) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({ data: { key, name, slug: key } });
}

async function world() {
  const nord = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  return {
    bmw: await brand('BMW'),
    dinamo,
    mihai,
    mini: await brand('Mini'),
    nord,
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
    tesla: await brand('Tesla'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function jobType(key: string) {
  return (
    await prisma.jobType.create({
      data: {
        key: `${key}-${randomUUID()}`,
        nameEn: key,
        nameRo: key,
        status: 'approved',
      },
    })
  ).id;
}

// The garage's price list, in the given order; a job named twice is priced
// again for a brand of its own.
async function price(w: World, garageId: string, ids: string[], more = {}) {
  await prisma.garagePrice.createMany({
    data: ids.map((jobTypeId, position) => ({
      fromBani: 30_000,
      garageId,
      jobTypeId,
      position,
      updatedBy: w.mihai,
      ...more,
    })),
  });
}

async function priced(w: World, n = 3) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await jobType(`job${i}`));
  await price(w, w.nord.id, ids);
  return ids;
}

const put = (w: World, body: unknown, as: string | null = w.owner) => {
  const req = http()
    .put(`/garages/${w.nord.id}/brands`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};

const take = (id: string, jobs?: unknown) => ({
  brands: [
    {
      brandId: id,
      stance: 'works_on',
      ...(jobs === undefined ? {} : { jobs }),
    },
  ],
});

const ticked = async (w: World, brandId: string) =>
  (
    await prisma.garageBrandJob.findMany({
      select: { jobTypeId: true },
      where: { brandId, garageId: w.nord.id },
    })
  )
    .map((r) => r.jobTypeId)
    .sort();
const allTicks = (w: World) =>
  prisma.garageBrandJob.count({ where: { garageId: w.nord.id } });
const brandRows = (w: World) =>
  prisma.garageBrand.count({ where: { garageId: w.nord.id } });
const events = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark }, kind: 'garage.updated' },
  });
const audits = (w: World, action?: 'create' | 'delete') =>
  prisma.activityLog.findMany({
    where: {
      action,
      at: { gte: since },
      garageId: w.nord.id,
      subjectType: 'garage_brand_job',
    },
  });

describe('PUT /garages/:garageId/brands with jobs, at the edges', () => {
  it('accepts fifty ticked jobs and refuses fifty-one, writing nothing for the refusal', async () => {
    const w = await world();
    const ids = await priced(w, 51);

    const over = await put(w, take(w.bmw.id, ids));
    expect(over.status).toBe(400);
    expect(await brandRows(w)).toBe(0);
    expect(await allTicks(w)).toBe(0);

    const at = await put(w, take(w.bmw.id, ids.slice(0, 50)));
    expect(at.status).toBe(200);
    expect(at.body.worksOn[0].jobs).toEqual(ids.slice(0, 50));
    expect(await allTicks(w)).toBe(50);
  });

  it('gives a newly taken brand every priced job when jobs is missing and none when it is empty', async () => {
    const w = await world();
    const ids = await priced(w);

    const res = await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.mini.id, jobs: [], stance: 'works_on' },
      ],
    });

    expect(res.status).toBe(200);
    expect(await ticked(w, w.bmw.id)).toEqual([...ids].sort());
    expect(await ticked(w, w.mini.id)).toEqual([]);
    expect(res.body.worksOn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: w.mini.id, jobs: [] }),
        expect.objectContaining({ id: w.bmw.id, jobs: ids }),
      ]),
    );
  });

  it('keeps the ticks of a taken brand when jobs is missing and clears them when it is empty', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0], ids[2]]));
    const sent = (await events()).length;
    const logged = (await audits(w)).length;

    const kept = await put(w, take(w.bmw.id));
    expect(kept.status).toBe(200);
    expect(kept.body.worksOn[0].jobs).toEqual([ids[0], ids[2]]);
    expect(await ticked(w, w.bmw.id)).toEqual([ids[0], ids[2]].sort());
    expect(await audits(w)).toHaveLength(logged);
    expect(await events()).toHaveLength(sent);

    const cleared = await put(w, take(w.bmw.id, []));
    expect(cleared.status).toBe(200);
    expect(cleared.body.worksOn[0].jobs).toEqual([]);
    expect(await allTicks(w)).toBe(0);
    expect(await audits(w, 'delete')).toHaveLength(2);
  });

  it('records nothing the second time the same ticks are sent', async () => {
    const w = await world();
    const ids = await priced(w);
    const body = take(w.bmw.id, [ids[1]]);
    await put(w, body);
    const sent = (await events()).length;
    const logged = (await audits(w)).length;

    const again = await put(w, body);

    expect(again.status).toBe(200);
    expect(await audits(w)).toHaveLength(logged);
    expect(await events()).toHaveLength(sent);
    expect(logged).toBe(1);
  });

  it('records nothing when the ticks come in another order or in capitals', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0], ids[1]]));
    const sent = (await events()).length;
    const logged = (await audits(w)).length;

    const again = await put(
      w,
      take(w.bmw.id, [ids[1].toUpperCase(), ids[0].toUpperCase()]),
    );

    expect(again.status).toBe(200);
    expect(again.body.worksOn[0].jobs).toEqual([ids[0], ids[1]]);
    expect(await audits(w)).toHaveLength(logged);
    expect(await events()).toHaveLength(sent);
  });

  it('answers the ticked jobs in price-list order whatever order they were sent in', async () => {
    const w = await world();
    const ids = await priced(w);

    const res = await put(w, take(w.bmw.id, [ids[2], ids[0], ids[1]]));

    expect(res.body.worksOn[0].jobs).toEqual(ids);
  });

  it('names brand_jobs in the one event of a tick change and not in a text-only write', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0]]));
    const first = await events();
    expect(first).toHaveLength(1);
    expect((first[0].payload as { fields: string[] }).fields).toEqual(
      expect.arrayContaining(['brand_jobs', 'brands']),
    );

    await put(w, { ...take(w.bmw.id, [ids[0]]), brandNote: 'doar BMW' });

    const all = await events();
    expect(all).toHaveLength(2);
    expect((all[1].payload as { fields: string[] }).fields).not.toContain(
      'brand_jobs',
    );
  });

  it('prices a job once for a brand of its own and still writes one row per job', async () => {
    const w = await world();
    const ids = await priced(w, 2);
    await price(w, w.nord.id, [ids[0]], { brandId: w.bmw.id });

    const res = await put(w, take(w.bmw.id));

    expect(res.status).toBe(200);
    expect(res.body.worksOn[0].jobs).toEqual(ids);
    expect(await ticked(w, w.bmw.id)).toEqual([...ids].sort());
  });

  it('takes a job that is priced only for another brand as priced for this garage', async () => {
    const w = await world();
    const only = await jobType('only-mini');
    await price(w, w.nord.id, [only], { brandId: w.mini.id });

    const res = await put(w, take(w.bmw.id, [only]));

    expect(res.status).toBe(200);
    expect(await ticked(w, w.bmw.id)).toEqual([only]);
  });
});

describe('PUT /garages/:garageId/brands refusing jobs', () => {
  it.each([
    ['jobs on a refused brand', (ids: string[]) => [ids[0]]],
    ['an empty jobs list on a refused brand', () => []],
  ])('answers 400 to %s and writes nothing', async (_, jobs) => {
    const w = await world();
    const ids = await priced(w);

    const res = await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.tesla.id, jobs: jobs(ids), stance: 'does_not_take' },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'jobs_on_refused' }),
    ]);
    expect(await brandRows(w)).toBe(0);
    expect(await allTicks(w)).toBe(0);
  });

  it('answers 400 for a job not priced, also beside valid ones, and keeps the old ticks', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0]]));
    const sent = (await events()).length;

    const res = await put(w, {
      brands: [
        { brandId: w.mini.id, stance: 'works_on' },
        { brandId: w.bmw.id, jobs: [ids[1], randomUUID()], stance: 'works_on' },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'job_not_priced' }),
    ]);
    expect(await ticked(w, w.bmw.id)).toEqual([ids[0]]);
    expect(await brandRows(w)).toBe(1);
    expect(await events()).toHaveLength(sent);
  });

  it("answers 400 for a job priced only on another garage's list", async () => {
    const w = await world();
    await priced(w);
    const theirs = await jobType('theirs');
    await price(w, w.dinamo.id, [theirs]);

    const res = await put(w, take(w.bmw.id, [theirs]));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'job_not_priced' }),
    ]);
    expect(await allTicks(w)).toBe(0);
  });

  it('answers 400 for a job on a garage with no price list at all', async () => {
    const w = await world();
    const stray = await jobType('stray');

    const res = await put(w, take(w.bmw.id, [stray]));

    expect(res.status).toBe(400);
    expect(await brandRows(w)).toBe(0);
  });

  it('gives a newly taken brand no row when the garage has no price list', async () => {
    const w = await world();

    const res = await put(w, take(w.bmw.id));

    expect(res.status).toBe(200);
    expect(res.body.worksOn[0].jobs).toEqual([]);
    expect(await audits(w)).toEqual([]);
  });

  it.each([
    ['null jobs', null],
    ['a string for jobs', 'abc'],
    ['the same id twice, once in capitals', 'DUP'],
    ['numbers', [1, 2]],
    ['a name', ['Schimb de ulei']],
  ])('answers 400 to %s', async (_, jobs) => {
    const w = await world();
    const ids = await priced(w);
    const sent =
      jobs === 'DUP' ? [ids[0], ids[0].toUpperCase()] : (jobs as unknown);

    const res = await put(w, take(w.bmw.id, sent));

    expect(res.status).toBe(400);
    expect(await brandRows(w)).toBe(0);
  });

  it('answers 400 to the draft key unticked sent to the write', async () => {
    const w = await world();
    const ids = await priced(w);

    const res = await put(w, {
      brands: [{ brandId: w.bmw.id, stance: 'works_on', unticked: [ids[0]] }],
    });

    expect(res.status).toBe(400);
    expect(await brandRows(w)).toBe(0);
  });

  it('answers 403 to the receptionist and 401 without a session, ticks untouched', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0]]));

    const staff = await put(w, take(w.bmw.id, []), w.receptionist);
    const none = await put(w, take(w.bmw.id, []), null);

    expect(staff.status).toBe(403);
    expect(none.status).toBe(401);
    expect(await ticked(w, w.bmw.id)).toEqual([ids[0]]);
  });
});

describe('PUT /garages/:garageId/brands moving ticked brands between stances', () => {
  it('deletes the ticks of a brand turned refused, with one entry each, and answers it without jobs', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id));

    const res = await put(w, {
      brands: [{ brandId: w.bmw.id, stance: 'does_not_take' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.doesNotTake[0]).not.toHaveProperty('jobs');
    expect(await allTicks(w)).toBe(0);
    expect(await audits(w, 'delete')).toHaveLength(ids.length);
  });

  it('deletes the ticks of a brand left out of the write', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id));

    const res = await put(w, { brands: [] });

    expect(res.status).toBe(200);
    expect(await allTicks(w)).toBe(0);
    expect(await audits(w, 'delete')).toHaveLength(ids.length);
  });

  it('starts every job ticked again when a refused brand is taken without jobs', async () => {
    const w = await world();
    const ids = await priced(w);
    await put(w, take(w.bmw.id, [ids[0]]));
    await put(w, { brands: [{ brandId: w.bmw.id, stance: 'does_not_take' }] });

    await put(w, take(w.bmw.id));

    expect(await ticked(w, w.bmw.id)).toEqual([...ids].sort());
  });

  it('does not touch the garage status or the public read when ticks change', async () => {
    const w = await world();
    const ids = await priced(w);

    await put(w, take(w.bmw.id, [ids[0]]));
    await put(w, take(w.bmw.id, []));

    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('approved');
    const read = await http().get(`/garages/${w.nord.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.worksOn[0]).not.toHaveProperty('jobs');
  });
});
