import { randomUUID } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import {
  AssistantConfirmations,
  voidAssistantConfirmations,
} from './assistant-confirmations';
import { AuditService } from '../../audit/audit.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { serialDatabase, waitingOnLocks } from '../serial-db.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);
const confirmations = new AssistantConfirmations(prisma);
const audit = new AuditService();

afterAll(() => prisma.$disconnect());
beforeEach(() => reset());

const HASH = 'a'.repeat(64);
const TOOL = 'decline_quote_request';

async function grantOf(accountId: string, clientId = 'claude') {
  const { id } = await prisma.assistantGrant.create({
    data: {
      accountId,
      canAct: true,
      canRead: true,
      clientId,
      clientName: clientId,
    },
  });
  return id;
}

// An account with one grant and one confirmation waiting under it.
async function waiting(name = 'Andrei') {
  const accountId = await account(name);
  const grantId = await grantOf(accountId);
  const opened = await confirmations.open({
    accountId,
    argsHash: HASH,
    grantId,
    tool: TOOL,
  });
  return { accountId, grantId, ...opened };
}

const row = (id: string) =>
  prisma.assistantConfirmation.findUniqueOrThrow({ where: { id } });

// The write a run makes: one audit row, so a rollback shows as none.
const writing = (
  accountId: string,
  answer: () => unknown = () => ({ ok: 1 }),
) =>
  jest.fn(async (tx: Prisma.TransactionClient) => {
    await audit.record(tx, {
      action: 'open',
      actorId: accountId,
      actorRole: 'garage',
      subjectId: accountId,
      subjectType: 'account',
    });
    return answer();
  });

const written = (accountId: string) =>
  prisma.activityLog.count({
    where: { action: 'open', subjectId: accountId },
  });

const yes = (c: { grantId: string; id: string }, argsHash = HASH) => ({
  argsHash,
  confirmed: true,
  grantId: c.grantId,
  id: c.id,
});

// @traces 1253-FR-009
describe('opening an assistant confirmation', () => {
  it('stores it waiting, for the grant, account and tool, with the hash only and five minutes to answer', async () => {
    const c = await waiting();

    const stored = await row(c.id);

    expect(stored).toMatchObject({
      accountId: c.accountId,
      argsHash: HASH,
      decidedAt: null,
      grantId: c.grantId,
      outcome: null,
      status: 'waiting',
      tool: TOOL,
    });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      5 * 60_000,
    );
    expect(c.expiresAt).toEqual(stored.expiresAt);
  });

  it('names the stored tool to its own grant only', async () => {
    const c = await waiting();
    const other = await grantOf(c.accountId, 'chatgpt');

    await expect(confirmations.toolOf(c.id, c.grantId)).resolves.toBe(TOOL);
    await expect(confirmations.toolOf(c.id, other)).resolves.toBeNull();
    await expect(
      confirmations.toolOf(randomUUID(), c.grantId),
    ).resolves.toBeNull();
  });
});

