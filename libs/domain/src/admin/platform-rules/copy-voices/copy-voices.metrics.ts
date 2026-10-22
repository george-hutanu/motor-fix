import { metrics } from '@opentelemetry/api';

export type VoiceChange = 'enabled' | 'disabled' | 'pinned' | 'unpinned';

// One count per voice change, after its commit. Looked up on every count, as
// the rule change counter is: one kept from before the meter provider is
// registered stays a no-op.
export function recordVoiceChange(change: VoiceChange) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_copy_voice_changes_total', {
      description: 'Copy voices switched on, off, pinned or unpinned by admins',
    })
    .add(1, { change });
}
