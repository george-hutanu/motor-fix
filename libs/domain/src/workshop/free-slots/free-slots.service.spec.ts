// @traces 098-FR-005
import type { FreeSlotsDto } from '@motor-fix/contracts';

import type { FreeSlotsCache, FreeSlotsKey } from './free-slots.cache';
import { FreeSlotsService } from './free-slots.service';
import type { PrismaClient } from '../../generated/prisma/client';

const KEY: FreeSlotsKey = {
  count: 10,
  duration: 60,
  earliest: new Date('2026-11-04T09:30:00Z'),
  garageId: 'g-1',
  horizonDays: 5,
  needsLift: false,
};

describe('the free-slot answer for a question already put together', () => {
  it('comes from the cache under that question', async () => {
    const cached: FreeSlotsDto = {
      slots: [
        {
          endsAt: '2026-11-06T11:00:00+02:00',
          startsAt: '2026-11-06T10:00:00+02:00',
        },
      ],
    };
    const entry = vi.fn(async () => cached);
    const service = new FreeSlotsService(
      {} as PrismaClient,
      { entry } as unknown as FreeSlotsCache,
    );

    await expect(service.answer(KEY)).resolves.toBe(cached);
    expect(entry).toHaveBeenCalledWith(KEY, expect.any(Function));
  });

  it('passes a failure of the read on to the caller', async () => {
    const service = new FreeSlotsService(
      {} as PrismaClient,
      {
        entry: (_key: FreeSlotsKey, read: () => Promise<FreeSlotsDto>) =>
          read(),
      } as unknown as FreeSlotsCache,
    );

    await expect(service.answer(KEY)).rejects.toThrow();
  });
});
