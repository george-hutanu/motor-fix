// @traces 151-FR-001 151-FR-016
import { ScheduleView } from './schedule-view';
import {
  blocks,
  entry,
  panel,
  renderPanel,
  schedule,
  text,
} from '../lift-schedule/lift-schedule.testing';

afterEach(() => jest.useRealTimers());

const view = (options: Parameters<typeof renderPanel>[0] = {}) =>
  renderPanel({ ...options, host: ScheduleView });

describe('Programări', () => {
  it('holds today’s lift schedule as its body', async () => {
    const { element } = await view({
      read: async () =>
        schedule({ entries: [entry('b-1', '2026-10-09T06:00:00Z', 60)] }),
    });

    expect(panel(element)).not.toBeNull();
    expect(blocks(element)).toHaveLength(1);
  });

  it('keeps its coming-soon line while the garage schedules without lifts', async () => {
    const { element, garageSchedule } = await view({
      features: { lift_schedule: false },
    });

    expect(panel(element)).toBeNull();
    expect(garageSchedule).not.toHaveBeenCalled();
    expect(text(element)).toMatch(/^Aici vei vedea programările/);
  });

  it('drops the panel when the switch goes off, without a reload', async () => {
    const { element, me, settle } = await view();
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

  it('shows no panel to a person without the schedule', async () => {
    const { element, garageSchedule } = await view({ role: 'driver' });

    expect(panel(element)).toBeNull();
    expect(garageSchedule).not.toHaveBeenCalled();
  });
});
