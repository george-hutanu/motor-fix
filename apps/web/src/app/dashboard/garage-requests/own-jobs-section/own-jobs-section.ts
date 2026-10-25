import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { JobSteps } from '../../job-steps/job-steps';
import {
  JOB_KINDS,
  jobNames,
  jobStage,
  jobWhen,
  todayOrLive,
} from '../../jobs';
import { liveResource } from '../../live';

// A mechanic's own jobs on Panou: today's, and those still in work from an
// earlier day, by start; the next booking and the day's load above them, and
// whatever the page puts in it (her day-sheet link) above all. The
// list API already narrows a mechanic to her own jobs. A row opens the job's
// steps as Lucrări does; a booking confirmed, moved or cancelled re-reads.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-own-jobs-section',
  styleUrl: './own-jobs-section.css',
  templateUrl: './own-jobs-section.html',
})
export class OwnJobsSection {
  private readonly api = inject(GarageJobsService);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  protected readonly skeletons = [1, 2, 3];
  protected readonly view = liveResource(
    () => this.api.garageJobsControllerList({}),
    [...JOB_KINDS, 'booking.confirmed', 'booking.moved', 'booking.cancelled'],
  );
  // A cancelled booking is no work of her day.
  protected readonly rows = computed(() =>
    (this.view.value()?.items ?? [])
      .filter((job) => job.status !== 'cancelled' && todayOrLive(job))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  );
  // The earliest job still to start, done and cancelled ones aside.
  protected readonly next = computed(() => {
    const now = Date.now();
    return (this.view.value()?.items ?? [])
      .filter(
        (job) =>
          job.status !== 'done' &&
          job.status !== 'cancelled' &&
          new Date(job.startsAt).getTime() > now,
      )
      .reduce<JobSummaryDto | null>(
        (first, job) => (!first || job.startsAt < first.startsAt ? job : first),
        null,
      );
  });
  protected readonly load = computed(() => {
    const rows = this.rows();
    const done = rows.filter((job) => job.status === 'done').length;
    return [
      this.i18n.t('garage.home.ownJobs.load.jobs', { count: rows.length }),
      this.i18n.t('garage.home.ownJobs.load.done', { count: done }),
    ].join(' · ');
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  protected car(job: JobSummaryDto) {
    return `${job.car.brand} ${job.car.model}`;
  }

  protected nextLine(job: JobSummaryDto) {
    return this.i18n.t('garage.home.ownJobs.next', {
      car: this.car(job),
      when: jobWhen(job, this.i18n.language()),
    });
  }

  protected line(job: JobSummaryDto) {
    return [
      jobWhen(job, this.i18n.language()),
      this.car(job),
      job.car.plate,
      jobNames(job, this.i18n.language()),
      this.i18n.t(jobStage(job)),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected open(job: JobSummaryDto) {
    void this.overlays.open<void, { id: string }>(JobSteps, {
      data: { id: job.id },
      shape: 'drawer',
      title: 'garage.jobs.panel.title',
    });
  }
}
