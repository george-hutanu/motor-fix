// @traces 151-FR-001 151-FR-011 151-FR-014 151-FR-016
import { HttpErrorResponse } from '@angular/common/http';
import type { EventKind } from '@motor-fix/contracts';
import type { GarageScheduleDto } from '@motor-fix/data-access';

import {
  blocks,
  entry,
  panel,
  renderPanel,
  schedule,
  text,
} from './lift-schedule.testing';

afterEach(() => jest.useRealTimers());

const DEBOUNCE = 400;

// Each read answers the next schedule of the list, the last one after that.
const reads = (...answers: (GarageScheduleDto | HttpErrorResponse)[]) => {
  let n = 0;
  return () => {
    const answer = answers[Math.min(n++, answers.length - 1)];
    return answer instanceof HttpErrorResponse
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
};

const failure = () => new HttpErrorResponse({ status: 500 });

describe('the lift schedule live', () => {
  it.each<EventKind>([
    'job.started',
    'job.paused',
    'job.resumed',
    'job.done',
    'job.mechanic_changed',
  ])('changes the block on %s within seconds', async (kind) => {
    const before = schedule({
      entries: [entry('b-1', '2026-10-09T06:00:00Z', 60)],
    });
    const after = schedule({
      entries: [
        entry('b-1', '2026-10-09T06:00:00Z', 60, { jobStatus: 'in_work' }),
      ],
    });
    const { element, live, settle } = await renderPanel({
      read: reads(before, after),
    });
    expect(blocks(element)[0].getAttribute('data-style')).toBe('todo');

    live.emit(kind, 'b-1');
    jest.advanceTimersByTime(DEBOUNCE);
    await settle();

    expect(blocks(element)[0].getAttribute('data-style')).toBe('work');
  });

  it.each<EventKind>([
    'booking.confirmed',
    'booking.moved',
    'booking.cancelled',
    'booking.lift_changed',
    'time_block.created',
    'time_block.updated',
    'time_block.deleted',
    'garage.features_changed',
  ])('reads today’s schedule again on %s', async (kind) => {
    const { garageSchedule, live, settle } = await renderPanel();

    live.emit(kind, 'garage-1');
    jest.advanceTimersByTime(DEBOUNCE);
    await settle();

    expect(garageSchedule).toHaveBeenCalledTimes(2);
  });

  it('lights the offline lamp while the stream is down and reads again on reconnect', async () => {
    const { element, garageSchedule, live, settle } = await renderPanel();
    expect(panel(element)?.hasAttribute('data-offline')).toBe(false);

    live.offline.set(true);
    await settle();
    expect(panel(element)?.hasAttribute('data-offline')).toBe(true);
    expect(element.querySelector('[data-offline-lamp]')).not.toBeNull();

    live.offline.set(false);
    live.resync.next();
    await settle();
    expect(panel(element)?.hasAttribute('data-offline')).toBe(false);
    expect(garageSchedule).toHaveBeenCalledTimes(2);
  });
});

describe('the lift schedule states', () => {
  it('shows skeleton rows and no text while loading', async () => {
    const { element } = await renderPanel({
      read: () => new Promise(() => undefined),
    });
    const shown = panel(element);

    expect(shown?.getAttribute('data-state')).toBe('loading');
    expect(shown?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(
      0,
    );
    expect(
      shown?.querySelector('[data-empty], [data-closed], [role="alert"]'),
    ).toBeNull();
  });

  it('says there is no booking today over the empty rows', async () => {
    const { element } = await renderPanel();

    expect(text(element.querySelector('[data-empty]'))).toBe(
      'Nicio programare azi',
    );
    expect(element.querySelectorAll('[data-row]')).toHaveLength(3);
  });

  it('says the garage is closed today and draws no axis, rows or blocks', async () => {
    const { element } = await renderPanel({
      read: async () =>
        schedule({
          days: [{ day: '2026-10-09', open: [] }],
          entries: [entry('b-1', '2026-10-09T06:00:00Z', 60)],
        }),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('closed');
    expect(text(element.querySelector('[data-closed]'))).toBe('Închis azi');
    expect(
      element.querySelectorAll('[data-row], [data-block], [data-axis-label]'),
    ).toHaveLength(0);
  });

  it('says the schedule did not load and reads again on Reîncearcă', async () => {
    const { element, garageSchedule, settle } = await renderPanel({
      read: reads(failure(), schedule()),
    });

    expect(panel(element)?.getAttribute('data-state')).toBe('failed');
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Programul nu s-a încărcat',
    );
    element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await settle();

    expect(garageSchedule).toHaveBeenCalledTimes(2);
    expect(panel(element)?.getAttribute('data-state')).toBe('empty');
  });

  it('keeps the message when the second read fails too', async () => {
    const { element, settle } = await renderPanel({
      read: reads(failure(), failure()),
    });

    element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await settle();

    expect(panel(element)?.getAttribute('data-state')).toBe('failed');
    expect(text(element.querySelector('[data-retry]'))).toBe('Reîncearcă');
  });
});

describe('when the panel is shown', () => {
  it('is absent while the garage schedules without lifts', async () => {
    const { element, garageSchedule } = await renderPanel({
      features: { lift_schedule: false },
    });

    expect(panel(element)).toBeNull();
    expect(garageSchedule).not.toHaveBeenCalled();
  });

  it('goes away without a reload when the switch goes off', async () => {
    const { element, me, settle } = await renderPanel();
    expect(panel(element)).not.toBeNull();

    const account = me();
    me.set({
      ...account,
      garageAccess: account.garageAccess.map((g) => ({
        ...g,
        features: { ...g.features, lift_schedule: false },
      })),
    });
    await settle();

    expect(panel(element)).toBeNull();
  });

  it('is absent for a person without the schedule', async () => {
    const { element, garageSchedule } = await renderPanel({ role: 'driver' });

    expect(panel(element)).toBeNull();
    expect(garageSchedule).not.toHaveBeenCalled();
  });
});
