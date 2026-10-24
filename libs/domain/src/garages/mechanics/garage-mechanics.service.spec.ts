import type { MechanicsSection } from '@motor-fix/contracts';
import type { HttpException } from '@nestjs/common';

import { GarageMechanicsService } from './garage-mechanics.service';
import type { AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
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

const GARAGE = '0f9c2a54-6a1e-4f43-9d2b-2f5a3c1d7e10';
const actorOf = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({ accountId: 'owner-account', garageId, role }) as Actor;

// Any read fails the test: the access check runs before one.
const untouched = new Proxy({} as Prisma.TransactionClient, {
  get: (_, key) => {
    throw new Error(`read ${String(key)}`);
  },
});

const card = (over: Record<string, unknown>) => ({
  accountId: null,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ion',
  onProfile: true,
  rating: null,
  reviewCount: 0,
  speciality: null,
  ...over,
});

const listed = (rows: ReturnType<typeof card>[]) => {
  const prisma = {
    garageFeature: { findUnique: async () => null },
    mechanic: { findMany: jest.fn(async () => rows) },
  };
  return {
    list: (actor: Actor) =>
      new GarageMechanicsService({} as AuditPort).list(
        prisma as unknown as Prisma.TransactionClient,
        actor,
        GARAGE,
      ),
  };
};

// @traces 055-FR-002
describe("GarageMechanicsService reading a garage's team", () => {
  it.each([
    ['receptionist', 403, 'forbidden'],
    ['mechanic', 403, 'forbidden'],
  ] as const)(
    'refuses the garage %s with %i %s before any read',
    async (role, status, code) => {
      const service = new GarageMechanicsService({} as AuditPort);

      expect(
        await refusalOf(() => service.list(untouched, actorOf(role), GARAGE)),
      ).toMatchObject({ body: { code }, status });
    },
  );

  it.each([
    ['a driver', actorOf('driver', null)],
    ['an admin', actorOf('admin', null)],
    ["another garage's owner", actorOf('garage', 'another-garage')],
  ])('answers %s 404 not_found before any read', async (_, actor) => {
    const service = new GarageMechanicsService({} as AuditPort);

    expect(
      await refusalOf(() => service.list(untouched, actor, GARAGE)),
    ).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
  });
});

// @traces 055-FR-001
describe("GarageMechanicsService listing a garage's cards", () => {
  it('orders the cards by name as Romanian sorts them, equal names by id', async () => {
    const { list } = listed([
      card({ id: '00000000-0000-4000-8000-000000000004', name: 'Tudor' }),
      card({ id: '00000000-0000-4000-8000-000000000003', name: 'Ștefan' }),
      card({ id: '00000000-0000-4000-8000-000000000002', name: 'stan' }),
      card({ id: '00000000-0000-4000-8000-000000000009', name: 'Ion' }),
      card({ id: '00000000-0000-4000-8000-000000000001', name: 'ion' }),
    ]);

    const { items } = await list(actorOf('garage'));

    expect(items.map((item) => [item.name, item.id.slice(-1)])).toEqual([
      ['ion', '1'],
      ['Ion', '9'],
      ['stan', '2'],
      ['Ștefan', '3'],
      ['Tudor', '4'],
    ]);
  });

  it('answers each card with its account, its speciality or null, and its figures', async () => {
    const { list } = listed([
      card({
        accountId: 'mechanic-account',
        name: 'Andrei',
        rating: { toFixed: (digits: number) => (5).toFixed(digits) },
        reviewCount: 58,
        speciality: 'Frâne',
      }),
      card({
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Costel',
        onProfile: false,
      }),
    ]);

    expect(await list(actorOf('garage'))).toEqual({
      items: [
        {
          hasAccount: true,
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Andrei',
          onProfile: true,
          rating: '5.0',
          reviewCount: 58,
          speciality: 'Frâne',
        },
        {
          hasAccount: false,
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Costel',
          onProfile: false,
          rating: null,
          reviewCount: 0,
          speciality: null,
        },
      ],
    });
  });
});
