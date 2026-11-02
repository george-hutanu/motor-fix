// @traces 184-FR-012
import type { BookingMoveDto } from '@motor-fix/contracts';
import { ConflictException } from '@nestjs/common';

import { moveBooking } from './move-booking';
import { catalogue } from '../../catalogue';
import {
  caller,
  context,
  memoryApprovals,
  memoryConfirmations,
} from '../../fixtures.testing';
import { callTool, type Step } from '../../registry';
import { confirmAction } from '../confirm-action/confirm-action';

const BOOKING = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';
const ARGS = { bookingId: BOOKING, startsAt: '2026-11-12T12:00:00.000Z' };

const PREVIEW = {
  garageName: 'Atelier Dinamo',
  newStartsAt: new Date('2026-11-12T12:00:00Z'),
  startsAt: new Date('2026-11-12T08:00:00Z'),
};

const MOVE: BookingMoveDto = {
  bookingId: BOOKING,
  decidedAt: null,
  id: '0b6f3c1e-1f7b-4c9a-8d0e-2a5b6c7d8e9f',
  lapsesAt: '2026-11-03T10:00:00.000Z',
  newStartsAt: ARGS.startsAt,
  proposedBySide: 'driver',
  refuseReason: null,
  status: 'proposed',
};

const movesOf = (
  ask: () => Promise<BookingMoveDto> = async () => MOVE,
  preview: () => Promise<typeof PREVIEW> = async () => PREVIEW,
) => ({ ask: vi.fn(ask), preview: vi.fn(preview) });

function setup(moves = movesOf(), language: 'ro' | 'en' = 'ro') {
  const approvals = memoryApprovals();
  const confirmations = memoryConfirmations();
  const ctx = context({ approvals, confirmations, driver: { moves } });
  const who = caller({ language, roles: ['driver'] });
  const tools = [moveBooking, confirmAction];
  return {
    approvals,
    confirmations,
    ctx,
    first: () => callTool(tools, who, ctx, 'move_booking', ARGS),
    tools,
    who,
  };
}

describe('move_booking', () => {
  it('is an acting driver tool approved in the app as a move', () => {
    expect(catalogue).toContain(moveBooking);
    expect(moveBooking.acts).toBe(true);
    expect(moveBooking.roles).toEqual(['driver']);
    expect(moveBooking.capability).toBe('driver.requests');
    expect(moveBooking.approval).toEqual({ kind: 'move' });
  });

  it('first answers confirmation_required after the checks, writing nothing', async () => {
    const moves = movesOf();
    const { first } = setup(moves);

    const result = await first();

    expect(result.structuredContent).toMatchObject({
      status: 'confirmation_required',
      tool: 'move_booking',
    });
    expect(moves.preview).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'assistant' }),
      BOOKING,
      { startsAt: ARGS.startsAt },
    );
    expect(moves.ask).not.toHaveBeenCalled();
  });

  it.each([
    ['ro', /^Ceri service-ului Atelier Dinamo /],
    ['en', /^You ask Atelier Dinamo /],
  ] as const)('names the garage in the %s summary', async (language, name) => {
    const { first } = setup(movesOf(), language);

    const result = await first();

    expect((result.structuredContent as { summary: string }).summary).toMatch(
      name,
    );
  });

  it('saves only a move approval at the yes and asks nothing yet', async () => {
    const moves = movesOf();
    const { approvals, ctx, first, tools, who } = setup(moves);
    const { confirmationId } = (await first()).structuredContent as {
      confirmationId: string;
    };

    const result = await callTool(tools, who, ctx, 'confirm_action', {
      arguments: ARGS,
      confirmationId,
      confirmed: true,
    });

    expect(result.structuredContent).toMatchObject({
      status: 'approval_required',
    });
    expect([...approvals.rows.values()]).toEqual([
      expect.objectContaining({
        args: ARGS,
        kind: 'move',
        tool: 'move_booking',
      }),
    ]);
    expect(moves.ask).not.toHaveBeenCalled();
  });

  it("asks under the approval's transaction and key once approved", async () => {
    const moves = movesOf();
    const { ctx, who } = setup(moves);
    const tx = { approval: true } as unknown as NonNullable<Step['run']>['tx'];
    const actor = {
      accountId: who.account.id,
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'driver' as const,
      roles: ['driver' as const],
      via: 'assistant' as const,
    };

    const output = await moveBooking.handler(actor, ARGS, ctx, {
      caller: who,
      run: { key: 'approval-1', tx },
      tools: [moveBooking],
    });

    expect(moves.ask).toHaveBeenCalledWith(
      tx,
      actor,
      BOOKING,
      { startsAt: ARGS.startsAt },
      'approval-1',
    );
    expect(output).toEqual({ subjectId: MOVE.id, subjectType: 'booking_move' });
  });

  it('passes a refusal at approval time through with its code', async () => {
    const moves = movesOf(async () => {
      throw new ConflictException({ code: 'move_limit' });
    });
    const { ctx, who } = setup(moves);

    await expect(
      moveBooking.handler(
        {
          accountId: who.account.id,
          garageId: null,
          permissions: {
            canAnswerQuotes: false,
            canMoveBookings: false,
            canRecordFinalPrice: false,
          },
          role: 'driver',
          roles: ['driver'],
        },
        ARGS,
        ctx,
        {
          caller: who,
          run: { key: 'approval-1', tx: {} as never },
          tools: [moveBooking],
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'move_limit' } });
  });

  it.each([
    ['a booking id that is not a uuid', { ...ARGS, bookingId: 'b-1' }],
    ['a start that is not a time', { ...ARGS, startsAt: 'tomorrow' }],
  ])('refuses %s with validation', async (_, args) => {
    const moves = movesOf();
    const { ctx, tools, who } = setup(moves);

    const result = await callTool(tools, who, ctx, 'move_booking', args);

    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(moves.preview).not.toHaveBeenCalled();
  });
});
