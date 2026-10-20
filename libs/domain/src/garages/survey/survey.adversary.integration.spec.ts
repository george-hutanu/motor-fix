import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { applySurvey } from './survey';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
const audit = new AuditService();
serialDatabase(databaseUrl);

const ANSWERS = {
  foundVia: 'google',
  liftsCount: '1',
  mechanicsCount: '6+',
  wantsDaySheets: true,
  wantsLiveMedia: false,
};

let garageId: string;
let actorId: string;

beforeEach(async () => {
  await reset();
  actorId = await account('Ana Ionescu', ['garage']);
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Sud', slug: `sud-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const apply = (answers: unknown = ANSWERS, id: string = garageId) =>
  prisma.$transaction((tx) =>
    applySurvey(tx, { actorId, answers, garageId: id }, audit),
  );

const counts = async () => ({
  entries: await prisma.activityLog.count({ where: { garageId } }),
  features: await prisma.garageFeature.count({ where: { garageId } }),
  surveys: await prisma.garageSurvey.count({ where: { garageId } }),
});

const outcome = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({
      error,
      status: error instanceof HttpException ? error.getStatus() : undefined,
    }),
  );

describe('applySurvey under hostile input', () => {
  // @traces 1359-FR-012
  it.each([
    ['an array', [ANSWERS]],
    ['a text', 'google'],
    ['an empty object', {}],
    ['a null answer', { ...ANSWERS, liftsCount: null }],
    ['a text yes', { ...ANSWERS, wantsLiveMedia: 'false' }],
    ['a feature key smuggled in', { ...ANSWERS, whatsapp: false }],
    ['an unknown key', { ...ANSWERS, garageId: randomUUID() }],
  ])('refuses %s with a 400 and writes nothing', async (_, answers) => {
    const result = await outcome(apply(answers));

    expect(result).toMatchObject({ status: 400 });
    expect(await counts()).toEqual({ entries: 0, features: 0, surveys: 0 });
  });

  // @traces 1359-FR-012
  it('refuses answers that only inherit their values with a 400', async () => {
    const inherited = Object.create(ANSWERS) as unknown;

    const result = await outcome(apply(inherited));

    expect(result).toMatchObject({ status: 400 });
    expect(await counts()).toEqual({ entries: 0, features: 0, surveys: 0 });
  });

  // @traces 1359-FR-012
  it('stores no extra column from answers carrying a null-prototype object', async () => {
    await apply(Object.assign(Object.create(null), ANSWERS));

    expect(await prisma.garageSurvey.count({ where: { garageId } })).toBe(1);
  });

  // @traces 1359-FR-012
  it('fails and leaves nothing for a garage that does not exist', async () => {
    const result = await outcome(apply(ANSWERS, randomUUID()));

    expect(result).toHaveProperty('error');
    expect(await prisma.garageSurvey.count()).toBe(0);
    expect(await prisma.garageFeature.count()).toBe(0);
  });

  // @traces 1359-FR-012
  it('answers 409 to the second of two surveys applied at the same time', async () => {
    const results = await Promise.all([outcome(apply()), outcome(apply())]);

    expect(results.filter((r) => 'ok' in r)).toHaveLength(1);
    expect(
      results
        .filter((r) => 'status' in r)
        .map((r) => 'status' in r && r.status),
    ).toEqual([409]);
    expect(await counts()).toEqual({ entries: 5, features: 5, surveys: 1 });
  });

  // @traces 1359-FR-012
  it('keeps the first survey when a second with other answers is refused', async () => {
    await apply();
    const result = await outcome(apply({ ...ANSWERS, mechanicsCount: '0' }));

    expect(result).toMatchObject({ status: 409 });
    expect(
      (
        await prisma.garageFeature.findFirstOrThrow({
          where: { garageId, key: 'team_mechanics' },
        })
      ).enabled,
    ).toBe(true);
  });

  // @traces 1359-FR-012
  it('writes a survey for one garage without touching another', async () => {
    const other = await prisma.garage.create({
      data: { name: 'Service Auto Est', slug: `est-${randomUUID()}` },
    });
    await apply();

    expect(
      await prisma.garageSurvey.count({ where: { garageId: other.id } }),
    ).toBe(0);
    expect(
      await prisma.garageFeature.count({ where: { garageId: other.id } }),
    ).toBe(0);
    await apply(ANSWERS, other.id);
    expect(await prisma.garageSurvey.count()).toBe(2);
  });
});
