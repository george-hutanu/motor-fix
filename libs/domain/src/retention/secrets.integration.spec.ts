import { randomUUID } from 'node:crypto';

import { RETENTION_BATCH } from './retention.config';
import { retentionFixtures } from './retention.testing';
import { SECRET_KINDS, sweepExpired } from './secrets';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl } from '../notifications/notifications.testing';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const data = retentionFixtures(prisma);
const now = new Date('2026-10-24T10:00:00.000Z');
const outside = new Date(now.getTime() - 1);
const inside = new Date(now.getTime() + 1);
const atNow = now;

afterAll(() => prisma.$disconnect());
beforeEach(() => data.reset());

const sweepAll = async () => {
  const counts: Record<string, number> = {};
  for (const kind of SECRET_KINDS)
    counts[kind] = await sweepExpired(prisma, kind, now);
  return counts;
};

// @traces 1156-FR-004
describe('the expired secrets sweep', () => {
  it('covers the five secret kinds in order', () => {
    expect(SECRET_KINDS).toEqual([
      'sign_in_code',
      'phone_change',
      'account_token',
      'refresh_token',
      'staff_invite',
    ]);
  });

  it('deletes only what expired before now, used or not, and counts each kind', async () => {
    const a = await data.account('ana');
    const b = await data.account('bogdan');
    const c = await data.account('carmen');
    const garage = await data.garage();
    await prisma.signInCode.createMany({
      data: [
        { codeHash: 'h', expiresAt: outside, phone: '+40711000001' },
        {
          codeHash: 'h',
          expiresAt: outside,
          phone: '+40711000002',
          usedAt: now,
        },
        { codeHash: 'h', expiresAt: inside, phone: '+40711000003' },
        { codeHash: 'h', expiresAt: atNow, phone: '+40711000004' },
      ],
    });
    await prisma.phoneChange.createMany({
      data: [
        {
          accountId: a,
          codeHash: 'h',
          expiresAt: outside,
          phone: '+40711000005',
        },
        {
          accountId: b,
          codeHash: 'h',
          expiresAt: inside,
          phone: '+40711000006',
        },
      ],
    });
    const purposes = [
      'email_confirm',
      'password_reset',
      'email_change',
    ] as const;
    await prisma.accountToken.createMany({
      data: purposes.flatMap((purpose) => [
        {
          accountId: a,
          email: 'a@example.test',
          expiresAt: outside,
          purpose,
          tokenHash: randomUUID(),
        },
        {
          accountId: a,
          email: 'a@example.test',
          expiresAt: outside,
          purpose,
          tokenHash: randomUUID(),
          usedAt: now,
        },
        {
          accountId: a,
          email: 'a@example.test',
          expiresAt: inside,
          purpose,
          tokenHash: randomUUID(),
        },
      ]),
    });
    const familyId = randomUUID();
    await prisma.refreshToken.createMany({
      data: [
        { accountId: c, expiresAt: outside, familyId, tokenHash: randomUUID() },
        {
          accountId: c,
          expiresAt: outside,
          familyId,
          tokenHash: randomUUID(),
          usedAt: now,
        },
        { accountId: c, expiresAt: inside, familyId, tokenHash: randomUUID() },
      ],
    });
    const invite = (
      status: 'sent' | 'accepted' | 'revoked',
      expiresAt: Date,
    ) => ({
      email: 'staff@example.test',
      expiresAt,
      garageId: garage,
      kind: 'mechanic' as const,
      name: 'Staff',
      status,
      tokenHash: randomUUID(),
    });
    await prisma.staffInvite.createMany({
      data: [
        invite('sent', outside),
        invite('sent', inside),
        invite('accepted', outside),
        invite('revoked', outside),
      ],
    });

    expect(await sweepAll()).toEqual({
      account_token: 6,
      phone_change: 1,
      refresh_token: 2,
      sign_in_code: 2,
      staff_invite: 1,
    });

    expect(
      (await prisma.signInCode.findMany()).map((r) => r.phone).sort(),
    ).toEqual(['+40711000003', '+40711000004']);
    expect(
      await prisma.phoneChange.findMany({ select: { accountId: true } }),
    ).toEqual([{ accountId: b }]);
    expect(await prisma.accountToken.count()).toBe(3);
    expect(
      await prisma.accountToken.count({ where: { expiresAt: { lt: now } } }),
    ).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(
      (await prisma.staffInvite.findMany({ orderBy: { status: 'asc' } })).map(
        (r) => [r.status, r.expiresAt < now],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['sent', false],
        ['accepted', true],
        ['revoked', true],
      ]),
    );
    expect(await prisma.staffInvite.count()).toBe(3);
  });

  it('removes nothing the second time', async () => {
    await prisma.signInCode.create({
      data: { codeHash: 'h', expiresAt: outside, phone: '+40711000001' },
    });
    await sweepAll();
    expect(Object.values(await sweepAll())).toEqual([0, 0, 0, 0, 0]);
  });
});

// @traces 1156-FR-013
describe('the batches', () => {
  it('keep going until every expired row is gone', async () => {
    await prisma.$executeRaw`
      INSERT INTO sign_in_code (phone, code_hash, expires_at)
      SELECT '+4079' || lpad(n::text, 7, '0'), 'h', ${outside}
        FROM generate_series(1, ${RETENTION_BATCH * 2 + 5}) AS n`;
    await prisma.signInCode.create({
      data: { codeHash: 'h', expiresAt: inside, phone: '+40711000009' },
    });
    expect(await sweepExpired(prisma, 'sign_in_code', now)).toBe(
      RETENTION_BATCH * 2 + 5,
    );
    expect(await prisma.signInCode.count()).toBe(1);
  });
});
