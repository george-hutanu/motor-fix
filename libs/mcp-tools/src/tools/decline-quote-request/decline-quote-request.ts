import { DECLINE_REASON_CODES } from '@motor-fix/contracts';
import { z } from 'zod';

import { defineTool } from '../../registry';

export const declineQuoteRequest = defineTool({
  acts: true,
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
    readOnlyHint: false,
  },
  capability: 'garage.requests',
  description:
    "Declines a quote request sent to the person's garage, with one of four reasons: fully_booked, job_not_done (the garage does not do this job), make_model_engine_not_done (it does not work on this make, model or engine) or need_to_see_car. Before calling, confirm with the person which request (its car and driver, from list_quote_requests) and which reason. The driver is told the reason about 5 minutes later. A request the garage already quoted or declined, or one that has closed, cannot be declined.",
  handler: (actor, input, ctx) =>
    ctx.garage.decline.decline(actor, input.requestId, input.reason),
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
  roles: ['garage', 'receptionist', 'mechanic'],
});
