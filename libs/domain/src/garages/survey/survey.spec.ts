import { HttpException } from '@nestjs/common';

import { applySurvey } from './survey';
import type { AuditPort } from '../../audit/audit.port';
import { Prisma } from '../../generated/prisma/client';

const ANSWERS = {
  foundVia: 'google',
  liftsCount: '1',
  mechanicsCount: '6+',
  wantsDaySheets: true,
  wantsLiveMedia: false,
};

const audit = { recordMany: jest.fn() } as unknown as AuditPort;

// Two surveys for one garage at the same time: both find none, and the
// second one's insert meets the first one's row.
const raced = (error: unknown) =>
  ({
    garageFeature: { createMany: jest.fn() },
    garageSurvey: {
      create: jest.fn().mockRejectedValue(error),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  }) as unknown as Prisma.TransactionClient;

const apply = (tx: Prisma.TransactionClient) =>
  applySurvey(tx, { actorId: 'a', answers: ANSWERS, garageId: 'g' }, audit);

describe('applySurvey racing another survey', () => {
  // @traces 1359-FR-012
  it('answers 409 when the other survey stored its row first', async () => {
    const tx = raced(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        clientVersion: 'test',
        code: 'P2002',
      }),
    );

    const error = await apply(tx).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'survey_already_answered',
    });
    expect(tx.garageFeature.createMany).not.toHaveBeenCalled();
  });

  it('lets any other failure of the insert through as it was', async () => {
    const failure = new Error('connection lost');

    await expect(apply(raced(failure))).rejects.toBe(failure);
  });
});
