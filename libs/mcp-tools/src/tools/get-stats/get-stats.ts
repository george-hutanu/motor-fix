import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { day } from '../day';

export const getStats = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  description:
    "Gives the garage's numbers for this week (the default), this month, or a from-to range of up to 366 days: requests received, quotes sent and won, bookings, estimated work in bani and the typical minutes to answer a request (the middle value). Set compareWithPrevious to add the period before.",
  async handler(actor, input, ctx) {
    const figures = await ctx.garage.figures.get(actor, input);
    const quiet = Object.values(figures.current).every((v) => !v);
    return {
      ...figures,
      ...(quiet && { note: text('empty_stats', actor.language ?? 'ro') }),
    };
  },
  inputSchema: {
    compareWithPrevious: z.boolean().optional(),
    from: day.optional(),
    period: z.enum(['week', 'month']).optional(),
    to: day.optional(),
  },
  name: 'get_stats',
  roles: ['garage', 'receptionist'],
});
