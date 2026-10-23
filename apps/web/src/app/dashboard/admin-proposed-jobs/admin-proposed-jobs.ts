import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  type AdminCatalogueJobDto,
  AdminService,
  type CatalogueJobDecisionDto,
} from '@motor-fix/data-access';
import { formatDay, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import { liveResource } from '../live';
import {
  ProposedJobApprove,
  type ProposedJobApproveData,
} from '../proposed-job-approve/proposed-job-approve';
import {
  type ProposedJobDecided,
  ProposedJobReject,
  type ProposedJobRejectData,
} from '../proposed-job-reject/proposed-job-reject';

const SKELETON_ROWS = [0, 1, 2];
// A proposal whose garage is gone since.
const NO_GARAGE = '—';

// "Lucrări propuse": the jobs garages proposed that wait for an admin, oldest
// first, read again whenever one is proposed or decided. Each row opens the
// approve or the reject dialog, which sends the decision itself; a decided
// row leaves the list at once and the live re-read confirms it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, Panel, TranslatePipe],
  selector: 'mf-admin-proposed-jobs',
  styleUrl: './admin-proposed-jobs.css',
  templateUrl: './admin-proposed-jobs.html',
})
export class AdminProposedJobs {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  protected readonly queue = liveResource(
    () => this.api.jobDecisionsControllerQueue(),
    ['catalogue_job.proposed', 'catalogue_job.decided'],
  );
  protected readonly skeletonRows = SKELETON_ROWS;
  // Jobs decided here: a decision never returns a job to the queue.
  private readonly decided = signal<ReadonlySet<string>>(new Set());

  protected readonly state = computed(() => {
    if (this.queue.value()) return 'ready';
    return this.queue.failed() ? 'failed' : 'loading';
  });

  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    const decided = this.decided();
    return (this.queue.value()?.items ?? [])
      .filter((job) => !decided.has(job.id))
      .map((job) => ({
        day: formatDay(job.proposedAt, language),
        garage: job.garage?.name ?? NO_GARAGE,
        id: job.id,
        interval: this.interval(job),
        job,
      }));
  });

  constructor() {
    void this.i18n.enter('admin');
  }

  // "{from} – {to} lei · {min} min", a missing end or duration left out.
  private interval({
    durationMinutes,
    fromBani,
    toBani,
  }: AdminCatalogueJobDto) {
    const language = this.i18n.language();
    const lei = (bani: number) => formatNum(Math.round(bani / 100), language);
    const t = (key: string, params: Record<string, string>) =>
      this.i18n.t(`admin.proposedJobs.${key}`, params);
    const range =
      fromBani === undefined
        ? undefined
        : toBani === undefined
          ? t('rangeFrom', { from: lei(fromBani) })
          : t('range', { from: lei(fromBani), to: lei(toBani) });
    const time =
      durationMinutes === undefined
        ? undefined
        : t('minutes', { n: formatNum(durationMinutes, language) });
    return [range, time].filter(Boolean).join(' · ');
  }

  protected approve(job: AdminCatalogueJobDto) {
    void this.once(() =>
      this.overlays.open<ProposedJobDecided, ProposedJobApproveData>(
        ProposedJobApprove,
        {
          data: { job, rarActivities: this.queue.value()?.rarActivities ?? [] },
          shape: 'dialog',
          title: 'admin.proposedJobs.approve.title',
          titleParams: { name: job.name },
        },
      ),
    );
  }

  protected reject(job: AdminCatalogueJobDto) {
    void this.once(() =>
      this.overlays.open<ProposedJobDecided, ProposedJobRejectData>(
        ProposedJobReject,
        {
          data: { job },
          shape: 'dialog',
          title: 'admin.proposedJobs.reject.title',
          titleParams: { name: job.name },
        },
      ),
    );
  }

  // One dialog at a time: a second press while one is open is ignored.
  private opened = false;

  private async once(dialog: () => Promise<ProposedJobDecided>) {
    if (this.opened) return;
    this.opened = true;
    try {
      const result = await dialog();
      if (result === 'cancelled') return;
      // Decided here, or by another admin first: either way it is gone.
      if (result !== 'decided') this.drop(result);
      this.queue.reload();
    } finally {
      this.opened = false;
    }
  }

  private drop({ id }: CatalogueJobDecisionDto) {
    this.decided.update((ids) => new Set(ids).add(id));
  }

  protected retry() {
    this.queue.reload();
  }
}
