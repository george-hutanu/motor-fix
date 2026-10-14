import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import request from 'supertest';

import { SearchLogService } from './search-log.service';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { until } from '../../waits.testing';
import { SearchModule } from '../search.module';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(11);
const { prisma } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;
let dacia: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
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
  jest.restoreAllMocks();
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  const garage = await prisma.garage.create({
    data: {
      latitude: 46.771,
      longitude: 23.624,
      name: 'Alfa Service',
      slug: 'alfa-service',
      status: 'approved',
    },
  });
  await prisma.garageBrand.create({
    data: { brandId: dacia, garageId: garage.id, stance: 'works_on' },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const search = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

type Row = { brand_id: string; area_cell: string | null };

const rows = () =>
  prisma.$queryRaw<
    Row[]
  >`SELECT brand_id::text, area_cell FROM search_log ORDER BY at`;

// The log is written after the answer: wait for the rows a test expects.
// A request that should write nothing is followed by one that writes a row,
// so once that row is there, anything the earlier one wrote is too.
const rowsReach = (count: number) =>
  until(`${count} search log rows`, async () => {
    const found = await rows();
    return found.length >= count && found;
  });

async function logCounts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_search_log_total');
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'],
      point.value,
    ]),
  ) as Record<string, number | undefined>;
}

// @traces 267-FR-007 267-FR-008
describe('the search log, through the search', () => {
  it('writes one row for a new search: the brand and the cell of the rounded place', async () => {
    const res = await search({
      brand: 'dacia',
      log: '1',
      near: '46.71352,23.624',
    });

    expect(res.status).toBe(200);
    // 46.71352 is cell u82c9; rounded to 46.714 it is u82cc.
    expect(await rowsReach(1)).toEqual([
      { area_cell: 'u82cc', brand_id: dacia },
    ]);
  });

  it('writes a null cell for a search without a place', async () => {
    await search({ brandId: dacia, log: '1' }).expect(200);

    expect(await rowsReach(1)).toEqual([{ area_cell: null, brand_id: dacia }]);
  });

  it('writes a row for every new search, the second answered from the cache', async () => {
    await search({ brand: 'dacia', log: '1', near: '46.771,23.624' }).expect(
      200,
    );
    await search({ brand: 'dacia', log: '1', near: '46.771,23.624' }).expect(
      200,
    );

    expect(await rowsReach(2)).toEqual([
      { area_cell: 'u82f1', brand_id: dacia },
      { area_cell: 'u82f1', brand_id: dacia },
    ]);
  });

  it('writes nothing for a search without log, an ids read, a retry or a widening', async () => {
    const garageId = (await prisma.garage.findFirstOrThrow()).id;
    await search({ brand: 'dacia', near: '46.771,23.624' }).expect(200);
    await search({
      brand: 'dacia',
      near: '46.771,23.624',
      radius: '50',
    }).expect(200);
    await search({ brand: 'dacia', ids: garageId, log: '1' }).expect(200);
    await search({ brand: 'dacia' }).expect(200);

    await search({ brand: 'dacia', log: '1' }).expect(200);

    expect(await rowsReach(1)).toEqual([{ area_cell: null, brand_id: dacia }]);
  });

  it('writes nothing for a refused search', async () => {
    await search({ brand: 'nobody', log: '1' }).expect(404);
    await search({ brand: 'dacia', log: '1', radius: '30' }).expect(400);

    await search({ brand: 'dacia', log: '1' }).expect(200);

    expect(await rowsReach(1)).toHaveLength(1);
  });
});

// @traces 267-FR-008
describe('SearchLogService.record', () => {
  it('counts a written row', async () => {
    const before = (await logCounts())['written'] ?? 0;

    await new SearchLogService(prisma).record({
      brandId: dacia,
      point: { lat: 44.427, lng: 26.103 },
    });

    expect(await rows()).toEqual([{ area_cell: 'sxfs9', brand_id: dacia }]);
    expect(((await logCounts())['written'] ?? 0) - before).toBe(1);
  });

  it('never throws when the write fails: it logs one warn without the place and counts the failure', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const before = (await logCounts())['failed'] ?? 0;

    // No such brand: the row's foreign key refuses it.
    await expect(
      new SearchLogService(prisma).record({
        brandId: randomUUID(),
        point: { lat: 44.427, lng: 26.103 },
      }),
    ).resolves.toBeUndefined();

    expect(await rows()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toMatch(/search log/i);
    expect(message).not.toMatch(/44\.427|26\.103|sxfs9/);
    expect(((await logCounts())['failed'] ?? 0) - before).toBe(1);
  });

  it('answers the search without waiting for the write', async () => {
    const record = jest
      .spyOn(SearchLogService.prototype, 'record')
      .mockReturnValue(new Promise<void>(() => undefined));

    const res = await search({ brand: 'dacia', log: '1' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
