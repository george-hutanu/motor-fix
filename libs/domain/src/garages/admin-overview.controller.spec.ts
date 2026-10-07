import { AdminOverviewController } from './admin-overview.controller';
import type { VerificationService } from './verification.service';
import type { PrismaClient } from '../generated/prisma/client';

const prisma = {} as PrismaClient;

const controller = (waiting: number) => {
  const countWaiting = jest.fn(async () => waiting);
  const verification = { countWaiting } as unknown as VerificationService;
  return {
    countWaiting,
    overview: new AdminOverviewController(prisma, verification),
  };
};

describe('the admin overview route', () => {
  it('answers the number of garages waiting, counted on the database', async () => {
    const { countWaiting, overview } = controller(4);

    await expect(overview.overview()).resolves.toEqual({ garagesWaiting: 4 });
    expect(countWaiting).toHaveBeenCalledWith(prisma);
  });

  it('counts again at every call', async () => {
    const { countWaiting, overview } = controller(0);

    await overview.overview();
    await overview.overview();

    expect(countWaiting).toHaveBeenCalledTimes(2);
  });

  it('is open only to a session that may review garages', () => {
    const required = Reflect.getMetadata(
      'auth:requires',
      AdminOverviewController.prototype.overview,
    );

    expect(required).toBe('admin.garages');
  });
});
