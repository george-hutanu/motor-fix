import type { Queue } from 'bullmq';

import { ApprovalTimers } from './approval-timers';
import type { NotificationsService } from '../../../notifications/notifications.service';
import type { AssistantApprovals } from '../assistant-approvals';

const ID = '6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';
const ACCOUNT = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const NOW = new Date('2026-10-29T09:00:00Z');
const EXPIRES = new Date('2026-10-29T09:30:00Z');
const WEB = 'https://motorfix.test';

function world(waiting: { accountId: string; expiresAt: Date } | null) {
  const approvals = {
    expireOverdue: jest.fn(async () => false),
    overdue: jest.fn(async () => [ID]),
    waiting: jest.fn(async () => waiting),
  };
  const notifications = { notify: jest.fn(async () => 1) };
  const queue = { add: jest.fn(), remove: jest.fn() };
  const timers = new ApprovalTimers(
    approvals as unknown as AssistantApprovals,
    notifications as unknown as NotificationsService,
    queue as unknown as Queue,
    WEB,
  );
  timers.now = () => NOW;
  return { approvals, notifications, queue, timers };
}

const requested = {
  data: {
    id: '41',
    kind: 'assistant_approval.requested',
    payload: { approvalId: ID },
    subjectId: ID,
  },
};

// @traces 1254-FR-003
describe('an approval asked for', () => {
  it('tells its account once per approval and sets its expiry timer', async () => {
    const w = world({ accountId: ACCOUNT, expiresAt: EXPIRES });

    await w.timers.onRequested(requested);

    expect(w.notifications.notify).toHaveBeenCalledWith({
      eventId: ID,
      kind: 'ASSISTANT_APPROVAL_NEEDED',
      params: { link: `${WEB}/app/assistant/approvals/${ID}` },
      recipients: [ACCOUNT],
      subjectId: ID,
    });
    expect(w.queue.add).toHaveBeenCalledWith(
      'assistant-approval',
      { id: ID },
      expect.objectContaining({
        delay: 30 * 60_000,
        jobId: `assistant-approval-${ID}`,
      }),
    );
  });

  it('does nothing for an approval already decided or gone', async () => {
    const w = world(null);

    await w.timers.onRequested(requested);

    expect(w.approvals.waiting).toHaveBeenCalledWith(ID);
    expect(w.notifications.notify).not.toHaveBeenCalled();
    expect(w.queue.add).not.toHaveBeenCalled();
  });
});

// @traces 1254-FR-007
describe('the expiry timer', () => {
  it('expires through the one conditional write, judged at its own time', async () => {
    const w = world(null);
    w.approvals.expireOverdue.mockResolvedValueOnce(true);

    await w.timers.fire(ID, false);

    expect(w.approvals.expireOverdue).toHaveBeenCalledWith(ID, NOW, false);
  });

  it('changes nothing when late or repeated, the write having found nothing pending', async () => {
    const w = world(null);

    await expect(w.timers.fire(ID, true)).resolves.toBeUndefined();
    await expect(w.timers.fire(ID, false)).resolves.toBeUndefined();

    expect(w.approvals.expireOverdue).toHaveBeenCalledTimes(2);
    expect(w.approvals.expireOverdue).toHaveBeenCalledWith(ID, NOW, true);
    expect(w.notifications.notify).not.toHaveBeenCalled();
  });

  it('names to the sweep the pending approvals past their expiry', async () => {
    const w = world(null);

    await expect(w.timers.overdue(NOW)).resolves.toEqual([ID]);
    expect(w.approvals.overdue).toHaveBeenCalledWith(NOW);
  });
});
