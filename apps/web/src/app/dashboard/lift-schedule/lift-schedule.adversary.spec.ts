// @traces 151-FR-001 151-FR-006 151-FR-013 151-FR-015 151-FR-016
import { HttpErrorResponse } from '@angular/common/http';

import {
  block,
  blocks,
  entry,
  panel,
  renderPanel,
  schedule,
  text,
} from './lift-schedule.testing';

afterEach(() => jest.useRealTimers());

describe('the lift schedule panel under hostile data', () => {
  it('renders markup in a note and a customer name as plain text', async () => {
    const note = '<img src=x onerror="window.__pwned=1"><b>x</b>';
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          blocks: [
            block('t', '2026-10-09T06:00:00Z', '2026-10-09T08:00:00Z', {
              note,
            }),
          ],
          entries: [
            entry('b', '2026-10-09T09:00:00Z', 90, {
              customer: '<script>alert(1)</script>',
            }),
          ],
        }),
    });

    expect(element.querySelector('img, script, b')).toBeNull();
    expect(
      blocks(element).some((b) => b.getAttribute('aria-label')?.includes(note)),
    ).toBe(true);
  });

  it('never shows a phone or a plate that rides along on an entry', async () => {
    const e = entry('b', '2026-10-09T06:00:00Z', 90) as unknown as Record<
      string,
      unknown
    >;
    e['phone'] = '+40722123456';
    e['plate'] = 'B123XYZ';
    e['customerPhone'] = '+40722123456';
    e['car'] = { brand: 'Dacia', model: 'Logan', plate: 'B123XYZ', year: 2019 };
    const { element } = await renderPanel({
      read: async () => schedule({ entries: [e as never] }),
    });
    const everything =
      text(element) +
      blocks(element)
        .map((b) => b.getAttribute('aria-label'))
        .join(' ') +
      element.innerHTML;

    expect(everything).not.toContain('+40722123456');
    expect(everything).not.toContain('B123XYZ');
  });

  it.each([
    ['Elena Popescu', 'Elena'],
    ['  Elena   Popescu', 'Elena'],
    ['Ana-Maria Ionescu', 'Ana-Maria'],
    ['Elena', 'Elena'],
    ['Ștefan Țurcanu', 'Ștefan'],
  ])('reads the mechanic %p as the first name %p', async (name, first) => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('b', '2026-10-09T06:00:00Z', 90, {
              mechanic: { id: 'm', name },
            }),
          ],
        }),
    });

    expect(text(blocks(element)[0].querySelector('[data-jobs]'))).toBe(
      `Schimb ulei, Plăcuțe frână · ${first}`,
    );
  });

  it('draws a booking with no jobs without a stray separator', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          entries: [
            entry('b', '2026-10-09T06:00:00Z', 90, {
              jobs: [],
              mechanic: { id: 'm', name: 'Elena P.' },
            }),
          ],
        }),
    });
    const second = text(blocks(element)[0].querySelector('[data-jobs]'));

    expect(second.startsWith(' ·')).toBe(false);
    expect(second.startsWith('·')).toBe(false);
  });

  it('draws five hundred bookings as five hundred blocks', async () => {
    const entries = Array.from({ length: 500 }, (_, i) =>
      entry(
        `e-${i}`,
        new Date(
          Date.parse('2026-10-09T05:00:00Z') + (i % 120) * 5 * 60_000,
        ).toISOString(),
        5,
        {
          lift: (i % 3) + 1,
        },
      ),
    );
    const { element } = await renderPanel({
      read: async () => schedule({ entries }),
    });

    expect(blocks(element)).toHaveLength(500);
  });

  it('makes every block reachable by keyboard', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          blocks: [block('t', '2026-10-09T06:00:00Z', '2026-10-09T07:00:00Z')],
          entries: [entry('b', '2026-10-09T09:00:00Z', 90)],
        }),
    });

    expect(blocks(element).map((b) => b.tabIndex)).toEqual([0, 0]);
  });
});

