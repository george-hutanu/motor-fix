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
  foundVia: 'client',
  liftsCount: '2-3',
  mechanicsCount: '0',
  wantsDaySheets: false,
  wantsLiveMedia: true,
};

let garageId: string;
let actorId: string;

beforeEach(async () => {
  await reset();
  actorId = await account('Mihai Pop', ['garage']);
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const apply = (answers: unknown = ANSWERS) =>
  prisma.$transaction((tx) =>
    applySurvey(tx, { actorId, answers, garageId }, audit),
  );

const counts = async () => ({
  entries: await prisma.activityLog.count({ where: { garageId } }),
  features: await prisma.garageFeature.count({ where: { garageId } }),
  surveys: await prisma.garageSurvey.count({ where: { garageId } }),
});

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return { body: error.getResponse(), status: error.getStatus() };
};

describe("applying a new garage's sign-up survey", () => {
  // @traces 1359-FR-012 1359-FR-013
  it('stores the answers, the five starting features and one owner entry for each', async () => {
    await apply();

    const survey = await prisma.garageSurvey.findUniqueOrThrow({
      where: { garageId },
    });
    expect(survey).toMatchObject(ANSWERS);
    expect(survey.answeredAt).toBeInstanceOf(Date);
    const features = await prisma.garageFeature.findMany({
      orderBy: { key: 'asc' },
      where: { garageId },
    });
    expect(features.map((f) => [f.key, f.enabled])).toEqual([
      ['day_sheets', false],
      ['lift_schedule', true],
      ['live_media', true],
      ['team_mechanics', false],
      ['whatsapp', true],
    ]);
    const entries = await prisma.activityLog.findMany({
      orderBy: { field: 'asc' },
      where: { garageId },
    });
    expect(
      entries.map((e) => [
        e.action,
        e.subjectType,
        e.subjectId,
        e.field,
        e.newValue,
        e.actorId,
        e.actorRole,
      ]),
    ).toEqual(
      features.map((f) => [
        'create',
        'garage_feature',
        garageId,
        f.key,
        f.enabled,
        actorId,
        'owner',
      ]),
    );
  });

  // @traces 1359-FR-012
  it('refuses a second survey for the same garage and writes nothing more', async () => {
    await apply();
    const before = await counts();

    const refusal = await refusalOf(apply({ ...ANSWERS, foundVia: 'google' }));

    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({ code: 'survey_already_answered' });
    expect(await counts()).toEqual(before);
    expect(
      (await prisma.garageSurvey.findUniqueOrThrow({ where: { garageId } }))
        .foundVia,
    ).toBe('client');
  });

  // @traces 1359-FR-012
  it.each([
    ['a missing answer', { ...ANSWERS, foundVia: undefined }],
    ['a count outside its codes', { ...ANSWERS, mechanicsCount: '7' }],
    ['an unknown key', { ...ANSWERS, heard: 'friend' }],
    ['no answers', null],
  ])('refuses %s and writes nothing', async (_, answers) => {
    const refusal = await refusalOf(apply(answers));

    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({ code: 'validation_failed' });
    expect(await counts()).toEqual({ entries: 0, features: 0, surveys: 0 });
  });

  // @traces 1359-FR-012
  it("leaves nothing behind when the caller's transaction rolls back", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await applySurvey(tx, { actorId, answers: ANSWERS, garageId }, audit);
        throw new Error('account creation failed');
      }),
    ).rejects.toThrow('account creation failed');

    expect(await counts()).toEqual({ entries: 0, features: 0, surveys: 0 });
  });

  // @traces 1359-FR-013
  it('goes with its garage', async () => {
    await apply();

    await prisma.garage.delete({ where: { id: garageId } });

    expect(await prisma.garageSurvey.count({ where: { garageId } })).toBe(0);
  });
});
