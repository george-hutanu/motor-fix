// @traces 151-FR-005 151-FR-006 151-FR-007 151-FR-008 151-FR-009 151-FR-010 151-FR-012 151-FR-013 151-FR-015 151-FR-017
import {
  block,
  blocks,
  entry,
  panel,
  renderPanel,
  schedule,
  text,
} from './lift-schedule.testing';

const vlad = { id: 'm-1', name: 'Vlad Stan' };

afterEach(() => jest.useRealTimers());

const rowNames = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-row]')].map((row) =>
    text(row.querySelector('[data-row-name]')),
  );

describe('the lift schedule panel', () => {
  it('draws one titled row per lift under the section title', async () => {
    const { element } = await renderPanel();

    expect(text(element.querySelector('h2'))).toBe(
      'Programul de azi, pe elevatoare',
    );
    expect(panel(element)?.getAttribute('data-state')).toBe('empty');
    expect(rowNames(element)).toEqual([
      'Elevator 1',
      'Elevator 2',
      'Elevator 3',
    ]);
  });

  it('labels a block with the car, then the jobs and the mechanic’s first name', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('b-1', '2026-10-09T06:00:00Z', 90, { mechanic: vlad }),
            entry('b-2', '2026-10-09T09:00:00Z', 60),
          ],
        }),
    });
    const [first, second] = blocks(element);

    expect(panel(element)?.getAttribute('data-state')).toBe('drawn');
    expect(first.getAttribute('data-live-id')).toBe('b-1');
    expect(text(first.querySelector('[data-car]'))).toBe('Dacia Logan');
    expect(text(first.querySelector('[data-jobs]'))).toBe(
      'Schimb ulei, Plăcuțe frână · Vlad',
    );
    expect(text(second.querySelector('[data-jobs]'))).toBe(
      'Schimb ulei, Plăcuțe frână',
    );
  });

  it('shows only the car on a block shorter than 30 minutes', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({ entries: [entry('b-1', '2026-10-09T06:00:00Z', 20)] }),
    });
    const [only] = blocks(element);

    expect(text(only.querySelector('[data-car]'))).toBe('Dacia Logan');
    expect(only.querySelector('[data-jobs]')).toBeNull();
  });

  it('styles a block by its job and names the state for screen readers', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('a', '2026-10-09T06:00:00Z', 60, { jobStatus: 'to_do' }),
            entry('b', '2026-10-09T07:00:00Z', 60, {
              jobStatus: 'in_work',
              lift: 2,
            }),
            entry('c', '2026-10-09T08:00:00Z', 60, {
              jobStatus: 'paused',
              lift: 3,
            }),
            entry('d', '2026-10-09T09:00:00Z', 60, { jobStatus: 'done' }),
          ],
        }),
    });
    const styles = blocks(element).map((b) => [
      b.getAttribute('data-live-id'),
      b.getAttribute('data-style'),
      b.getAttribute('aria-label')?.split(' · ').at(-1),
    ]);

    expect(styles).toEqual([
      ['a', 'todo', 'programată'],
      ['d', 'done', 'gata'],
      ['b', 'work', 'în lucru'],
      ['c', 'work', 'în pauză'],
    ]);
  });

  it('gives every block its tooltip and accessible name, with no phone or plate', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('b-1', '2026-10-09T06:00:00Z', 90, { mechanic: vlad }),
          ],
        }),
    });
    const [only] = blocks(element);
    const label =
      'Dacia Logan · Schimb ulei, Plăcuțe frână · Dan V. · Vlad Stan · 09:00, 90 min · programată';

    expect(only.getAttribute('tabindex')).toBe('0');
    expect(only.getAttribute('aria-label')).toBe(label);
    expect(text(only.querySelector('[data-tooltip]'))).toBe(label);
    expect(text(panel(element))).not.toMatch(/\+?40\d{8}|B \d{2,3} [A-Z]{3}/);
  });

  it('draws a lift time block hatched, labelled "Blocat · " and its note', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          blocks: [
            block('t-1', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z'),
          ],
        }),
    });
    const [only] = blocks(element);

    expect(only.getAttribute('data-kind')).toBe('block');
    expect(only.getAttribute('data-style')).toBe('blocked');
    expect(only.closest('[data-row]')?.getAttribute('data-row')).toBe('lift:2');
    expect(text(only.querySelector('[data-label]'))).toBe(
      'Blocat · Client la telefon',
    );
    expect(only.getAttribute('aria-label')).toBe(
      'Blocat · Client la telefon · 10:00, 60 min',
    );
  });

  it('reads the time in the corner and draws the now line', async () => {
    const { element } = await renderPanel();

    expect(text(element.querySelector('[data-now]'))).toBe('acum, 13:00');
    const line = element.querySelector<HTMLElement>('[data-now-line]');
    expect(line?.getAttribute('aria-hidden')).toBe('true');
    expect(line?.style.left).toBe('50%');
  });

  it('ticks the corner and the line on each minute boundary', async () => {
    const { element, settle } = await renderPanel();

    jest.advanceTimersByTime(60_000);
    await settle();

    expect(text(element.querySelector('[data-now]'))).toBe('acum, 13:01');
  });

  it('hides the line outside the axis and keeps the corner', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          days: [{ day: '2026-10-09', open: [{ from: '07:00', to: '12:00' }] }],
        }),
    });

    expect(element.querySelector('[data-now-line]')).toBeNull();
    expect(text(element.querySelector('[data-now]'))).toBe('acum, 13:00');
  });

  it('keeps the timeline in its own sideways scroller', async () => {
    const { element } = await renderPanel();
    const scroller = element.querySelector('.scroller');

    expect(scroller?.getAttribute('role')).toBe('region');
    expect(scroller?.getAttribute('tabindex')).toBe('0');
    expect(scroller?.getAttribute('aria-label')).toBe(
      'Programul de azi, pe elevatoare',
    );
    expect(scroller?.querySelectorAll('[data-axis-label]')).toHaveLength(6);
    expect(element.querySelectorAll('.scroller')).toHaveLength(1);
  });

  it('speaks English with 24-hour times', async () => {
    const { element } = await renderPanel({
      language: 'en',
      read: async () =>
        schedule({
          entries: [
            entry('b-1', '2026-10-09T11:00:00Z', 60, { jobStatus: 'done' }),
          ],
        }),
    });

    expect(rowNames(element)[0]).toBe('Lift 1');
    expect(text(element.querySelector('[data-now]'))).toBe('now, 13:00');
    expect(blocks(element)[0].getAttribute('aria-label')).toMatch(
      / · 14:00, 60 min · done$/,
    );
  });
});

