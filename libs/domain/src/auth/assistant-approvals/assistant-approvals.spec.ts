import {
  approvalView,
  expireAssistantApprovals,
  judgeApproval,
} from './assistant-approvals';

const NOW = new Date('2026-10-29T18:00:00.000Z');
const row = (
  shape: Partial<NonNullable<Parameters<typeof judgeApproval>[0]>> = {},
) => ({
  expiresAt: new Date(NOW.getTime() + 60_000),
  status: 'pending' as const,
  ...shape,
});

// @traces 1254-FR-005
// @traces 1254-FR-006
// @traces 1254-FR-007
describe('judging an approval at a decision', () => {
  it('lets a pending approval before its expiry be decided', () => {
    expect(judgeApproval(row(), NOW)).toBe('pending');
    expect(
      judgeApproval(row({ expiresAt: new Date(NOW.getTime() + 1) }), NOW),
    ).toBe('pending');
  });

  it('closes a pending approval at or past its expiry as expired', () => {
    expect(judgeApproval(row({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(
      judgeApproval(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW),
    ).toBe('expired');
  });

  it('answers the current status of a decided approval, whatever the time', () => {
    for (const status of ['approved', 'refused', 'expired', 'failed'] as const)
      for (const expiresAt of [
        new Date(NOW.getTime() - 60_000),
        new Date(NOW.getTime() + 60_000),
      ])
        expect(judgeApproval(row({ expiresAt, status }), NOW)).toEqual({
          notPending: status,
        });
  });
});

// @traces 1254-FR-007
describe('why the void function expires an approval', () => {
  const outcomeFor = async (
    scope: Parameters<typeof expireAssistantApprovals>[1],
  ) => {
    const updateManyAndReturn = jest.fn(async () => []);
    await expireAssistantApprovals(
      { assistantApproval: { updateManyAndReturn } } as never,
      scope,
      { record: jest.fn() } as never,
    );
    return (updateManyAndReturn.mock.calls[0] as unknown[])[0];
  };

  it('says revoked for named grants and switch_off for a whole account', async () => {
    await expect(outcomeFor({ grantIds: ['g-1'] })).resolves.toMatchObject({
      data: { outcome: { code: 'revoked' }, status: 'expired' },
      where: { grantId: { in: ['g-1'] }, status: 'pending' },
    });
    await expect(outcomeFor({ accountId: 'a-1' })).resolves.toMatchObject({
      data: { outcome: { code: 'switch_off' }, status: 'expired' },
      where: { accountId: 'a-1', status: 'pending' },
    });
  });
});

// @traces 1254-FR-008
// @traces 1254-FR-009
describe('what the person reads of an approval', () => {
  const stored = {
    arguments: { quoteId: 'q-1', shareHistory: true, slot: 'thu' },
    createdAt: new Date('2026-10-29T17:50:00.000Z'),
    decidedAt: null,
    editable: ['shareHistory'],
    expiresAt: new Date('2026-10-29T18:20:00.000Z'),
    grant: { clientName: 'Claude' },
    id: 'ap-1',
    kind: 'book' as const,
    outcome: null,
    status: 'pending' as const,
    summary: 'Accepți oferta Garaj X de 450 lei pentru joi 14:00.',
    tool: 'book_fixture',
  };

  it('shows the summary, the assistant and one option per editable input with its stored value', () => {
    expect(approvalView(stored)).toEqual({
      assistantName: 'Claude',
      createdAt: stored.createdAt,
      decidedAt: null,
      expiresAt: stored.expiresAt,
      id: 'ap-1',
      kind: 'book',
      options: [{ key: 'shareHistory', value: true }],
      outcome: null,
      status: 'pending',
      summary: stored.summary,
      tool: 'book_fixture',
    });
  });

  it('never shows an input that was not declared editable', () => {
    const view = approvalView(stored);

    expect(view.options.map((o) => o.key)).toEqual(['shareHistory']);
    expect(JSON.stringify(view)).not.toContain('q-1');
  });

  it('shows a missing boolean as false and a blank client name as none', () => {
    const view = approvalView({
      ...stored,
      arguments: { quoteId: 'q-1' },
      grant: { clientName: '  ' },
    });

    expect(view.options).toEqual([{ key: 'shareHistory', value: false }]);
    expect(view.assistantName).toBeNull();
  });

  it('carries the outcome of a decided approval', () => {
    const view = approvalView({
      ...stored,
      decidedAt: NOW,
      outcome: { code: 'quote_expired' },
      status: 'failed',
    });

    expect(view).toMatchObject({
      decidedAt: NOW,
      outcome: { code: 'quote_expired' },
      status: 'failed',
    });
  });
});
