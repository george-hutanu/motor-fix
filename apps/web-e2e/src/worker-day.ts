import { Queue } from 'bullmq';

// The day the worker's reminders run next: the latest `daily-<day>` job on
// its queue. With REMINDER_DAY_MS a day lasts that many milliseconds, so the
// worker's calendar runs far ahead of the wall clock.
export async function nextReminderDay(): Promise<string> {
  const queue = new Queue('reminders', {
    connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
  });
  try {
    const days = (await queue.getJobs(['delayed', 'waiting', 'active']))
      .map((job) => /^daily-(\d{4}-\d{2}-\d{2})$/.exec(job.id ?? '')?.[1])
      .filter((day): day is string => day !== undefined)
      .sort();
    const day = days.at(-1);
    if (!day) throw new Error('the worker has no reminders day queued');
    return day;
  } finally {
    await queue.close();
  }
}

// `day` plus `n` calendar days.
export const plusDays = (day: string, n: number) =>
  new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
