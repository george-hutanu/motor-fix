import type { MechanicsSection } from '@motor-fix/contracts';
import type { HttpException } from '@nestjs/common';

import { GarageMechanicsService } from './garage-mechanics.service';
import type { AuditPort } from '../../audit/audit.port';
import type { Prisma } from '../../generated/prisma/client';

// Any read of the transaction fails the test: the guard runs before one.
const tx = new Proxy({} as Prisma.TransactionClient, {
  get: (_, key) => {
    throw new Error(`read ${String(key)}`);
  },
});

const refusalOf = (call: () => Promise<unknown>) =>
  call().then(
    () => undefined,
    (error: HttpException) => ({
      body: error.getResponse(),
      status: error.getStatus(),
    }),
  );

describe('GarageMechanicsService with a section that is not an object', () => {
  const service = new GarageMechanicsService({} as AuditPort);

  // @traces 208-FR-017
  it.each([null, 'Ion Marin', 7, [{ name: 'Ion' }]])(
    'answers 422 validation_failed for %j on the first and the next save',
    async (given) => {
      const section = given as unknown as MechanicsSection;
      for (const call of [
        () => service.saveCards(tx, 'garage', 'actor', section),
        () => service.saveAgain(tx, 'garage', 'actor', section),
      ]) {
        expect(await refusalOf(call)).toMatchObject({
          body: { code: 'validation_failed' },
          status: 422,
        });
      }
    },
  );
});
