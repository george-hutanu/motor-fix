import * as reads from './reads';
import { firstLine } from './reads';

// @traces 313-FR-005
describe('the first line of a description', () => {
  it.each([
    ['Scârțâie la frână\nmai ales dimineața', 'Scârțâie la frână'],
    ['Frână\r\nzgomot', 'Frână'],
    ['   Frână  \nx', 'Frână'],
    ['\n  \nScârțâie', 'Scârțâie'],
  ])('reads %j as %j', (text, line) => {
    expect(firstLine(text)).toBe(line);
  });

  it.each([null, '', '   ', '\n \r\n'])('reads %j as nothing', (text) => {
    expect(firstLine(text)).toBeNull();
  });
});

// Typed loosely until the reads carry it.
const { toReassign } = reads as unknown as {
  toReassign: (
    row: {
      mechanic: { removedAt: Date | null } | null;
      startsAt: Date;
      status: string;
    },
    now: Date,
  ) => boolean;
};

// @traces 056-FR-008
describe('a booking to reassign', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const later = new Date('2026-10-26T07:00:00Z');
  const earlier = new Date('2026-10-20T07:00:00Z');
  const removed = { removedAt: new Date('2026-10-23T12:00:00Z') };
  const current = { removedAt: null };

  it('is a confirmed booking still ahead whose mechanic was removed', () => {
    expect(
      toReassign(
        { mechanic: removed, startsAt: later, status: 'confirmed' },
        now,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'one already past',
      { mechanic: removed, startsAt: earlier, status: 'confirmed' },
    ],
    [
      'one starting now',
      { mechanic: removed, startsAt: now, status: 'confirmed' },
    ],
    [
      'a cancelled one',
      { mechanic: removed, startsAt: later, status: 'cancelled' },
    ],
    [
      'one awaiting confirmation',
      { mechanic: removed, startsAt: later, status: 'awaiting_confirmation' },
    ],
    [
      "a current card's",
      { mechanic: current, startsAt: later, status: 'confirmed' },
    ],
    [
      'one with no mechanic',
      { mechanic: null, startsAt: later, status: 'confirmed' },
    ],
  ])('is not %s', (_, row) => {
    expect(toReassign(row, now)).toBe(false);
  });
});
