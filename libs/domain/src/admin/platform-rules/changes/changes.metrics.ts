import { metrics } from '@opentelemetry/api';

export type ChangeAction = 'requested' | 'approved' | 'refused' | 'cancelled';

let changes:
  | ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>
  | undefined;

// One count per step of a rule change request, after its commit.
export function recordChange(action: ChangeAction) {
  changes ??= metrics
    .getMeter('motorfix')
    .createCounter('motorfix_platform_rule_changes_total', {
      description: 'Rule change requests and their decisions, by action',
    });
  changes.add(1, { action });
}
