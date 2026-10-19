import { Component, computed, inject } from '@angular/core';
import { AdminService, type RecheckDueRowDto } from '@motor-fix/data-access';
import { formatDay, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Panel } from '@motor-fix/ui-cockpit';

import {
  AdminRecheckForm,
  type AdminRecheckFormData,
} from '../admin-recheck-form/admin-recheck-form';
import { liveResource } from '../live';

const SKELETON_ROWS = [0, 1, 2];
const DASH = '—';

// "Reverificări RAR": the published garages due their monthly look-up in the
// RAR register, the oldest check first, each recorded from its row. Another
// admin's record, a suspension or a restore re-reads it.
@Component({
  imports: [Panel, TranslatePipe],
  selector: 'mf-admin-rechecks',
  styleUrl: './admin-rechecks.css',
  templateUrl: './admin-rechecks.html',
})
export class AdminRechecks {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly list = liveResource(
    () => this.api.recheckControllerDue(),
    ['recheck.recorded', 'garage.suspended', 'garage.restored'],
  );

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly state = computed(() => {
    if (this.list.value()) return 'ready';
    return this.list.failed() ? 'failed' : 'loading';
  });

  protected readonly heading = computed(() => {
    const name = this.i18n.t('admin.rechecks.heading');
    const count = this.list.value()?.items.length;
    // No-break spaces keep the count on the name's line on a 320 px phone.
    return count ? `${name} · ${formatNum(count, this.i18n.language())}` : name;
  });

  protected readonly rows = computed(() =>
    (this.list.value()?.items ?? []).map((row) => this.row(row)),
  );

  retry() {
    this.list.reload();
  }

  async record(row: RecheckDueRowDto) {
    const today = this.list.value()?.today;
    if (!today) return;
    const answer = await this.overlays.open<'recorded', AdminRecheckFormData>(
      AdminRecheckForm,
      {
        data: { row, stale: () => this.list.reload(), today },
        shape: 'dialog',
        title: 'admin.rechecks.dialog',
      },
    );
    if (answer === 'recorded') this.list.reload();
  }

  private row(row: RecheckDueRowDto) {
    const language = this.i18n.language();
    const days = row.daysSince;
    return {
      checked: row.lastCheckedOn
        ? formatDay(row.lastCheckedOn, language)
        : DASH,
      days:
        days === null
          ? DASH
          : this.i18n.t('admin.rechecks.days', {
              count: days,
              n: formatNum(days, language),
            }),
      id: row.garageId,
      name: row.name,
      named: this.i18n.t('admin.rechecks.recordNamed', { name: row.name }),
      number: row.rarNumber ?? DASH,
      overdue: row.overdue,
      source: row,
    };
  }

  constructor() {
    void this.i18n.enter('admin');
  }
}
