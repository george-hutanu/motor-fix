import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { EmptyState } from '../empty-state/empty-state';
import type { Area, DashboardView } from '../views';

// Every view's body until the epic that owns the view builds it: what will
// appear there, or the view's own empty state, when its story has given it one.
@Component({
  imports: [EmptyState, TranslatePipe],
  selector: 'mf-dashboard-view',
  styleUrl: './view.css',
  templateUrl: './view.html',
})
export class View {
  private readonly i18n = inject(I18n);
  private readonly data = toSignal(inject(ActivatedRoute).data, {
    initialValue: {},
  });
  protected readonly state = computed(
    () => (this.data() as { view?: DashboardView }).view?.emptyState,
  );
  protected readonly text = computed(
    () =>
      (this.data() as { view?: DashboardView }).view?.empty ??
      'shell.frame.empty',
  );

  constructor() {
    // An empty state's text is one of its area's.
    effect(() => {
      const { area } = this.data() as { area?: Area };
      if (this.state() && area) void this.i18n.enter(area);
    });
  }
}
