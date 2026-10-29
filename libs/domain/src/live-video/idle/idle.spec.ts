import { isIdle, LIVE_IDLE } from './idle';

const START = new Date('2026-10-29T10:00:00.000Z');
const at = (minutes: number, seconds = 0) =>
  new Date(START.getTime() + minutes * 60_000 + seconds * 1000);

// @traces 1251-FR-011
describe('when a live session counts as idle', () => {
  it('waits ten minutes', () => {
    expect(LIVE_IDLE.afterMs).toBe(10 * 60_000);
    expect(LIVE_IDLE.everyMs).toBe(60_000);
  });

  it('never stops a session with a publisher', () => {
    expect(isIdle({ connected: true, since: START }, START, at(60))).toBe(
      false,
    );
  });

  it('counts a session never published to from its start', () => {
    const never = { connected: false, since: null };

    expect(isIdle(never, START, at(9, 59))).toBe(false);
    expect(isIdle(never, START, at(10))).toBe(true);
  });

  it('counts a dropped publisher from the drop', () => {
    const dropped = { connected: false, since: at(20) };

    expect(isIdle(dropped, START, at(29, 59))).toBe(false);
    expect(isIdle(dropped, START, at(30))).toBe(true);
  });

  it('never counts from before the session started', () => {
    const earlier = { connected: false, since: at(-30) };

    expect(isIdle(earlier, START, at(9))).toBe(false);
    expect(isIdle(earlier, START, at(10))).toBe(true);
  });
});
