import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { JobSteps } from '../job-steps/job-steps';
import { JOB_KINDS, jobNames, jobStage, jobWhen, todayOrLive } from '../jobs';
import { liveResource } from '../live';

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

  protected when(job: JobSummaryDto) {
    return jobWhen(job, this.i18n.language());
  }

  // Nothing booked for today and nothing still in work.
  protected noneToday(items: readonly JobSummaryDto[]) {
    return !items.some((job) => todayOrLive(job));
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
