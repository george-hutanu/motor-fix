import { Logger } from '@nestjs/common';

import { LegalCheckService } from './legal-check.service';
import type { Actor } from '../../../auth/policy';
import type { PrismaClient } from '../../../generated/prisma/client';

const garageId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

const actor = (role: Actor['role'], garage: string | null = garageId): Actor =>
  ({
    accountId: '33333333-3333-4333-8333-333333333333',
    garageId: garage,
    permissions: {},
    role,
    roles: [role],
  }) as unknown as Actor;

const service = (garage: unknown = null) =>
  new LegalCheckService({
    garage: { findUnique: jest.fn().mockResolvedValue(garage) },
    rarActivity: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient);

// @traces 210-FR-013
describe('a refused legal check read', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['receptionist', 'mechanic'] as const)(
    'writes one forbidden line for a %s of the garage',
    async (role) => {
      await expect(service().read(actor(role), garageId)).rejects.toMatchObject(
        {
          status: 403,
        },
      );
      expect(warn.mock.calls).toEqual([
        [`legal check refused: forbidden (role ${role})`],
      ]);
    },
  );

  it('writes one not_found line for an outsider, naming no account', async () => {
    await expect(
      service().read(actor('garage', otherId), garageId),
    ).rejects.toMatchObject({ status: 404 });
    expect(warn.mock.calls).toEqual([
      ['legal check refused: not_found (role garage)'],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('3333');
  });

  it('writes one not_found line when the garage is not approved', async () => {
    await expect(
      service({ status: 'pending', verificationFiles: [] }).read(
        actor('garage'),
        garageId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(warn.mock.calls).toEqual([
      ['legal check refused: not_found (role garage)'],
    ]);
  });
});
