import { computed, Injectable, inject } from '@angular/core';
import { AdminService } from '@motor-fix/data-access';

import { liveResource } from './live';

// The admin header's, menu's and panel's numbers, kept current by the files'
// events.
@Injectable()
export class AdminOverview {
  private readonly api = inject(AdminService);
  private readonly overview = liveResource(
    () => this.api.adminOverviewControllerOverview(),
    ['verification.submitted', 'verification.decided', 'verification.reopened'],
  );

  readonly loading = this.overview.isLoading;
  readonly failed = this.overview.failed;
  // A count that may be stale is not shown: no number beats a wrong one.
  readonly waiting = computed(() =>
    this.failed() ? undefined : this.overview.value()?.garagesWaiting,
  );
  readonly figures = computed(() => {
    const value = this.overview.value();
    if (this.failed() || !value) return undefined;
    const {
      activeDrivers,
      activeDriversMonthStart,
      garagesApprovedThisMonth,
      garagesListed,
      observabilityUrl,
    } = value;
    return {
      activeDrivers,
      activeDriversMonthStart,
      garagesApprovedThisMonth,
      garagesListed,
      observabilityUrl,
    };
  });
}
