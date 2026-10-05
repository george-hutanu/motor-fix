import { addDays, atLocal, daysBetween, localDay } from '../bucharest';

// When a daily run happens: the day it is now, and the instant of a day's run.
export interface DailyClock {
  today(now: Date): string;
  runAt(day: string): Date;
}

// At `hour`:00 Europe/Bucharest, whatever the clocks did that night.
export const bucharestDaily = (hour: number): DailyClock => ({
  runAt: (day) => atLocal(day, hour),
  today: localDay,
});

// Test environments only: a day lasts `dayMs`, the first starting at `start`.
export function shortenedDaily(start: Date, dayMs: number): DailyClock {
  const first = localDay(start);
  return {
    runAt: (day) => new Date(start.getTime() + daysBetween(first, day) * dayMs),
    today: (now) =>
      addDays(first, Math.floor((now.getTime() - start.getTime()) / dayMs)),
  };
}

export const runDue = (clock: DailyClock, now: Date) =>
  now >= clock.runAt(clock.today(now));

// The first run after `now`.
export function nextRun(clock: DailyClock, now: Date) {
  const today = clock.today(now);
  const day = clock.runAt(today) > now ? today : addDays(today, 1);
  return { at: clock.runAt(day), day };
}
