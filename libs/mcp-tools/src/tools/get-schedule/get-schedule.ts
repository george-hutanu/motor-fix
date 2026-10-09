import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { day } from '../day';

// Ids under each key, the groups in order of first appearance.
function grouped<E extends { id: string }, K, G>(
  entries: E[],
  keyOf: (entry: E) => K,
  groupOf: (entry: E) => G,
) {
  const groups = new Map<K, G & { bookingIds: string[] }>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? { ...groupOf(entry), bookingIds: [] };
    group.bookingIds.push(entry.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export const getSchedule = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  description:
    "Shows the garage's bookings from one day to another (at most 7 days; today when no day is given), in start order: the car, the jobs, the mechanic, the lift and the state, with the minutes left to confirm a booking still awaiting the garage. Grouped by mechanic and by lift. Filter by lift or by mechanicId.",
  async handler(actor, input, ctx) {
    const schedule = await ctx.garage.schedule.list(actor, input);
    const { entries } = schedule;
    return {
      ...schedule,
      byMechanic: grouped(
        entries,
        (e) => e.mechanic?.id ?? null,
        (e) => ({
          id: e.mechanic?.id ?? null,
          name: e.mechanic?.name ?? 'unassigned',
        }),
      ),
      ...(schedule.lifts && {
        byLift: grouped(
          entries,
          (e) => e.lift,
          (e) => ({ lift: e.lift }),
        ),
      }),
      ...(entries.length === 0 && {
        note: text('empty_schedule', actor.language ?? 'ro'),
      }),
    };
  },
  inputSchema: {
    from: day.optional(),
    lift: z.number().int().positive().optional(),
    mechanicId: z.uuid().optional(),
    to: day.optional(),
  },
  name: 'get_schedule',
  roles: ['garage', 'receptionist'],
});
