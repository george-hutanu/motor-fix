import {
  approvalView,
  expireAssistantApprovals,
  judgeApproval,
} from './assistant-approvals';

const NOW = new Date('2026-10-29T18:00:00.000Z');

const stored = (over: Record<string, unknown> = {}) => ({
  arguments: { quoteId: 'SECRET-Q', shareHistory: true } as unknown,
  createdAt: NOW,
  decidedAt: null,
  editable: ['shareHistory'],
  expiresAt: new Date(NOW.getTime() + 1_800_000),
  grant: { clientName: 'Claude' },
  id: 'ap-1',
  kind: 'book' as const,
  outcome: null as unknown,
  status: 'pending' as const,
  summary: 'x',
  tool: 'book_fixture',
  ...over,
});

function fakeTx(
  rows: {
    accountId: string;
    grantId: string;
    id: string;
    kind: string;
    tool: string;
  }[] = [],
) {
  return {
    assistantApproval: { updateManyAndReturn: vi.fn(async () => rows) },
  };
}

// @traces 1254-FR-009
describe('what the person reads under hostile stored data', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'shareHistory'],
  ])('shows every option as false when the arguments are %s', (_n, args) => {
    expect(approvalView(stored({ arguments: args })).options).toEqual([
      { key: 'shareHistory', value: false },
    ]);
  });

  it.each(['true', 1, 'yes', {}])(
    'shows a stored non-boolean %p as false',
    (value) => {
      expect(
        approvalView(stored({ arguments: { shareHistory: value } })).options,
      ).toEqual([{ key: 'shareHistory', value: false }]);
    },
  );

  it('shows no options and leaks no argument when nothing is editable', () => {
    const view = approvalView(stored({ editable: [] }));

    expect(view.options).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('SECRET-Q');
  });

  it('keeps unicode and a long client name, trimmed', () => {
    const name = `${'Ă'.repeat(300)}`;

    expect(
      approvalView(stored({ grant: { clientName: ` ${name}\n` } }))
        .assistantName,
    ).toBe(name);
  });

  it('shows an empty-string client name as none', () => {
    expect(
      approvalView(stored({ grant: { clientName: '' } })).assistantName,
    ).toBeNull();
  });
});

// @traces 1254-FR-007
describe('judging an approval at the edge of its life', () => {
  it('is pending one millisecond before expiry and expired at it, thirty minutes after saving', () => {
    const expiresAt = new Date(NOW.getTime() + 1_800_000);

    expect(
      judgeApproval(
        { expiresAt, status: 'pending' },
        new Date(expiresAt.getTime() - 1),
      ),
    ).toBe('pending');
    expect(judgeApproval({ expiresAt, status: 'pending' }, expiresAt)).toBe(
      'expired',
    );
  });

  it('expires nothing for an empty list of grants', async () => {
    const tx = fakeTx();
    const events = { record: vi.fn() };

    const count = await expireAssistantApprovals(
      tx as never,
      { grantIds: [] },
      events as never,
    );

    expect(count).toBe(0);
    expect(tx.assistantApproval.updateManyAndReturn).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } }),
    );
    expect(events.record).not.toHaveBeenCalled();
  });

  it('only ever touches pending rows', async () => {
    const tx = fakeTx();

    await expireAssistantApprovals(tx as never, { accountId: 'a-1' }, {
      record: vi.fn(),
    } as never);

    expect(tx.assistantApproval.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: 'a-1', status: 'pending' }),
      }),
    );
  });

  it('emits one decided event per expired row, on the account, with the status expired', async () => {
    const rows = [
      { accountId: 'a-1', grantId: 'g-1', id: 'ap-1', kind: 'book', tool: 't' },
      {
        accountId: 'a-1',
        grantId: 'g-2',
        id: 'ap-2',
        kind: 'cancel',
        tool: 't',
      },
    ];
    const events = { record: vi.fn() };

    const count = await expireAssistantApprovals(
      fakeTx(rows) as never,
      { accountId: 'a-1' },
      events as never,
    );

    expect(count).toBe(2);
    expect(events.record).toHaveBeenCalledTimes(2);
    expect(events.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        audience: { accountId: 'a-1', type: 'account' },
        kind: 'assistant_approval.decided',
        payload: { approvalId: 'ap-2', kind: 'cancel', status: 'expired' },
      }),
    );
  });
});
