import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GarageProfileService } from './garage-profile.service';
import type { Actor } from '../../auth/policy';

// @traces 133-FR-002 133-FR-014

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const PERMISSIONS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};
const actor = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({
    accountId: 'a-1',
    garageId,
    permissions: PERMISSIONS,
    role,
    roles: [role],
  }) as Actor;

function service(row: { phone: string | null; slug: string } | null) {
  const findUnique = jest.fn(async () => row);
  const bySlug = jest.fn(async (slug: string) => ({ name: 'Nord', slug }));
  const profile = new GarageProfileService(
    { garage: { findUnique } } as never,
    { bySlug } as never,
  );
  return { bySlug, findUnique, profile };
}

const status = (failure: unknown) =>
  (failure as { getStatus(): number }).getStatus();

describe("the staff read of a garage's own public profile, in order", () => {
  it('reads the public answer by the garage slug and adds the stored phone', async () => {
    const { bySlug, profile } = service({
      phone: '+40722123456',
      slug: 'nord',
    });

    await expect(profile.read(actor('garage'), GARAGE)).resolves.toEqual({
      name: 'Nord',
      phone: '+40722123456',
      slug: 'nord',
    });
    expect(bySlug).toHaveBeenCalledWith('nord');
  });

  it.each(['mechanic', 'receptionist'] as const)(
    'refuses the %s before reading the garage, even with every permission',
    async (role) => {
      const { findUnique, profile } = service({ phone: null, slug: 'nord' });

      const failure = await profile.read(actor(role), GARAGE).catch((e) => e);

      expect(status(failure)).toBe(403);
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['another garage', actor('garage', 'other')],
    ['no garage', actor('admin', null)],
  ])('answers 404 for %s without reading anything', async (_, who) => {
    const { findUnique, profile } = service({ phone: null, slug: 'nord' });

    const failure = await profile.read(who, GARAGE).catch((e) => e);

    expect(status(failure)).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 when the row is gone between the check and the read', async () => {
    const { bySlug, profile } = service(null);

    const failure = await profile.read(actor('garage'), GARAGE).catch((e) => e);

    expect(status(failure)).toBe(404);
    expect(bySlug).not.toHaveBeenCalled();
  });
});

describe('the staff read in the observability inventory', () => {
  it('lists the route with the API panels and no alert of its own', () => {
    const inventory = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../infra/observability/inventory.json'),
        'utf8',
      ),
    ) as { entries: { name: string; [key: string]: unknown }[] };

    expect(
      inventory.entries.find((entry) => entry.name === 'garage-profile'),
    ).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      kind: 'endpoint',
      metric: expect.stringContaining('/api/v1/garages/:garageId/profile'),
      source:
        'libs/domain/src/garages/garage-profile/garage-profile.controller.ts',
    });
  });
});
