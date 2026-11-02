import type { Mock } from 'vitest';

import { ConfirmService } from './confirm.service';
import type { Actor } from '../../auth/policy';

// Two confirms racing for one lift or mechanic can deadlock on the exclusion
// constraints; Postgres aborts one, which runs again and reads the other's
// confirm instead of answering 500.
const deadlock = () =>
  Object.assign(new Error('Transaction failed due to a deadlock'), {
    code: 'P2034',
  });

const actor = {
  accountId: 'a',
  language: 'en',
  role: 'owner',
} as unknown as Actor;

const serviceWith = (transaction: Mock) =>
  new ConfirmService(
    { $transaction: transaction } as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('ConfirmService.confirm on a deadlock', () => {
  it('runs the transaction again and answers what the second run answers', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce({ id: 'b' });

    await expect(
      serviceWith(transaction).confirm(actor, 'b', { lift: 1 }),
    ).resolves.toEqual({ id: 'b' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after three runs that all deadlock', async () => {
    const transaction = vi
      .fn()
      .mockImplementation(() => Promise.reject(deadlock()));

    await expect(
      serviceWith(transaction).confirm(actor, 'b', { lift: 1 }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('never runs again on any other failure', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('audit down'));

    await expect(
      serviceWith(transaction).confirm(actor, 'b', { lift: 1 }),
    ).rejects.toThrow('audit down');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
