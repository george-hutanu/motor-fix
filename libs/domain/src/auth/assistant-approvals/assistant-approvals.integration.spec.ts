import { randomUUID } from 'node:crypto';

import {
  AssistantApprovals,
  expireAssistantApprovals,
} from './assistant-approvals';
import { AuditService } from '../../audit/audit.service';
import { outbox } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { voidAssistantConfirmations } from '../assistant-confirmations/assistant-confirmations';
import { serialDatabase, waitingOnLocks } from '../serial-db.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const approvals = new AssistantApprovals(prisma, new AuditService(), outbox);

afterAll(() => prisma.$disconnect());
beforeEach(() => reset());

const SUMMARY = 'Accepți oferta Garaj X de 450 lei pentru joi 14:00.';
const ARGS = { quoteId: randomUUID(), shareHistory: true };

async function grantOf(accountId: string, clientId = 'claude') {
  const { id } = await prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId,
      clientName: clientId === 'claude' ? 'Claude' : clientId,
    },
  });
  return id;
}

// An account with one grant and one approval pending under it.
async function pending(name = 'Andrei', grantId?: string, accountId?: string) {
  const owner = accountId ?? (await account(name));
  const grant = grantId ?? (await grantOf(owner));
  const opened = await prisma.$transaction((tx) =>
    approvals.open(tx, {
      accountId: owner,
      args: ARGS,
      editable: ['shareHistory'],
      grantId: grant,
      kind: 'book',
      summary: SUMMARY,
      tool: 'book_fixture',
    }),
  );
  return { accountId: owner, grantId: grant, ...opened };
}

const row = (id: string) =>
  prisma.assistantApproval.findUniqueOrThrow({ where: { id } });

const eventsOf = (id: string, kind: string) =>
  prisma.outboxEvent.findMany({ where: { kind, subjectId: id } });

const auditOf = (id: string) =>
  prisma.activityLog.findMany({
    where: { subjectId: id, subjectType: 'assistant_approval' },
  });

const overdueNow = (id: string) =>
  prisma.$executeRaw`
    UPDATE assistant_approval SET expires_at = now() - interval '1 second'
    WHERE id = ${id}::uuid`;

// @traces 1254-assistant-approvals-FR-008
describe('opening an approval', () => {
  it('saves one pending row with the tool, kind, summary, arguments and options, thirty minutes to decide', async () => {
    const a = await pending();

    const stored = await row(a.id);

    expect(stored).toMatchObject({
      accountId: a.accountId,
      arguments: ARGS,
      decidedAt: null,
      editable: ['shareHistory'],
      grantId: a.grantId,
      kind: 'book',
      outcome: null,
      status: 'pending',
      summary: SUMMARY,
      tool: 'book_fixture',
    });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      30 * 60_000,
    );
    expect(a.expiresAt).toEqual(stored.expiresAt);
  });

  it('records assistant_approval.requested to the account in the same transaction', async () => {
    const a = await pending();

    const [event, ...more] = await eventsOf(
      a.id,
      'assistant_approval.requested',
    );

    expect(more).toHaveLength(0);
    expect(event?.audience).toEqual([`account:${a.accountId}`]);
    expect(event?.payload).toEqual({
      approvalId: a.id,
      expiresAt: a.expiresAt.toISOString(),
      kind: 'book',
      tool: 'book_fixture',
    });
  });

  it('saves nothing when the caller’s transaction rolls back', async () => {
    const accountId = await account('Andrei');
    const grantId = await grantOf(accountId);

    await expect(
      prisma.$transaction(async (tx) => {
        await approvals.open(tx, {
          accountId,
          args: ARGS,
          editable: [],
          grantId,
          kind: 'book',
          summary: SUMMARY,
          tool: 'book_fixture',
        });
        throw new Error('the confirmation failed');
      }),
    ).rejects.toThrow('the confirmation failed');

    expect(await prisma.assistantApproval.count({ where: { grantId } })).toBe(
      0,
    );
  });
});

// @traces 1254-assistant-approvals-FR-006
// @traces 1254-assistant-approvals-FR-009
describe('reading approvals', () => {
  it('reads one approval of the caller’s in any status, and 404s another account’s or an unknown id', async () => {
    const a = await pending();
    const other = await account('Ioana');

    await expect(approvals.get(a.accountId, a.id)).resolves.toMatchObject({
      assistantName: 'Claude',
      id: a.id,
      kind: 'book',
      options: [{ key: 'shareHistory', value: true }],
      status: 'pending',
      summary: SUMMARY,
    });
    await expect(approvals.get(other, a.id)).resolves.toBeNull();
    await expect(approvals.get(a.accountId, randomUUID())).resolves.toBeNull();
    await expect(approvals.get(a.accountId, 'not-a-uuid')).resolves.toBeNull();
  });

  it('lists the caller’s pending approvals oldest first, then the ones decided in the last day, and counts the pending', async () => {
    const first = await pending();
    const second = await pending('', first.grantId, first.accountId);
    const refused = await pending('', first.grantId, first.accountId);
    const old = await pending('', first.grantId, first.accountId);
    await approvals.refuse(first.accountId, refused.id, {
      id: first.accountId,
      role: 'driver',
    });
    await prisma.assistantApproval.update({
      data: {
        decidedAt: new Date(Date.now() - 25 * 3_600_000),
        status: 'refused',
      },
      where: { id: old.id },
    });
    const elsewhere = await pending('Ioana');

    const list = await approvals.list(first.accountId);

    expect(list.pending).toBe(2);
    expect(list.items.map((i) => i.id)).toEqual([
      first.id,
      second.id,
      refused.id,
    ]);
    expect(list.items.map((i) => i.id)).not.toContain(elsewhere.id);
  });
});

