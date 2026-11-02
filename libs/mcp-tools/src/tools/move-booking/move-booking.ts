import { bucharestTime, type MovePreview } from '@motor-fix/domain';
import { z } from 'zod';

import type { Language } from '../../errors';
import { defineTool } from '../../registry';

const two = (n: number) => String(n).padStart(2, '0');

function when(at: Date): string {
  const t = bucharestTime(at);
  return `${two(t.day)}.${two(t.month)}.${t.year} ${two(t.hour)}:${two(t.minute)}`;
}

// What the person agrees to: the garage and both Bucharest times.
function moveSummary(preview: MovePreview, language: Language): string {
  const from = when(preview.startsAt);
  const to = when(preview.newStartsAt);
  return language === 'ro'
    ? `Ceri service-ului ${preview.garageName} mutarea programării de pe ${from} pe ${to}. Programarea rămâne pe ${from} până confirmă service-ul.`
    : `You ask ${preview.garageName} to move the booking from ${from} to ${to}. The booking stays at ${from} until the garage confirms.`;
}

export const moveBooking = defineTool({
  acts: true,
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
    readOnlyHint: false,
  },
  approval: { kind: 'move' },
  capability: 'driver.requests',
  description:
    "Asks the garage to move one of the person's confirmed bookings to another free start time (ISO 8601, on the half hour, at least 2 hours ahead and at most 14 days out). The booking keeps its time until the garage confirms; if the garage does not answer in time the ask lapses. A booking can be moved at most twice, one ask at a time, and not once its job has started. The first call changes nothing: it answers confirmation_required with a summary; show it to the person and pass their yes or no to confirm_action with the same arguments, then the person approves it in the app.",
  handler: async (actor, input, ctx, { run }) => {
    if (!run) throw new Error('a move is asked only inside its approval');
    const move = await ctx.driver.moves.ask(
      run.tx,
      actor,
      input.bookingId,
      { startsAt: input.startsAt },
      run.key,
    );
    return { subjectId: move.id, subjectType: 'booking_move' };
  },
  inputSchema: {
    bookingId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
  },
  name: 'move_booking',
  outputSchema: {
    subjectId: z.string(),
    subjectType: z.literal('booking_move'),
  },
  preview: async (actor, input, ctx) => ({
    summary: moveSummary(
      await ctx.driver.moves.preview(actor, input.bookingId, {
        startsAt: input.startsAt,
      }),
      actor.language ?? 'ro',
    ),
  }),
  roles: ['driver'],
});