describe('the lift schedule panel when the read misbehaves', () => {
  it('reads "failed" when the read rejects with a plain string', async () => {
    const { element } = await renderPanel({
      read: () => Promise.reject('boom' as never),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('failed');
    expect(element.querySelector('[data-retry]')).not.toBeNull();
  });

  it('keeps the failed message when the retry fails again, and recovers on the third read', async () => {
    let n = 0;
    const { element, settle, garageSchedule } = await renderPanel({
      read: () =>
        ++n < 3
          ? Promise.reject(new HttpErrorResponse({ status: 503 }))
          : Promise.resolve(schedule()),
    });
    const retry = () =>
      element.querySelector<HTMLButtonElement>('[data-retry]');

    retry()?.click();
    await settle();
    expect(panel(element)?.getAttribute('data-state')).toBe('failed');

    retry()?.click();
    await settle();
    expect(panel(element)?.getAttribute('data-state')).toBe('empty');
    expect(garageSchedule).toHaveBeenCalledTimes(3);
  });

  it('does not stay on the skeleton when the read answers with null', async () => {
    const { element } = await renderPanel({
      read: () => Promise.resolve(null as never),
    });

    expect(panel(element)?.getAttribute('data-state')).not.toBe('loading');
  });

  it('does not crash when an older server answers without days', async () => {
    const old = schedule() as unknown as Record<string, unknown>;
    delete old['days'];
    const { element } = await renderPanel({
      read: async () => old as never,
    });

    expect(panel(element)?.getAttribute('data-state')).toMatch(
      /^(failed|closed|empty|drawn)$/,
    );
  });

  it('does not crash when an older server answers without liftCount', async () => {
    const old = schedule() as unknown as Record<string, unknown>;
    delete old['liftCount'];
    const { element } = await renderPanel({ read: async () => old as never });

    expect(panel(element)?.getAttribute('data-state')).toMatch(
      /^(failed|closed|empty|drawn)$/,
    );
  });

  it('reads closed when the answer holds days that do not include the day asked', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          days: [{ day: '2026-10-10', open: [{ from: '08:00', to: '18:00' }] }],
        }),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('closed');
  });

  it('draws the 8:00 to 18:00 axis when hours are not set whatever the days say', async () => {
    const { element } = await renderPanel({
      read: async () => schedule({ days: [], hoursSet: false }),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('empty');
    expect(
      [...element.querySelectorAll('[data-axis-label]')].map((l) => text(l)),
    ).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
  });

  it('draws nothing but the closed note on a closed day even with bookings in the answer', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          days: [{ day: '2026-10-09', open: [] }],
          entries: [entry('b', '2026-10-09T06:00:00Z', 90)],
        }),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('closed');
    expect(blocks(element)).toEqual([]);
    expect(element.querySelectorAll('[data-row]')).toHaveLength(0);
  });
});

describe('the lift schedule panel and its switch', () => {
  it('is not shown when the switch is off', async () => {
    const { fixture } = await renderPanel({
      features: { lift_schedule: false },
    });

    expect(fixture.componentInstance.shown()).toBe(false);
  });

  it('is shown when the switch is on', async () => {
    const { fixture } = await renderPanel({
      features: { lift_schedule: true },
    });

    expect(fixture.componentInstance.shown()).toBe(true);
  });

  it('goes away without a read when the switch is off', async () => {
    const { garageSchedule } = await renderPanel({
      features: { lift_schedule: false },
    });

    expect(garageSchedule).not.toHaveBeenCalled();
  });

  it('stays shown for a mechanic without can_move_bookings and shows the lift names', async () => {
    const { element, fixture } = await renderPanel({ role: 'mechanic' });

    expect(fixture.componentInstance.shown()).toBe(true);
    expect(element.querySelectorAll('[data-row-name]')).toHaveLength(3);
  });
});
