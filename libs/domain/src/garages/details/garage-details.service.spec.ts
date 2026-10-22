import type { DetailsSection } from '@motor-fix/contracts';
import type { HttpException } from '@nestjs/common';

import { GarageDetailsService } from './garage-details.service';
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

describe('GarageDetailsService with a section that is not an object', () => {
  const service = new GarageDetailsService({} as AuditPort);

  // @traces 208-FR-017
  it.each([null, 'Service Popescu', 7, ['name']])(
    'answers 422 validation_failed for %j on create and update',
    async (given) => {
      const section = given as unknown as DetailsSection;
      for (const call of [
        () => service.create(tx, 'actor', section),
        () => service.update(tx, 'actor', 'garage', section),
      ]) {
        expect(await refusalOf(call)).toMatchObject({
          body: { code: 'validation_failed' },
          status: 422,
        });
      }
    },
  );
});
