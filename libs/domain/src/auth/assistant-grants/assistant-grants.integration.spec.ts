// @traces 003-FR-015
import { revokeAssistantGrants } from './assistant-grants';
import { AuditService } from '../../audit/audit.service';
import { outbox } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { serialDatabase } from '../serial-db.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const audit = new AuditService();

afterAll(() => prisma.$disconnect());
beforeEach(() => reset());

const grant = (accountId: string, clientId: string, revokedAt?: Date) =>
  prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId,
      clientName: clientId,
      ...(revokedAt && {
        revokedAt,
        revokedBy: accountId,
        revokeReason: 'user',
      }),
    },
  });

const revoke = (
  accountId: string,
  by: Parameters<typeof revokeAssistantGrants>[3]['by'],
  reason: 'role_removed' | 'account_suspended' | 'account_deleted',
) =>
  prisma.$transaction((tx) =>
    revokeAssistantGrants(tx, audit, outbox, { accountId, by, reason }),
  );

describe('revokeAssistantGrants', () => {
  it.each(['role_removed', 'account_suspended', 'account_deleted'] as const)(
    'revokes every live grant of the account with %s, by the acting account',
    async (reason) => {
      const person = await account('Andrei');
      const admin = await account('Ana', ['admin']);
      const other = await account('Ioana');
      const [first, second] = [
        await grant(person, 'claude'),
        await grant(person, 'chatgpt'),
      ];
      await grant(other, 'claude');

      await revoke(person, { id: admin, role: 'admin' }, reason);

      const rows = await prisma.assistantGrant.findMany({
        orderBy: { clientId: 'asc' },
        where: { accountId: person },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.revokedAt).toBeInstanceOf(Date);
        expect(row).toMatchObject({ revokedBy: admin, revokeReason: reason });
      }
      expect(
        await prisma.assistantGrant.count({
          where: { accountId: other, revokedAt: null },
        }),
      ).toBe(1);

      const ids = [first.id, second.id];
      const entries = await prisma.activityLog.findMany({
        where: { kind: 'assistant_grant_revoked', subjectId: { in: ids } },
      });
      expect(entries.map((e) => e.subjectId).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      for (const entry of entries) {
        expect(entry).toMatchObject({
          action: 'update',
          actorId: admin,
          actorRole: 'admin',
          field: 'revoked_at',
          subjectType: 'assistant_grant',
        });
      }

      const events = await prisma.outboxEvent.findMany({
        where: { kind: 'assistant_grant.revoked', subjectId: { in: ids } },
      });
      expect(events.map((e) => e.subjectId).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      for (const event of events) {
        expect(event.audience).toEqual([`account:${person}`]);
        expect(event.payload).toEqual({
          accountId: person,
          grantId: event.subjectId,
          reason,
        });
      }
    },
  );

  it('records system as the one who revoked when no person acted', async () => {
    const person = await account('Andrei');
    const { id } = await grant(person, 'claude');

    await revoke(person, 'system', 'role_removed');

    expect(
      await prisma.assistantGrant.findFirstOrThrow({
        where: { accountId: person },
      }),
    ).toMatchObject({ revokedBy: 'system', revokeReason: 'role_removed' });
    expect(
      await prisma.activityLog.findFirstOrThrow({
        where: { kind: 'assistant_grant_revoked', subjectId: id },
      }),
    ).toMatchObject({ actorId: null, actorRole: 'system' });
  });

  it('leaves a grant already revoked as it was, with no entry or event', async () => {
    const person = await account('Andrei');
    const before = new Date('2026-10-01T10:00:00Z');
    const { id } = await grant(person, 'claude', before);

    await revoke(person, 'system', 'account_suspended');

    expect(
      await prisma.assistantGrant.findFirstOrThrow({
        where: { accountId: person },
      }),
    ).toMatchObject({ revokedAt: before, revokeReason: 'user' });
    expect(await prisma.activityLog.count({ where: { subjectId: id } })).toBe(
      0,
    );
    expect(await prisma.outboxEvent.count({ where: { subjectId: id } })).toBe(
      0,
    );
  });

  it('answers how many grants it revoked', async () => {
    const person = await account('Andrei');
    await grant(person, 'claude');
    await grant(person, 'chatgpt', new Date());

    await expect(revoke(person, 'system', 'role_removed')).resolves.toBe(1);
  });
});
