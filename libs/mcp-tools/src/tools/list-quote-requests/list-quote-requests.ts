import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { userText, userTextOutput } from '../../user-text';

export const listQuoteRequests = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  capability: 'garage.requests',
  description:
    "Lists the quote requests sent to the person's garage, newest first, 20 at a time: the car, the jobs asked (marking those the garage does not offer for the car's brand), the driver's description, and where the garage's answer stands. Filter by status: waiting (the default), quoted, declined or accepted. Pass nextCursor back as cursor for the next page.",
  async handler(actor, input, ctx) {
    const language = actor.language ?? 'ro';
    const { items, nextCursor } = await ctx.garage.requests.inbox(actor, input);
    return {
      items: items.map((item) => ({
        ...item,
        description:
          item.description === null
            ? null
            : userText('driver', item.description),
        jobs: item.jobs.map((job) => ({
          id: job.id,
          name: language === 'en' ? job.nameEn : job.nameRo,
          notOffered: job.notOffered,
        })),
      })),
      nextCursor,
      status: input.status,
      ...(items.length === 0 && { note: text('empty_requests', language) }),
    };
  },
  inputSchema: {
    cursor: z.string().min(1).optional(),
    status: z
      .enum(['waiting', 'quoted', 'declined', 'accepted'])
      .default('waiting'),
  },
  name: 'list_quote_requests',
  // The car carries no plate and the driver only a short name; the garage's
  // own answer and quote stay as the dashboard row has them.
  outputSchema: {
    items: z.array(
      z.object({
        car: z.object({
          brand: z.string(),
          engine: z.string().nullable(),
          fuel: z.string(),
          model: z.string(),
          year: z.number(),
        }),
        createdAt: z.string(),
        description: userTextOutput.nullable(),
        driver: z.object({ shortName: z.string() }),
        expiresAt: z.string(),
        id: z.string(),
        jobs: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            notOffered: z.boolean(),
          }),
        ),
        quote: z.looseObject({ id: z.string(), status: z.string() }).nullable(),
        recipient: z.looseObject({ status: z.string() }),
        status: z.string(),
      }),
    ),
    nextCursor: z.string().nullable(),
    note: z.string().optional(),
    status: z.enum(['waiting', 'quoted', 'declined', 'accepted']),
  },
  roles: ['garage', 'receptionist', 'mechanic'],
});
