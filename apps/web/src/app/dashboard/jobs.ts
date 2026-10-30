import type { EventKind } from '@motor-fix/contracts';
import { FINAL_PRICE_CORRECTION_HOURS } from '@motor-fix/contracts/request-status';
import type { JobDto, JobSummaryDto } from '@motor-fix/data-access';
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
  'job.handed_over',
  'job.final_price_corrected',
];

// The owner and the front desk record the final price; a mechanic never does.
const DESK = new Set(['garage', 'receptionist']);
const WINDOW_MS = FINAL_PRICE_CORRECTION_HOURS * 3_600_000;

// What the drawer offers on the final price: the handover of a done job, then
// the correction until the window after the handover closes, else nothing.
export function finalPriceAction(
  job: Pick<JobDto, 'status' | 'handedOverAt'>,
  role: string | undefined,
  now: Date,
): 'handover' | 'correct' | null {
  if (!DESK.has(role ?? '') || job.status !== 'done') return null;
  if (!job.handedOverAt) return 'handover';
  const closes = new Date(job.handedOverAt).getTime() + WINDOW_MS;
  return now.getTime() < closes ? 'correct' : null;
}

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
const dayOf = (at: string | Date) => bucharestDay.format(new Date(at));

const LIVE = new Set<JobSummaryDto['status']>(['in_work', 'paused']);

// Booked for today, or still in work from an earlier day.
export function todayOrLive(job: Pick<JobSummaryDto, 'startsAt' | 'status'>) {
  return LIVE.has(job.status) || dayOf(job.startsAt) === dayOf(new Date());
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
