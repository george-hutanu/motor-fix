import { metrics } from '@opentelemetry/api';

export type ChangeAction = 'requested' | 'approved' | 'refused' | 'cancelled';

// One count per step of a rule change request, after its commit. The counter
// is looked up on every count: one kept from before the meter provider is
// registered stays a no-op.
export function recordChange(action: ChangeAction) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_platform_rule_changes_total', {
      description: 'Rule change requests and their decisions, by action',
    })
    .add(1, { action });
}
