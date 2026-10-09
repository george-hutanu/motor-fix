import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { userText, userTextOutput } from '../../user-text';
import { bookedOutput, day } from '../day';

export const getDaySheet = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  description:
    "Shows one mechanic's day sheet: their confirmed and completed jobs of the day (today when no day is given) in start order, with the car, the jobs, the customer's note, the job count and the total hours. Name the mechanic by id, full name or first name; when no single mechanic matches, the answer lists the garage's mechanics to choose from.",
  garageFeature: 'day_sheets',
  async handler(actor, input, ctx) {
    const sheet = await ctx.garage.daySheet.get(actor, input);
    return {
      ...sheet,
      entries: sheet.entries.map((entry) => ({
        ...entry,
        note: entry.note === null ? null : userText('driver', entry.note),
      })),
      ...(sheet.entries.length === 0 && {
        note: text('empty_day_sheet', actor.language ?? 'ro'),
      }),
    };
  },
  inputSchema: {
    day: day.optional(),
    mechanic: z.string().trim().min(1),
  },
  name: 'get_day_sheet',
  outputSchema: {
    day: z.string(),
    entries: z.array(
      z.object({ ...bookedOutput, note: userTextOutput.nullable() }),
    ),
    jobCount: z.number(),
    mechanic: z.object({ id: z.string(), name: z.string() }),
    note: z.string().optional(),
    totalHours: z.number(),
  },
  roles: ['garage', 'receptionist'],
});
