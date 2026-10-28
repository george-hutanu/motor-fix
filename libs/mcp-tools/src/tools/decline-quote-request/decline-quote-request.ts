import {
  DECLINE_REASON_CODES,
  DECLINE_REASON_TEXTS,
  type DeclineReasonCode,
} from '@motor-fix/contracts';
import { bucharestTime, type DeclinePreview } from '@motor-fix/domain';
import { z } from 'zod';

import type { Language } from '../../errors';
import { defineTool } from '../../registry';

const two = (n: number) => String(n).padStart(2, '0');

// What the person agrees to: garage, driver's first name, car, the request's
// Bucharest time and the reason, never a phone or a plate.
function declineSummary(
  preview: DeclinePreview,
  reason: DeclineReasonCode,
  language: Language,
): string {
  const at = bucharestTime(preview.receivedAt);
  const day = `${two(at.day)}.${two(at.month)}.${at.year}`;
  const time = `${two(at.hour)}:${two(at.minute)}`;
  const { brand, model, year } = preview.car;
  const label = DECLINE_REASON_TEXTS[reason].label[language];
  return language === 'ro'
    ? `Service-ul ${preview.garageName} refuză cererea lui ${preview.driverFirstName} pentru ${brand} ${model} (${year}), primită pe ${day} la ${time}, cu motivul: ${label}.`
    : `${preview.garageName} declines ${preview.driverFirstName}'s request for a ${brand} ${model} (${year}), received on ${day} at ${time}, with the reason: ${label}.`;
}

export const declineQuoteRequest = defineTool({
  acts: true,
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
    readOnlyHint: false,
  },
  capability: 'garage.requests',
  description:
    "Declines a quote request sent to the person's garage, with one of four reasons: fully_booked, job_not_done (the garage does not do this job), make_model_engine_not_done (it does not work on this make, model or engine) or need_to_see_car. Pick the request (its car and driver, from list_quote_requests) and the reason with the person. The first call changes nothing: it answers confirmation_required with a summary; show the summary to the person and pass their yes or no to confirm_action with the same arguments. The driver is told the reason about 5 minutes later. A request the garage already quoted or declined, or one that has closed, cannot be declined.",
  handler: (actor, input, ctx, { run }) => {
    if (!run) throw new Error('a decline runs only inside its confirmation');
    return ctx.garage.decline.run(run.tx, actor, input.requestId, input.reason);
  },
  inputSchema: {
    reason: z.enum(DECLINE_REASON_CODES),
    requestId: z.uuid(),
  },
  name: 'decline_quote_request',
  outputSchema: {
    answeredAt: z.string().nullable(),
    declinedAt: z.string().nullable(),
    declineReason: z.enum(DECLINE_REASON_CODES).nullable(),
    source: z.string(),
    status: z.string(),
  },
  preview: async (actor, input, ctx) => ({
    summary: declineSummary(
      await ctx.garage.decline.preview(actor, input.requestId),
      input.reason,
      actor.language ?? 'ro',
    ),
  }),
  roles: ['garage', 'receptionist', 'mechanic'],
});
