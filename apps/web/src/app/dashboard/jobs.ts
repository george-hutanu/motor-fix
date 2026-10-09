import type { EventKind } from '@motor-fix/contracts';
import type { JobSummaryDto } from '@motor-fix/data-access';

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
