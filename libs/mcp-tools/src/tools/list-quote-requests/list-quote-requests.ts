import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { userText } from '../../user-text';

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
  roles: ['garage', 'receptionist', 'mechanic'],
});
