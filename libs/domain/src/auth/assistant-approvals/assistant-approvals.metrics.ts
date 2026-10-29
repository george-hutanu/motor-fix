import { Logger } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';

import type { ApprovalKind, ApprovalStatus } from './assistant-approvals.dto';

type ApprovalCount = Exclude<ApprovalStatus, 'pending'> | 'requested';

const logger = new Logger('AssistantApprovals');

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
const approvals = () =>
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_assistant_approvals_total', {
      description: 'Assistant actions approved in the app, by kind and outcome',
    });

// One count, one log line and the span's outcome per step of an approval;
// only its ids, never the summary, the arguments or anything that names the
// person. `sweep` marks an expiry the sweep made, a lost timer.
export function recordApproval(
  outcome: ApprovalCount,
  approval: {
    accountId: string;
    grantId: string;
    id: string;
    kind: ApprovalKind;
    tool: string;
  },
  sweep = false,
) {
  approvals().add(1, {
    kind: approval.kind,
    outcome,
    ...(sweep && { sweep: 'true' }),
  });
  logger.log({
    accountId: approval.accountId,
    approvalId: approval.id,
    grantId: approval.grantId,
    kind: approval.kind,
    outcome,
    tool: approval.tool,
  });
  trace.getActiveSpan()?.setAttribute('motorfix.approval.outcome', outcome);
}
