// @traces 184-FR-012
import type { BookingMoveDto } from '@motor-fix/contracts';

import { moveBooking } from './move-booking';
import {
  caller,
  context,
  memoryApprovals,
  memoryConfirmations,
} from '../../fixtures.testing';
import { callTool } from '../../registry';
import { confirmAction } from '../confirm-action/confirm-action';

const BOOKING = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';
const ARGS = { bookingId: BOOKING, startsAt: '2026-11-12T12:00:00.000Z' };
const PREVIEW = {
  garageName: 'Atelier Dinamo',
  newStartsAt: new Date('2026-11-12T12:00:00Z'),
  startsAt: new Date('2026-11-12T08:00:00Z'),
};
const MOVE = {} as BookingMoveDto;

function setup(roles: ('driver' | 'garage')[] = ['driver']) {
  const moves = {
    ask: vi.fn(async () => MOVE),
    preview: vi.fn(async () => PREVIEW),
  };
  const approvals = memoryApprovals();
  const ctx = context({
    approvals,
    confirmations: memoryConfirmations(),
    driver: { moves },
  });
  const who = caller({ language: 'en', roles });
  return { approvals, ctx, moves, tools: [moveBooking, confirmAction], who };
}

describe('move_booking given hostile arguments', () => {
  it.each([
    ['no arguments', {}],
    ['a missing start', { bookingId: BOOKING }],
    ['a missing booking', { startsAt: ARGS.startsAt }],
    ['a null start', { ...ARGS, startsAt: null }],
    ['a numeric start', { ...ARGS, startsAt: 1_700_000_000_000 }],
    ['an array for the booking', { ...ARGS, bookingId: [BOOKING] }],
    ['an empty booking id', { ...ARGS, bookingId: '' }],
  ])('refuses %s with validation and checks nothing', async (_n, args) => {
    const { ctx, moves, tools, who } = setup();

    const result = await callTool(tools, who, ctx, 'move_booking', args);

    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(moves.preview).not.toHaveBeenCalled();
    expect(moves.ask).not.toHaveBeenCalled();
  });

  it('writes nothing and records no approval for a call that only asks', async () => {
    const { approvals, ctx, moves, tools, who } = setup();

    await callTool(tools, who, ctx, 'move_booking', ARGS);

    expect(approvals.rows.size).toBe(0);
    expect(moves.ask).not.toHaveBeenCalled();
  });

  it('does not run for a caller who is only a garage account', async () => {
    const { ctx, moves, tools, who } = setup(['garage']);

    const result = await callTool(tools, who, ctx, 'move_booking', ARGS);

    expect(result.isError).toBe(true);
    expect(moves.preview).not.toHaveBeenCalled();
    expect(moves.ask).not.toHaveBeenCalled();
  });

  it('refuses a confirmed yes whose arguments were swapped for another booking', async () => {
    const { approvals, ctx, moves, tools, who } = setup();
    const first = (await callTool(tools, who, ctx, 'move_booking', ARGS))
      .structuredContent as { confirmationId: string };

    const result = await callTool(tools, who, ctx, 'confirm_action', {
      arguments: { ...ARGS, bookingId: '11111111-1111-4111-8111-111111111111' },
      confirmationId: first.confirmationId,
      confirmed: true,
    });

    expect(result.structuredContent).toMatchObject({
      reason: 'arguments_changed',
      status: 'not_sent',
    });
    expect(approvals.rows.size).toBe(0);
    expect(moves.ask).not.toHaveBeenCalled();
  });
});
