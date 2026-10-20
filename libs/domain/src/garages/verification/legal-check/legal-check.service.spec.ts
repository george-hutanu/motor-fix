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

const file = {
  checks: [
    { detail: null, kind: 'company', recordedAt: null, result: 'ok' },
    { detail: null, kind: 'caen', recordedAt: null, result: 'ok' },
    { detail: null, kind: 'rar', recordedAt: null, result: 'ok' },
  ],
  documents: [
    { kind: 'onrc_certificate', status: 'valid' },
    { kind: 'rar_authorisation', status: 'valid' },
  ],
};

const garage = (over: Record<string, unknown> = {}) => ({
  businessKind: 'workshop',
  lastCheckedOn: new Date('2026-08-10T00:00:00Z'),
  name: 'ATELIER DINAMO SRL',
  rarActivities: [],
  rechecks: [],
  status: 'approved',
  suspensions: [],
  verificationFiles: [file],
  ...over,
});

const failedRecheck = {
  checkedOn: new Date('2026-09-12T00:00:00Z'),
  detail: 'Autorizația a expirat la 31 august',
  failure: 'expired',
  result: 'failed',
};

// @traces 1354-FR-001 1354-FR-002
describe('the legal check read of a suspended garage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('answers with its status and its latest re-check', async () => {
    const answer = await service(
      garage({
        rechecks: [failedRecheck],
        status: 'suspended',
        suspensions: [{ cause: 'admin' }],
      }),
    ).read(actor('garage'), garageId);
    expect(answer).toMatchObject({
      lastCheckedOn: '2026-08-10',
      latestRecheck: {
        checkedOn: '2026-09-12',
        detail: 'Autorizația a expirat la 31 august',
        failure: 'expired',
        result: 'failed',
      },
      status: 'suspended',
    });
  });

  it('answers an approved garage never re-checked with no re-check', async () => {
    const answer = await service(garage()).read(actor('garage'), garageId);
    expect(answer).toMatchObject({ latestRecheck: null, status: 'approved' });
  });

  it('is not found for a draft garage', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await expect(
      service(garage({ status: 'draft' })).read(actor('garage'), garageId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// @traces 1354-FR-004
describe('the RAR row of the legal check read', () => {
  it('shows the failed re-check when it caused the open suspension', async () => {
    const { rows } = await service(
      garage({
        rechecks: [failedRecheck],
        status: 'suspended',
        suspensions: [{ cause: 'recheck_failed' }],
      }),
    ).read(actor('garage'), garageId);
    expect(rows[2]).toMatchObject({
      checkedOn: '2026-09-12',
      detail: 'Autorizația a expirat la 31 august',
      state: 'failed',
    });
  });

  it('is the ordinary row when an admin suspended the garage', async () => {
    const { rows } = await service(
      garage({
        rechecks: [failedRecheck],
        status: 'suspended',
        suspensions: [{ cause: 'admin' }],
      }),
    ).read(actor('garage'), garageId);
    expect(rows[2]).toMatchObject({ checkedOn: '2026-08-10', state: 'ok' });
  });
});
