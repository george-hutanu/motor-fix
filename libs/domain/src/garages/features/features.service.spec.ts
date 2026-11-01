import { FEATURE_KEYS } from '@motor-fix/contracts';

import { featureOn } from './feature-on';
import { GarageFeaturesService } from './features.service';
import type { AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import type { EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';

vi.mock('./feature-on', async (actualModule) => ({
  featureOn: vi.fn(
    (await actualModule<typeof import('./feature-on')>()).featureOn,
  ),
}));

const garageId = '00000000-0000-4000-8000-000000000001';
const owner = {
  accountId: 'owner',
  garageId,
  permissions: {},
  role: 'garage',
  roles: ['garage'],
} as unknown as Actor;

function service(stored: Record<string, boolean>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: garageId }]),
    garageFeature: {
      findUnique: vi.fn(({ where }) => {
        const key = where.garageId_key.key as string;
        return Promise.resolve(key in stored ? { enabled: stored[key] } : null);
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaClient;
  const audit = { record: vi.fn() } as unknown as AuditPort;
  const events = { record: vi.fn() } as unknown as EventPort;
  return { svc: new GarageFeaturesService(prisma, audit, events), tx };
}

// @traces 398-FR-007
describe('GarageFeaturesService.set reads the switches through featureOn', () => {
  beforeEach(() => {
    vi.mocked(featureOn).mockClear();
  });

  it('asks featureOn for every key inside the write transaction', async () => {
    const { svc, tx } = service({ lift_schedule: false });

    const res = await svc.set(owner, garageId, 'whatsapp', false);

    for (const key of FEATURE_KEYS) {
      expect(featureOn).toHaveBeenCalledWith(tx, garageId, key);
    }
    expect(res.features.lift_schedule).toBe(false);
    expect(res.features.whatsapp).toBe(false);
  });

  it('answers a no-op write from featureOn without writing', async () => {
    const { svc, tx } = service({ day_sheets: false });

    const res = await svc.set(owner, garageId, 'day_sheets', false);

    expect(featureOn).toHaveBeenCalledWith(tx, garageId, 'day_sheets');
    expect(tx.garageFeature.upsert).not.toHaveBeenCalled();
    expect(res.features.day_sheets).toBe(false);
  });
});
