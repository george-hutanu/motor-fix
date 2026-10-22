import type { StartingPricesInput } from '@motor-fix/contracts';
import type { HttpException } from '@nestjs/common';

import { GaragePricesService } from './garage-prices.service';
import type { AuditPort } from '../../../audit/audit.port';
import type { EventPort } from '../../../events/event.port';
import type { Prisma } from '../../../generated/prisma/client';

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

describe('GaragePricesService with a section that is not an object', () => {
  const service = new GaragePricesService({} as AuditPort, {} as EventPort);

  // @traces 208-FR-017
  it.each([null, 'labour', 7, [{ jobs: [] }]])(
    'answers 422 validation_failed for %j on the first and the next save',
    async (given) => {
      const section = given as unknown as StartingPricesInput;
      for (const call of [
        () => service.saveStarting(tx, 'garage', 'actor', section),
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
