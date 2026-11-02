import { z } from 'zod';

import { text } from '../../errors';
import { defineTool } from '../../registry';
import { bookedOutput, day } from '../day';

// A schedule entry names its booking's state `status`, as the API does.
const { state: status, ...booked } = bookedOutput;

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
    "Shows the garage's bookings from one day to another (at most 7 days; today when no day is given), in start order: the car, the jobs, the customer, the mechanic, the lift, the status and the job's status, with the minutes left to confirm a booking still awaiting the garage. A long job is on each day it has a working segment, with all its segments. Grouped by mechanic and by lift. Also the blocked time staff set aside for walk-ins and phone bookings (blocks), each with its mechanic, lift, note and day segments. With the garage's lift count and opening hours of each day. Filter by lift or by mechanicId.",
  async handler(actor, input, ctx) {
    const language = actor.language ?? 'ro';
    const schedule = await ctx.garage.schedule.list(
      actor,
      actor.garageId as string,
      input,
    );
    const { entries } = schedule;
    return {
      ...schedule,
      byMechanic: grouped(
        entries,
        (e) => e.mechanic?.id ?? null,
        (e) => ({
          id: e.mechanic?.id ?? null,
          name: e.mechanic?.name ?? text('no_mechanic', language),
        }),
      ),
      ...(schedule.lifts && {
        byLift: grouped(
          entries,
          (e) => e.lift ?? null,
          (e) => ({ lift: e.lift ?? null }),
        ),
      }),
      ...(entries.length === 0 && {
        note: text('empty_schedule', language),
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
  outputSchema: {
    blocks: z.array(
      z.object({
        endsAt: z.string(),
        id: z.string(),
        lift: z.number().nullable().optional(),
        mechanic: z.object({ id: z.string(), name: z.string() }).nullable(),
        note: z.string().nullable(),
        segments: z.array(
          z.object({ endsAt: z.string(), startsAt: z.string() }),
        ),
        startsAt: z.string(),
      }),
    ),
    byLift: z
      .array(
        z.object({
          bookingIds: z.array(z.string()),
          lift: z.number().nullable(),
        }),
      )
      .optional(),
    byMechanic: z.array(
      z.object({
        bookingIds: z.array(z.string()),
        id: z.string().nullable(),
        name: z.string(),
      }),
    ),
    days: z.array(
      z.object({
        day: z.string(),
        open: z.array(z.object({ from: z.string(), to: z.string() })),
      }),
    ),
    entries: z.array(
      z.object({
        ...booked,
        confirmBy: z.string().nullable(),
        customer: z.string(),
        jobStatus: z.string().nullable(),
        lift: z.number().nullable().optional(),
        mechanic: z.object({ id: z.string(), name: z.string() }).nullable(),
        minutesLeft: z.number().nullable(),
        segments: z.array(
          z.object({
            endsAt: z.string(),
            lift: z.number().nullable().optional(),
            mechanicId: z.string().nullable(),
            startsAt: z.string(),
          }),
        ),
        status,
      }),
    ),
    from: z.string(),
    hoursSet: z.boolean(),
    liftCount: z.number(),
    lifts: z.boolean(),
    note: z.string().optional(),
    to: z.string(),
  },
  roles: ['garage', 'receptionist'],
});