// @traces 151-FR-012
describe('the first drawing', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scrolls the timeline once so the now line stands mid-view', async () => {
    // 8:00 to 18:00 at 48 px an hour beside the 104 px names: 584 px wide.
    jest
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(584);
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(300);
    const scrolled = jest.spyOn(Element.prototype, 'scrollLeft', 'set');

    const { live, settle } = await renderPanel();

    // 13:00 is half the axis: 104 + 240 px, less half the view.
    expect(scrolled.mock.calls).toEqual([[194]]);
    live.emit('booking.moved', 'b-1');
    await jest.advanceTimersByTimeAsync(300);
    await settle();
    expect(scrolled).toHaveBeenCalledTimes(1);
  });
});

describe('blocked time and bookings without a lift', () => {
  it('shows only the empty note, no bare hours axis, for a garage with no lift and no booking', async () => {
    const { element } = await renderPanel({
      read: async () => schedule({ liftCount: 0 }),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('empty');
    expect(element.querySelector('[data-empty]')).not.toBeNull();
    expect(element.querySelector('[data-axis-label]')).toBeNull();
    expect(element.querySelector('[role="region"]')).toBeNull();
  });

  it('adds the "Fără elevator" row last, and a row for a lift above the count', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('b-1', '2026-10-09T06:00:00Z', 60, { lift: null }),
            entry('b-2', '2026-10-09T07:00:00Z', 60, { lift: 4 }),
          ],
        }),
    });

    expect(rowNames(element)).toEqual([
      'Elevator 1',
      'Elevator 2',
      'Elevator 3',
      'Elevator 4',
      'Fără elevator',
    ]);
  });

  it('grows a row with overlapping blocks into sub-rows', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('a', '2026-10-09T06:00:00Z', 120),
            entry('b', '2026-10-09T07:00:00Z', 60),
          ],
        }),
    });

    const subs = (key: string) =>
      element
        .querySelector<HTMLElement>(`[data-row="${key}"]`)
        ?.style.getPropertyValue('--subs');
    expect(subs('lift:1')).toBe('2');
    expect(subs('lift:2')).toBe('1');
  });

  it.each([
    ['the owner', 'garage'],
    ['a receptionist', 'receptionist'],
  ] as const)(
    'opens the block dialog on that block for %s',
    async (_who, role) => {
      const t1 = block('t-1', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z');
      const { element, garageSchedule, open, settle } = await renderPanel({
        read: async () => schedule({ blocks: [t1] }),
        role,
      });
      const [only] = blocks(element);

      expect(only.tagName).toBe('BUTTON');
      only.click();
      await settle();

      expect(open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            block: t1,
            garageId: 'garage-1',
            lifts: true,
          }),
        }),
      );
      expect(garageSchedule).toHaveBeenCalledTimes(2);
    },
  );

  it('opens nothing for a mechanic', async () => {
    const { element, open, settle } = await renderPanel({
      read: async () =>
        schedule({
          blocks: [
            block('t-1', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z'),
          ],
        }),
      role: 'mechanic',
    });
    const [only] = blocks(element);

    expect(only.tagName).not.toBe('BUTTON');
    only.click();
    only.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();

    expect(open).not.toHaveBeenCalled();
  });
});

describe('a mechanic’s panel', () => {
  it('shows what the read gives her, with one read and the other lifts kept', async () => {
    const { element, garageSchedule } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('hers', '2026-10-09T06:00:00Z', 60, {
              lift: 2,
              mechanic: vlad,
            }),
          ],
        }),
      role: 'mechanic',
    });

    expect(garageSchedule).toHaveBeenCalledTimes(1);
    expect(garageSchedule).toHaveBeenCalledWith({ garageId: 'garage-1' });
    expect(rowNames(element)).toEqual([
      'Elevator 1',
      'Elevator 2',
      'Elevator 3',
    ]);
    expect(blocks(element)).toHaveLength(1);
  });
});
