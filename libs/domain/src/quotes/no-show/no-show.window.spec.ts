import { noShowUndoOpen } from './no-show.window';

const at = (iso: string) => new Date(iso);

// @traces 1259-FR-005
// @traces 1259-FR-013
describe('the window to withdraw a no-show', () => {
  it('stays open the rest of the Bucharest day the no-show was recorded', () => {
    // 09:25 in Bucharest (UTC+2 in winter).
    const recorded = at('2026-11-10T07:25:00Z');

    expect(noShowUndoOpen(recorded, recorded)).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-11-10T21:59:59Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-11-10T22:00:00Z'))).toBe(false);
    expect(noShowUndoOpen(recorded, at('2026-11-12T08:00:00Z'))).toBe(false);
  });

  it('gives a recording at 23:58 two minutes, closing at midnight', () => {
    const recorded = at('2026-11-10T21:58:00Z');

    expect(noShowUndoOpen(recorded, at('2026-11-10T21:59:59Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-11-10T22:00:00Z'))).toBe(false);
  });

  it('counts the 23-hour day the clocks go forward by the Bucharest clock', () => {
    // 29 March 2026: 03:00 becomes 04:00; midnight after is 21:00 UTC.
    const recorded = at('2026-03-29T05:00:00Z');

    expect(noShowUndoOpen(recorded, at('2026-03-29T20:59:59Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-03-29T21:00:00Z'))).toBe(false);
  });

  it('counts the 25-hour day the clocks go back by the Bucharest clock', () => {
    // 25 October 2026: 04:00 becomes 03:00; midnight after is 22:00 UTC.
    const recorded = at('2026-10-24T21:30:00Z');

    expect(noShowUndoOpen(recorded, at('2026-10-25T21:59:59Z'))).toBe(true);
    expect(noShowUndoOpen(recorded, at('2026-10-25T22:00:00Z'))).toBe(false);
  });

  it('runs from the recording, not from the booking’s slot of the day before', () => {
    // Recorded at 00:30 for a slot the evening before: open all that day.
    const recorded = at('2026-11-10T22:30:00Z');

    expect(noShowUndoOpen(recorded, at('2026-11-11T20:00:00Z'))).toBe(true);
  });
});