// @traces 1254-assistant-approvals-FR-005
// @traces 1254-assistant-approvals-FR-006
describe('refusing an approval', () => {
  it('makes it refused once, with the person’s audit entry and assistant_approval.decided, in one transaction', async () => {
    const a = await pending();

    const refused = await approvals.refuse(
      a.accountId,
      a.id,
      { id: a.accountId, role: 'driver' },
      'req-1',
    );

    expect(refused).toMatchObject({ id: a.id, status: 'refused' });
    const stored = await row(a.id);
    expect(stored.status).toBe('refused');
    expect(stored.decidedAt).toBeInstanceOf(Date);
    const [entry, ...entries] = await auditOf(a.id);
    expect(entries).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: a.accountId,
      actorRole: 'driver',
      field: 'status',
      newValue: 'refused',
      oldValue: 'pending',
      requestId: 'req-1',
    });
    const [event, ...more] = await eventsOf(a.id, 'assistant_approval.decided');
    expect(more).toHaveLength(0);
    expect(event?.audience).toEqual([`account:${a.accountId}`]);
    expect(event?.payload).toEqual({
      approvalId: a.id,
      kind: 'book',
      status: 'refused',
    });
  });

  it('answers the current status of a decided one and writes nothing more', async () => {
    const a = await pending();
    const me = { id: a.accountId, role: 'driver' as const };
    await approvals.refuse(a.accountId, a.id, me);

    await expect(approvals.refuse(a.accountId, a.id, me)).resolves.toEqual({
      notPending: 'refused',
    });
    expect(await auditOf(a.id)).toHaveLength(1);
    expect(await eventsOf(a.id, 'assistant_approval.decided')).toHaveLength(1);
  });

  it('closes an overdue one as expired instead, with no audit entry of the person’s', async () => {
    const a = await pending();
    await overdueNow(a.id);

    await expect(
      approvals.refuse(a.accountId, a.id, { id: a.accountId, role: 'driver' }),
    ).resolves.toEqual({ notPending: 'expired' });
    expect(await row(a.id)).toMatchObject({
      outcome: { code: 'timeout' },
      status: 'expired',
    });
    expect(await auditOf(a.id)).toHaveLength(0);
    expect(await eventsOf(a.id, 'assistant_approval.decided')).toHaveLength(1);
  });

  it('answers not_found for another account’s or an unknown id and leaves the row pending', async () => {
    const a = await pending();
    const other = await account('Ioana');
    const them = { id: other, role: 'driver' as const };

    await expect(approvals.refuse(other, a.id, them)).resolves.toBe(
      'not_found',
    );
    await expect(approvals.refuse(other, randomUUID(), them)).resolves.toBe(
      'not_found',
    );
    expect((await row(a.id)).status).toBe('pending');
  });
});

// @traces 1254-assistant-approvals-FR-005
// @traces 1254-assistant-approvals-FR-008
describe('locking an approval for a decision', () => {
  it('hands back the stored row under the lock, and a second decision waits for the first', async () => {
    const a = await pending();

    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const first = prisma.$transaction(async (tx) => {
      const locked = await approvals.lockForDecision(tx, a.accountId, a.id);
      await held;
      if (typeof locked === 'object' && 'id' in locked)
        await approvals.close(tx, locked, 'approved', {
          subjectId: ARGS.quoteId,
          subjectType: 'booking',
        });
      return locked;
    });
    const second = prisma.$transaction((tx) =>
      approvals.lockForDecision(tx, a.accountId, a.id),
    );
    await waitingOnLocks(prisma, 1);
    release();

    const [locked, after] = await Promise.all([first, second]);

    expect(locked).toMatchObject({
      arguments: ARGS,
      editable: ['shareHistory'],
      grantId: a.grantId,
      id: a.id,
      kind: 'book',
      tool: 'book_fixture',
    });
    expect(after).toEqual({ notPending: 'approved' });
    expect(await row(a.id)).toMatchObject({
      outcome: { subjectId: ARGS.quoteId, subjectType: 'booking' },
      status: 'approved',
    });
  });

  it('writes the row at most twice: a close of a decided one changes nothing', async () => {
    const a = await pending();
    const locked = await prisma.$transaction((tx) =>
      approvals.lockForDecision(tx, a.accountId, a.id),
    );
    if (typeof locked !== 'object' || !('id' in locked))
      throw new Error('not locked');
    await prisma.$transaction((tx) =>
      approvals.close(
        tx,
        locked,
        'failed',
        { code: 'quote_expired' },
        {
          id: a.accountId,
          role: 'driver',
        },
      ),
    );

    await prisma.$transaction((tx) =>
      approvals.close(tx, locked, 'approved', null, {
        id: a.accountId,
        role: 'driver',
      }),
    );

    expect(await row(a.id)).toMatchObject({
      outcome: { code: 'quote_expired' },
      status: 'failed',
    });
    expect(await auditOf(a.id)).toHaveLength(1);
    expect(await eventsOf(a.id, 'assistant_approval.decided')).toHaveLength(1);
  });

  it('answers not_found across accounts', async () => {
    const a = await pending();
    const other = await account('Ioana');

    await expect(
      prisma.$transaction((tx) => approvals.lockForDecision(tx, other, a.id)),
    ).resolves.toBe('not_found');
  });
});

