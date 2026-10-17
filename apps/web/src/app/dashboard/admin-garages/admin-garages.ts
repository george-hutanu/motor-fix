import { Component, computed, inject, signal } from '@angular/core';
import { AdminService } from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';

import { GARAGES_KINDS } from './kinds';
import { AdminQueue } from '../admin-queue/admin-queue';
import { AdminSuspended } from '../admin-suspended/admin-suspended';
import { liveResource } from '../live';

// The admin's "Service-uri" view: the counts line, the files waiting for
// verification, then the suspended garages.
@Component({
  imports: [AdminQueue, AdminSuspended, TranslatePipe],
  selector: 'mf-admin-garages',
  styleUrl: './admin-garages.css',
  templateUrl: './admin-garages.html',
})
export class AdminGarages {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly summary = liveResource(
    () => this.api.adminOverviewControllerGaragesSummary(),
    GARAGES_KINDS,
  );

  protected readonly tip = signal(false);
  // A failed read, first or again, shows the dash, never the last figures.
  protected readonly state = computed(() => {
    if (this.summary.failed()) return 'failed';
    return this.summary.value() ? 'ready' : 'loading';
  });
  protected readonly counts = computed(() => {
    const figures = this.summary.value();
    if (!figures) return '';
    const language = this.i18n.language();
    return (['listed', 'waiting', 'suspended'] as const)
      .map((key) =>
        this.i18n.t(`admin.garages.${key}`, {
          count: figures[key],
          n: formatNum(figures[key], language),
        }),
      )
      .join(' · ');
  });

  constructor() {
    void this.i18n.enter('admin');
  }
}
