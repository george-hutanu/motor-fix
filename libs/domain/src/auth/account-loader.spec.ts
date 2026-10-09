// @traces 365-FR-005
import { HttpException } from '@nestjs/common';

import { AccountLoader, actorOf, type LoadedAccount } from './account-loader';
import type { PrismaClient } from '../generated/prisma/client';

const garageId = '5d0a8e64-6b1f-4f62-9d52-55b0a5d1c0a1';
const otherGarageId = '9a1c3b7e-2d4f-4e6a-8b0c-1d2e3f4a5b6c';

function account(overrides: Record<string, unknown> = {}): LoadedAccount {
  return {
    id: '0b6c4c8e-0f0c-4f53-9d53-0d5b8a4f1e11',
    lastRole: 'driver',
    mechanic: null,
    memberships: [],
    roles: [{ role: 'driver' }],
    status: 'active',
    ...overrides,
  } as unknown as LoadedAccount;
}

function loaderFinding(found: LoadedAccount | null) {
  const findUnique = jest.fn().mockResolvedValue(found);
  const prisma = { account: { findUnique } } as unknown as PrismaClient;
  return { findUnique, loader: new AccountLoader(prisma) };
}

async function refusal(run: Promise<unknown>) {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { body: http.getResponse(), status: http.getStatus() };
}

describe('AccountLoader.activeAccount', () => {
  it('loads the account with its roles, memberships and mechanic record', async () => {
    const found = account({ roles: [{ role: 'driver' }, { role: 'garage' }] });
    const { findUnique, loader } = loaderFinding(found);

    await expect(loader.activeAccount(found.id)).resolves.toBe(found);
    expect(findUnique).toHaveBeenCalledWith({
      include: { mechanic: true, memberships: true, roles: true },
      where: { id: found.id },
    });
  });

  it('refuses an account that does not exist with 401', async () => {
    const { loader } = loaderFinding(null);

    expect(await refusal(loader.activeAccount('missing'))).toEqual({
      body: { code: 'sign_in_required', message: 'Sign in to continue' },
      status: 401,
    });
  });

  it('refuses a deleted account with 401', async () => {
    const { loader } = loaderFinding(account({ status: 'deleted' }));

    expect(await refusal(loader.activeAccount('gone'))).toMatchObject({
      body: { code: 'sign_in_required' },
      status: 401,
    });
  });

  it('refuses a suspended account with 403 account_suspended', async () => {
    const { loader } = loaderFinding(account({ status: 'suspended' }));

    expect(await refusal(loader.activeAccount('held'))).toEqual({
      body: { code: 'account_suspended', message: 'This account is suspended' },
      status: 403,
    });
  });
});

describe('actorOf', () => {
  it('builds a driver with every role the account holds and no garage', () => {
    const found = account({ roles: [{ role: 'driver' }, { role: 'admin' }] });

    expect(actorOf(found, 'driver')).toEqual({
      accountId: found.id,
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'driver',
      roles: ['driver', 'admin'],
    });
  });

  it('gives an owner the garage they own, not one they work at as receptionist', () => {
    const found = account({
      memberships: [
        { garageId: otherGarageId, role: 'receptionist' },
        { garageId, role: 'owner' },
      ],
      roles: [{ role: 'garage' }, { role: 'receptionist' }],
    });

    expect(actorOf(found, 'garage').garageId).toBe(garageId);
    expect(actorOf(found, 'receptionist').garageId).toBe(otherGarageId);
  });

  it('gives a mechanic their garage and their permissions', () => {
    const found = account({
      mechanic: {
        canAnswerQuotes: true,
        canMoveBookings: false,
        canRecordFinalPrice: true,
        garageId,
      },
      roles: [{ role: 'mechanic' }],
    });

    expect(actorOf(found, 'mechanic')).toMatchObject({
      garageId,
      permissions: {
        canAnswerQuotes: true,
        canMoveBookings: false,
        canRecordFinalPrice: true,
      },
      role: 'mechanic',
    });
  });

  it('keeps the mechanic permissions off when the role in use is not mechanic', () => {
    const found = account({
      mechanic: {
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
        garageId,
      },
      roles: [{ role: 'mechanic' }, { role: 'driver' }],
    });

    expect(actorOf(found, 'driver')).toMatchObject({
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
    });
  });
});
