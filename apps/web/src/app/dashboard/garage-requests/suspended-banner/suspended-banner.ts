import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { garageOf, Session } from '../../session';

// The step that lifts a suspension, by its cause: an admin's or a report's
// decision is answered to the team.
const NEXT: Readonly<Record<string, string>> = {
  documents_overdue: 'garage.suspended.next.documents_overdue',
  recheck_failed: 'garage.suspended.next.recheck_failed',
};

// Shown above the garage's overview while the garage is suspended: why it is
// off the map and what the owner does next.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-suspended-banner',
  styleUrl: './suspended-banner.css',
  templateUrl: './suspended-banner.html',
})
export class SuspendedBanner {
  private readonly session = inject(Session);
  protected readonly suspension = computed(() => {
    const garage = garageOf(this.session.shown());
    return garage?.status === 'suspended' ? (garage.suspension ?? null) : null;
  });
  protected readonly next = computed(() => {
    const cause = this.suspension()?.cause ?? '';
    return NEXT[cause] ?? 'garage.suspended.next.team';
  });

  constructor() {
    void inject(I18n).enter('garage');
  }
}
