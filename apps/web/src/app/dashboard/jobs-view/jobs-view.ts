import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { formatClock, formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { JobSteps } from '../job-steps/job-steps';
import { JOB_KINDS, jobNames, jobStage } from '../jobs';
import { liveResource } from '../live';

const bucharestDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
});

const LIVE = new Set<JobSummaryDto['status']>(['in_work', 'paused']);

// "Lucrări": the garage's confirmed jobs from today on, and those still in
// work from earlier, by booking start. A row opens the job's steps.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-jobs-view',
  styleUrl: './jobs-view.css',
  templateUrl: './jobs-view.html',
})
export class JobsView {
  private readonly api = inject(GarageJobsService);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  protected readonly skeletons = [1, 2, 3];
  protected readonly view = liveResource(
    () => this.api.garageJobsControllerList({}),
    JOB_KINDS,
  );

  constructor() {
    void this.i18n.enter('garage');
  }

  private readonly today = () => bucharestDay.format(new Date());

  // Today's time alone; another day's date before it.
  protected when(job: JobSummaryDto) {
    const clock = formatClock(job.startsAt);
    return bucharestDay.format(new Date(job.startsAt)) === this.today()
      ? clock
      : `${formatDay(job.startsAt, this.i18n.language())}, ${clock}`;
  }

  // Nothing booked for today and nothing still in work.
  protected noneToday(items: readonly JobSummaryDto[]) {
    const today = this.today();
    return !items.some(
      (job) =>
        LIVE.has(job.status) ||
        bucharestDay.format(new Date(job.startsAt)) === today,
    );
  }

  protected names(job: JobSummaryDto) {
    return jobNames(job, this.i18n.language());
  }

  protected stage(job: JobSummaryDto) {
    return jobStage(job);
  }

  protected open(job: JobSummaryDto) {
    void this.overlays.open<void, { id: string }>(JobSteps, {
      data: { id: job.id },
      shape: 'drawer',
      title: 'garage.jobs.panel.title',
    });
  }
}
