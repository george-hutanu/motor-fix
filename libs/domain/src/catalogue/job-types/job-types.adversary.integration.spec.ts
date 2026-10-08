import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JobTypeLoader } from './job-type-loader';
import { JOB_TYPES } from './job-types';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { CatalogueModule } from '../catalogue.module';

const { prisma } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        redisUrl: redisUrlFor(3),
        tokenSecret: 'test',
      }),
      CatalogueModule,
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

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE job_type, garage CASCADE');
  await app.get(JobTypeLoader).load(JOB_TYPES);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const get = (path: string) => request(app.getHttpServer()).get(path);
const search = (q: string) => get('/job-types').query({ q });
const keys = (body: { items: { key: string }[] }) =>
  body.items.map((item) => item.key);

const add = (
  key: string,
  nameRo: string,
  nameEn: string,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
) => prisma.jobType.create({ data: { key, nameEn, nameRo, status } });

describe('GET /job-types under hostile queries', () => {
  it.each(['%', '_', '%%', '\\', '\\%', '%_'])(
    'treats %j as plain text, matching no job whose name does not contain it',
    async (q) => {
      const res = await search(q);

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    },
  );

  it('finds a job whose name really holds a percent sign, and only that one', async () => {
    await add('discount', 'Reducere 10% iarnă', 'Winter 10% off');

    const res = await search('10%');

    expect(keys(res.body)).toEqual(['discount']);
  });

  it('finds a job whose name really holds an underscore, and only that one', async () => {
    await add('snake', 'Test_job', 'Test job');

    const res = await search('t_j');

    expect(keys(res.body)).toEqual(['snake']);
  });

  it.each([`'; DROP TABLE job_type; --`, `" OR 1=1 --`, '\u0000', 'a\u0000b'])(
    'answers %j without a server error and leaves the catalogue whole',
    async (q) => {
      const res = await search(q);

      expect(res.status).toBeLessThan(500);
      expect(await prisma.jobType.count()).toBe(JOB_TYPES.length);
    },
  );

  it('refuses two q parameters instead of guessing', async () => {
    const res = await get('/job-types?q=frana&q=oil');

    expect(res.status).toBe(400);
  });

  it('refuses a query parameter it does not know', async () => {
    const res = await get('/job-types?q=frana&limit=500');

    expect(res.status).toBe(400);
  });

  it('answers a q of exactly 80 characters and refuses 81', async () => {
    expect((await search('a'.repeat(80))).status).toBe(200);
    expect((await search('a'.repeat(81))).status).toBe(400);
  });

  it('counts 81 accented characters as over the bound', async () => {
    expect((await search('é'.repeat(81))).status).toBe(400);
  });

  it('answers the same list for an empty q as for no q', async () => {
    const empty = await get('/job-types?q=');
    const none = await get('/job-types');

    expect(empty.status).toBe(200);
    expect(empty.body).toEqual(none.body);
  });

  it('answers the same list twice', async () => {
    const first = await search('fr');
    const second = await search('fr');

    expect(second.body).toEqual(first.body);
  });

  it('finds a job by its English name written with other case and accents', async () => {
    await add('clutch', 'Ambreiaj', 'Clütch kit');

    expect(keys((await search('CLUTCH')).body)).toEqual(['clutch']);
  });

  it('finds a job by a Romanian name typed without its diacritics, for every Romanian letter', async () => {
    await add('letters', 'Țeavă și șurub în tăiș', 'Pipe');

    expect(keys((await search('teava si surub in tais')).body)).toEqual([
      'letters',
    ]);
    expect(keys((await search('ȚEAVĂ ȘI ŞURUB')).body)).toEqual(['letters']);
  });

  it('never lists a pending or rejected job even when the text matches it exactly', async () => {
    await add('pend', 'Zzz în așteptare', 'Zzz pending', 'pending');
    await add('rej', 'Zzz respins', 'Zzz rejected', 'rejected');
    await add('ok', 'Zzz bun', 'Zzz fine');

    expect(keys((await search('zzz')).body)).toEqual(['ok']);
  });

  it('answers at most twenty when thirty match, and the twenty are the first by name', async () => {
    for (let n = 0; n < 30; n++)
      await add(`m-${n}`, `Mmm ${String(n).padStart(2, '0')}`, `Mmm ${n}`);

    const res = await search('mmm');

    expect(res.body.items).toHaveLength(20);
    expect(res.body.items[0].nameRo).toBe('Mmm 00');
    expect(res.body.items[19].nameRo).toBe('Mmm 19');
  });

  it('answers all twenty when exactly twenty match', async () => {
    for (let n = 0; n < 20; n++) await add(`e-${n}`, `Eee ${n}`, `Eee ${n}`);

    expect((await search('eee')).body.items).toHaveLength(20);
  });

  it('answers the shape of a job with an id, a key and both names, and nothing about status or proposer', async () => {
    const res = await search('diagnos');

    expect(res.body.items[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      key: 'diagnosis',
      nameEn: expect.any(String),
      nameRo: expect.any(String),
    });
  });

  it('answers without a session cookie or token', async () => {
    const res = await get('/job-types')
      .set('Cookie', '')
      .unset('Authorization');

    expect(res.status).toBe(200);
  });

  it('answers a bad session token as a visitor, not as a refusal', async () => {
    const res = await get('/job-types').set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(200);
  });

  it('refuses a write to the route', async () => {
    const res = await request(app.getHttpServer()).post('/job-types').send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
