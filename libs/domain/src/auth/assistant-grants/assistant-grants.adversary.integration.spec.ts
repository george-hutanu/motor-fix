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
let seenEntries = 0;
let seenEvents = 0;
const totalEntries = () =>
  prisma.activityLog.count({ where: { kind: 'assistant_grant_revoked' } });
const totalEvents = () =>
  prisma.outboxEvent.count({ where: { kind: 'assistant_grant.revoked' } });
beforeEach(async () => {
  await reset();
  seenEntries = await totalEntries();
  seenEvents = await totalEvents();
});

const grants = (accountId: string, n: number) =>
  prisma.assistantGrant.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      accountId,
      canAct: true,
      canRead: true,
      clientId: `client-${i}`,
      clientName: `client-${i}`,
    })),
  });

const revoke = (
  accountId: string,
  by: Parameters<typeof revokeAssistantGrants>[3]['by'],
  reason:
    | 'role_removed'
    | 'account_suspended'
    | 'account_deleted' = 'role_removed',
) =>
  prisma.$transaction((tx) =>
    revokeAssistantGrants(tx, audit, outbox, { accountId, by, reason }),
  );

const entries = async () => (await totalEntries()) - seenEntries;
const events = async () => (await totalEvents()) - seenEvents;

describe('revokeAssistantGrants under attack', () => {
  it('answers 0 and writes nothing for an account with no grant', async () => {
    const person = await account('Andrei');

    expect(await revoke(person, 'system')).toBe(0);
    expect(await entries()).toBe(0);
    expect(await events()).toBe(0);
  });

  it('answers 0 for an account id that does not exist', async () => {
    expect(await revoke('5b0c1d9e-7f43-4a51-9d2c-0b6f2a4e8c11', 'system')).toBe(
      0,
    );
    expect(await events()).toBe(0);
  });

  it('revokes 300 grants with 300 entries and 300 events', async () => {
    const person = await account('Andrei');
    await grants(person, 300);

    expect(await revoke(person, 'system')).toBe(300);
    expect(await entries()).toBe(300);
    expect(await events()).toBe(300);
    expect(
      await prisma.assistantGrant.count({
        where: { accountId: person, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('answers 0 and writes nothing the second time', async () => {
    const person = await account('Andrei');
    await grants(person, 3);
    await revoke(person, 'system', 'account_suspended');

    expect(await revoke(person, 'system', 'account_deleted')).toBe(0);
    expect(await entries()).toBe(3);
    expect(await events()).toBe(3);
    expect(
      await prisma.assistantGrant.count({
        where: { revokeReason: 'account_suspended' },
      }),
    ).toBe(3);
  });

  it('revokes only the live grants when some were revoked before', async () => {
    const person = await account('Andrei');
    await grants(person, 3);
    await prisma.assistantGrant.updateMany({
      data: { revokedAt: new Date(0), revokedBy: person, revokeReason: 'user' },
      where: { clientId: { in: ['client-0', 'client-1'] } },
    });

    expect(await revoke(person, 'system')).toBe(1);
    expect(await entries()).toBe(1);
    expect(await events()).toBe(1);
  });

  it('leaves the grants live and writes nothing when the caller rolls back', async () => {
    const person = await account('Andrei');
    await grants(person, 2);

    await expect(
      prisma.$transaction(async (tx) => {
        await revokeAssistantGrants(tx, audit, outbox, {
          accountId: person,
          by: 'system',
          reason: 'account_deleted',
        });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    expect(
      await prisma.assistantGrant.count({
        where: { accountId: person, revokedAt: null },
      }),
    ).toBe(2);
    expect(await entries()).toBe(0);
    expect(await events()).toBe(0);
  });

  it('records system with no actor id when no person acted', async () => {
    const person = await account('Andrei');
    await grants(person, 1);

    await revoke(person, 'system');

    const row = await prisma.assistantGrant.findFirstOrThrow({
      where: { accountId: person },
    });
    expect(row.revokedBy).toBe('system');
    expect(
      await prisma.activityLog.findFirstOrThrow({
        where: { kind: 'assistant_grant_revoked', subjectId: row.id },
      }),
    ).toMatchObject({ actorId: null, actorRole: 'system' });
  });

  it('writes one entry and one event per grant when two callers race', async () => {
    const person = await account('Andrei');
    await grants(person, 5);

    const [first, second] = await Promise.all([
      revoke(person, 'system', 'account_suspended'),
      revoke(person, 'system', 'account_deleted'),
    ]);

    expect(first + second).toBe(5);
    expect(await entries()).toBe(5);
    expect(await events()).toBe(5);
  });
});
