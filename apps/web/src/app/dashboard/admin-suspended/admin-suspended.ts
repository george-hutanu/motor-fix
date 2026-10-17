import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  VERIFICATION_QUEUE_MAX,
  VERIFICATION_QUEUE_PAGE,
} from '@motor-fix/contracts/verification-target';
import {
  type AdminGaragesDto,
  AdminService,
  type SuspendedGarageRowDto,
} from '@motor-fix/data-access';
import { formatDay, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, Panel } from '@motor-fix/ui-cockpit';

import { GARAGES_KINDS } from '../admin-garages/kinds';
import { liveResource } from '../live';

const SKELETON_ROWS = [0, 1, 2];

// "Service-uri suspendate": every suspended garage, the most recent
// suspension first, with why and since when; a page more at each press, as
// one read of every row shown, the way the queue above it reads.
@Component({
  imports: [Lamp, Panel, RouterLink, TranslatePipe],
  selector: 'mf-admin-suspended',
  styleUrl: './admin-suspended.css',
  templateUrl: './admin-suspended.html',
})
export class AdminSuspended {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly pages = signal(1);
  private readonly list = liveResource(
    () => this.read(this.pages() * VERIFICATION_QUEUE_PAGE),
    GARAGES_KINDS,
  );

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly state = computed(() => {
    if (this.list.value()) return 'ready';
    return this.list.failed() ? 'failed' : 'loading';
  });
  // A failed re-read keeps the rows and the total it read last.
  protected readonly stale = computed(
    () => this.list.failed() && this.list.value() !== undefined,
  );

  protected readonly heading = computed(() => {
    const total = this.list.value()?.total;
    const name = this.t('suspended.heading');
    if (total === undefined) return name;
    const count = `${name} · ${formatNum(total, this.i18n.language())}`;
    return this.stale() ? `${count} ${this.t('queue.stale')}` : count;
  });

  protected readonly rows = computed(() =>
    (this.list.value()?.items ?? []).map((row) => this.row(row)),
  );

  protected readonly more = computed(() => {
    const value = this.list.value();
    return value ? value.total > value.items.length : false;
  });

  showMore() {
    this.pages.update((n) => n + 1);
    this.list.reload();
  }

  retry() {
    this.list.reload();
  }

  // Every row shown, from offset 0, in reads of at most VERIFICATION_QUEUE_MAX
  // rows; a garage that moved between two reads is kept once.
  private async read(wanted: number): Promise<AdminGaragesDto> {
    const reads: Promise<AdminGaragesDto>[] = [];
    for (let offset = 0; offset < wanted; offset += VERIFICATION_QUEUE_MAX) {
      const limit = Math.min(VERIFICATION_QUEUE_MAX, wanted - offset);
      reads.push(
        this.api.adminOverviewControllerGarages({
          limit,
          offset,
          status: 'suspended',
        }),
      );
    }
    const answers = await Promise.all(reads);
    const seen = new Set<string>();
    const items = answers
      .flatMap((answer) => answer.items)
      .filter((row) => !seen.has(row.id) && seen.add(row.id));
    return { items, total: answers[0]?.total ?? items.length };
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.${key}`, params);
  }

  private stateText(row: SuspendedGarageRowDto) {
    if (!row.cause) return this.t('suspended.alone');
    const text =
      row.cause === 'recheck_failed'
        ? this.t(`suspended.rar.${row.rarVerdict ?? 'none'}`)
        : this.t(`suspended.cause.${row.cause}`);
    return this.t('suspended.state', { text });
  }

  private row(row: SuspendedGarageRowDto) {
    const language = this.i18n.language();
    const cancelled = row.cancelledBookings;
    return {
      area:
        row.area?.kind === 'mobile'
          ? this.t('queue.mobile', {
              km: formatNum(row.area.radiusKm, language),
            })
          : row.area?.name,
      cancelled:
        cancelled === undefined
          ? undefined
          : this.t('suspended.cancelled', {
              count: cancelled,
              n: formatNum(cancelled, language),
            }),
      id: row.id,
      link: row.fileId ? ['/app/admin/garages', row.fileId] : undefined,
      name: row.name,
      open: this.t('queue.openNamed', { name: row.name }),
      reason: row.reason,
      since: row.fromTime
        ? this.t('suspended.since', { date: formatDay(row.fromTime, language) })
        : undefined,
      state: this.stateText(row),
    };
  }

  constructor() {
    void this.i18n.enter('admin');
  }
}
