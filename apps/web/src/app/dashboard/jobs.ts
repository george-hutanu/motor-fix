import type { EventKind } from '@motor-fix/contracts';
import type { JobSummaryDto } from '@motor-fix/data-access';
import { formatClock, formatDay, type Language } from '@motor-fix/i18n';

// Every change that moves a job: its steps, its stage, its mechanic.
export const JOB_KINDS: readonly EventKind[] = [
  'job.step_done',
  'job.step_undone',
  'job.steps_changed',
  'job.started',
  'job.paused',
  'job.resumed',
  'job.done',
  'job.reopened',
  'job.mechanic_changed',
];

// The booked works, in the language shown.
export function jobNames(job: Pick<JobSummaryDto, 'jobs'>, language: string) {
  const english = language === 'en';
  return job.jobs.map((j) => (english ? j.nameEn : j.nameRo)).join(', ');
}

export function jobStage(job: Pick<JobSummaryDto, 'status'>) {
  return `garage.jobs.stage.${job.status}`;
}

const bucharestDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
});

// The Bucharest calendar day of a moment, as YYYY-MM-DD.
export const dayOf = (at: string | Date) => bucharestDay.format(new Date(at));

const LIVE = new Set<JobSummaryDto['status']>(['in_work', 'paused']);

// Booked for today, or still in work from an earlier day.
export function todayOrLive(
  job: Pick<JobSummaryDto, 'startsAt' | 'status'>,
  today = dayOf(new Date()),
) {
  return LIVE.has(job.status) || dayOf(job.startsAt) === today;
}

// Today's time alone; another day's date before it.
export function jobWhen(
  job: Pick<JobSummaryDto, 'startsAt'>,
  language: Language,
) {
  const clock = formatClock(job.startsAt);
  return dayOf(job.startsAt) === dayOf(new Date())
    ? clock
    : `${formatDay(job.startsAt, language)}, ${clock}`;
}