// @traces 1253-FR-004 1253-FR-006
describe('a timely yes', () => {
  it('runs once and stores the output as done', async () => {
    const c = await waiting();
    const run = writing(c.accountId, () => ({ status: 'declined' }));

    const decision = await confirmations.decide(yes(c), run);

    expect(decision).toEqual({
      output: { status: 'declined' },
      replayed: false,
      status: 'done',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await written(c.accountId)).toBe(1);
    const stored = await row(c.id);
    expect(stored).toMatchObject({
      outcome: { output: { status: 'declined' } },
      status: 'done',
    });
    expect(stored.decidedAt).toBeInstanceOf(Date);
  });

  it('still counts one second before the expiry', async () => {
    const c = await waiting();
    await prisma.$executeRaw`
      UPDATE assistant_confirmation SET expires_at = now() + interval '1 second'
      WHERE id = ${c.id}::uuid`;

    const decision = await confirmations.decide(yes(c), writing(c.accountId));

    expect(decision.status).toBe('done');
  });

  it('rolls a failing run back, stores its code as failed and throws its error', async () => {
    const c = await waiting();
    const error = new ConflictException({
      code: 'already_answered',
      message: 'x',
    });
    const run = writing(c.accountId, () => {
      throw error;
    });

    await expect(confirmations.decide(yes(c), run)).rejects.toBe(error);

    expect(await written(c.accountId)).toBe(0);
    expect(await row(c.id)).toMatchObject({
      outcome: { code: 'already_answered' },
      status: 'failed',
    });
  });

  it('stores internal_error for a failure with no code of its own', async () => {
    const c = await waiting();

    await expect(
      confirmations.decide(
        yes(c),
        writing(c.accountId, () => {
          throw new Error('disk on fire');
        }),
      ),
    ).rejects.toThrow('disk on fire');

    expect(await row(c.id)).toMatchObject({
      outcome: { code: 'internal_error' },
      status: 'failed',
    });
  });
});

// @traces 1253-FR-005
describe('every other answer writes nothing', () => {
  it('closes a no as refused', async () => {
    const c = await waiting();
    const run = writing(c.accountId);

    const decision = await confirmations.decide(
      { ...yes(c), confirmed: false },
      run,
    );

    expect(decision).toEqual({ status: 'refused' });
    expect(run).not.toHaveBeenCalled();
    expect(await row(c.id)).toMatchObject({ outcome: null, status: 'refused' });
  });

  it.each([true, false])(
    'closes an answer one second after the expiry as expired, confirmed %s',
    async (confirmed) => {
      const c = await waiting();
      await prisma.$executeRaw`
        UPDATE assistant_confirmation SET expires_at = now() - interval '1 second'
        WHERE id = ${c.id}::uuid`;
      const run = writing(c.accountId);

      const decision = await confirmations.decide(
        { ...yes(c), confirmed },
        run,
      );

      expect(decision).toEqual({ status: 'expired' });
      expect(run).not.toHaveBeenCalled();
      expect((await row(c.id)).status).toBe('expired');
    },
  );

  it('voids a yes whose arguments changed and says so', async () => {
    const c = await waiting();
    const run = writing(c.accountId);

    const decision = await confirmations.decide(yes(c, 'b'.repeat(64)), run);

    expect(decision).toEqual({ mismatch: true, status: 'void' });
    expect(run).not.toHaveBeenCalled();
    expect((await row(c.id)).status).toBe('void');
    // Asked again, it still says the arguments changed (FR-005, FR-006).
    expect(await confirmations.decide(yes(c), run)).toEqual({
      mismatch: true,
      status: 'void',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers not_found for another grant’s or an unknown id and leaves the row waiting', async () => {
    const c = await waiting();
    const other = await grantOf(c.accountId, 'chatgpt');
    const run = writing(c.accountId);

    const decisions = [
      await confirmations.decide({ ...yes(c), grantId: other }, run),
      await confirmations.decide({ ...yes(c), id: randomUUID() }, run),
    ];

    expect(decisions).toEqual([
      { status: 'not_found' },
      { status: 'not_found' },
    ]);
    expect(run).not.toHaveBeenCalled();
    expect((await row(c.id)).status).toBe('waiting');
  });

  it.each(['refused', 'expired', 'void'] as const)(
    'answers a closed %s confirmation as it was closed, running nothing',
    async (status) => {
      const c = await waiting();
      await prisma.assistantConfirmation.update({
        data: { decidedAt: new Date(), status },
        where: { id: c.id },
      });
      const run = writing(c.accountId);

      const decision = await confirmations.decide(yes(c), run);

      expect(decision).toEqual({ status });
      expect(run).not.toHaveBeenCalled();
      expect((await row(c.id)).status).toBe(status);
    },
  );
});

// @traces 1253-FR-006
describe('a repeated yes', () => {
  it('replays a done outcome whatever it is sent, running nothing', async () => {
    const c = await waiting();
    await confirmations.decide(
      yes(c),
      writing(c.accountId, () => ({ status: 'declined' })),
    );
    const again = writing(c.accountId);

    const decision = await confirmations.decide(
      { ...yes(c, 'c'.repeat(64)), confirmed: false },
      again,
    );

    expect(decision).toEqual({
      output: { status: 'declined' },
      replayed: true,
      status: 'done',
    });
    expect(again).not.toHaveBeenCalled();
    expect(await written(c.accountId)).toBe(1);
  });

  it('replays a failed outcome as its code, running nothing', async () => {
    const c = await waiting();
    await expect(
      confirmations.decide(
        yes(c),
        writing(c.accountId, () => {
          throw new ConflictException({ code: 'request_not_open' });
        }),
      ),
    ).rejects.toThrow();
    const again = writing(c.accountId);

    const decision = await confirmations.decide(yes(c), again);

    expect(decision).toEqual({
      code: 'request_not_open',
      replayed: true,
      status: 'failed',
    });
    expect(again).not.toHaveBeenCalled();
  });

  it('runs once for two yeses at the same moment, the second waiting for the first', async () => {
    const c = await waiting();
    let release = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const run = writing(c.accountId, async () => {
      entered();
      await held;
      return { status: 'declined' };
    });

    const first = confirmations.decide(yes(c), run);
    await inside;
    const second = confirmations.decide(yes(c), run);
    await waitingOnLocks(prisma, 1);
    release();
    const decisions = await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(await written(c.accountId)).toBe(1);
    expect(decisions.map((d) => d.status)).toEqual(['done', 'done']);
    expect(decisions.map((d) => 'output' in d && d.output)).toEqual([
      { status: 'declined' },
      { status: 'declined' },
    ]);
  });
});

// @traces 1253-FR-007
describe('voiding waiting confirmations', () => {
  it('voids every waiting one of the grants named, inside the caller’s transaction, and counts them', async () => {
    const a = await waiting('Andrei');
    const second = await confirmations.open({
      accountId: a.accountId,
      argsHash: HASH,
      grantId: a.grantId,
      tool: TOOL,
    });
    const b = await waiting('Ioana');
    const done = await waiting('Maria');
    await confirmations.decide(yes(done), writing(done.accountId));

    const voided = await prisma.$transaction((tx) =>
      voidAssistantConfirmations(tx, { grantIds: [a.grantId, done.grantId] }),
    );

    expect(voided).toBe(2);
    expect((await row(a.id)).status).toBe('void');
    expect((await row(second.id)).status).toBe('void');
    expect((await row(a.id)).decidedAt).toBeInstanceOf(Date);
    expect((await row(b.id)).status).toBe('waiting');
    expect((await row(done.id)).status).toBe('done');
  });

  it('voids every waiting one of an account', async () => {
    const a = await waiting('Andrei');
    const other = await grantOf(a.accountId, 'chatgpt');
    const second = await confirmations.open({
      accountId: a.accountId,
      argsHash: HASH,
      grantId: other,
      tool: TOOL,
    });
    const b = await waiting('Ioana');

    const voided = await prisma.$transaction((tx) =>
      voidAssistantConfirmations(tx, { accountId: a.accountId }),
    );

    expect(voided).toBe(2);
    expect((await row(a.id)).status).toBe('void');
    expect((await row(second.id)).status).toBe('void');
    expect((await row(b.id)).status).toBe('waiting');
  });

  it('keeps them waiting when the caller’s transaction rolls back', async () => {
    const a = await waiting();

    await expect(
      prisma.$transaction(async (tx) => {
        await voidAssistantConfirmations(tx, { accountId: a.accountId });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');

    expect((await row(a.id)).status).toBe('waiting');
  });

  it('voids an account’s waiting ones on its own', async () => {
    const a = await waiting();

    await expect(confirmations.voidForAccount(a.accountId)).resolves.toBe(1);

    expect((await row(a.id)).status).toBe('void');
  });
});

// @traces 1253-FR-007
describe('the account’s switch for acting', () => {
  it('is on for a new account', async () => {
    const id = await account('Andrei');

    const stored = await prisma.account.findUniqueOrThrow({ where: { id } });

    expect(stored.assistantCanAct).toBe(true);
  });
});
