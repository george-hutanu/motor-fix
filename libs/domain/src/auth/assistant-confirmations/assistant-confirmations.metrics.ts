import { Logger } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';

export type ConfirmationOutcome =
  | 'opened'
  | 'confirmed'
  | 'refused'
  | 'expired'
  | 'mismatch'
  | 'void'
  | 'replayed'
  | 'failed';

const logger = new Logger('AssistantConfirmations');

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
const confirmations = () =>
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_assistant_confirmations_total', {
      description: 'Assistant action confirmations, by tool and outcome',
    });

// One count, one log line and the span's outcome per step of a confirmation;
// never the summary, the arguments or anything that names the person.
export function recordConfirmation(
  outcome: ConfirmationOutcome,
  who: { confirmationId: string; grantId: string; tool: string },
) {
  confirmations().add(1, { outcome, tool: who.tool });
  logger.log({ ...who, outcome });
  trace.getActiveSpan()?.setAttribute('motorfix.confirmation.outcome', outcome);
}