// @traces 1254-assistant-approvals-FR-007
describe('expiring an approval nobody decided', () => {
  it('names the pending approvals past their expiry, and only those', async () => {
    const due = await pending();
    const notYet = await pending('', due.grantId, due.accountId);
    const decided = await pending('', due.grantId, due.accountId);
    await overdueNow(due.id);
    await overdueNow(decided.id);
    await prisma.assistantApproval.update({
      data: { decidedAt: new Date(), status: 'refused' },
      where: { id: decided.id },
    });

    const ids = await approvals.overdue(new Date());

    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notYet.id);
    expect(ids).not.toContain(decided.id);
  });

  it('expires an overdue one once, with its event and no audit entry; a repeat changes nothing', async () => {
    const a = await pending();
    await overdueNow(a.id);

    await expect(approvals.expireOverdue(a.id)).resolves.toBe(true);
    await expect(approvals.expireOverdue(a.id)).resolves.toBe(false);

    expect(await row(a.id)).toMatchObject({
      outcome: { code: 'timeout' },
      status: 'expired',
    });
    const events = await eventsOf(a.id, 'assistant_approval.decided');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      approvalId: a.id,
      kind: 'book',
      status: 'expired',
    });
    expect(await auditOf(a.id)).toHaveLength(0);
  });

  it('leaves one in time, or already decided, as it is', async () => {
    const inTime = await pending();
    const decided = await pending('', inTime.grantId, inTime.accountId);
    await approvals.refuse(decided.accountId, decided.id, {
      id: decided.accountId,
      role: 'driver',
    });
    await overdueNow(decided.id);

    await expect(approvals.expireOverdue(inTime.id)).resolves.toBe(false);
    await expect(approvals.expireOverdue(decided.id)).resolves.toBe(false);

    expect((await row(inTime.id)).status).toBe('pending');
    expect((await row(decided.id)).status).toBe('refused');
  });
});

// @traces 1254-assistant-approvals-FR-007
describe('the void function expires pending approvals too', () => {
  it('expires the pending ones of the grants named as revoked, in the caller’s transaction', async () => {
    const a = await pending();
    const kept = await grantOf(a.accountId, 'chatgpt');
    const other = await pending('', kept, a.accountId);

    await prisma.$transaction((tx) =>
      voidAssistantConfirmations(tx, { grantIds: [a.grantId] }),
    );

    expect(await row(a.id)).toMatchObject({
      outcome: { code: 'revoked' },
      status: 'expired',
    });
    expect((await row(other.id)).status).toBe('pending');
    expect(await eventsOf(a.id, 'assistant_approval.decided')).toHaveLength(1);
  });

  it('expires every pending one of an account whose switch is off, and nothing when the transaction rolls back', async () => {
    const a = await pending();
    const b = await pending('', a.grantId, a.accountId);

    await expect(
      prisma.$transaction(async (tx) => {
        await voidAssistantConfirmations(tx, { accountId: a.accountId });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect((await row(a.id)).status).toBe('pending');

    await prisma.$transaction((tx) =>
      expireAssistantApprovals(tx, { accountId: a.accountId }),
    );

    for (const id of [a.id, b.id])
      expect(await row(id)).toMatchObject({
        outcome: { code: 'switch_off' },
        status: 'expired',
      });
    expect(await auditOf(a.id)).toHaveLength(0);
  });

  it('leaves decided approvals as they are', async () => {
    const a = await pending();
    await approvals.refuse(a.accountId, a.id, {
      id: a.accountId,
      role: 'driver',
    });

    await expect(
      prisma.$transaction((tx) =>
        expireAssistantApprovals(tx, { accountId: a.accountId }),
      ),
    ).resolves.toBe(0);
    expect((await row(a.id)).status).toBe('refused');
  });
});
