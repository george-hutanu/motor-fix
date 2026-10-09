import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';

import { garageOf, Session } from '../session';
import type { Area, DashboardView } from '../views';

// Every view's body until the epic that owns the view builds it: what will
// appear there, or, on the dashboard of a garage still under review, that.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-dashboard-view',
  templateUrl: './view.html',
})
export class View {
  private readonly session = inject(Session);
  private readonly data = toSignal(inject(ActivatedRoute).data, {
    initialValue: {},
  });
  protected readonly text = computed(() => {
    const { area, view } = this.data() as { area?: Area; view?: DashboardView };
    const checking =
      area === 'garage' &&
      view?.path === '' &&
      garageOf(this.session.shown())?.status === 'draft';
    return checking
      ? 'shell.frame.verification'
      : (view?.empty ?? 'shell.frame.empty');
  });
}
