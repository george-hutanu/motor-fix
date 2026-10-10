import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { EmptyState } from '../empty-state/empty-state';
import { garageOf, Session } from '../session';
import type { Area, DashboardView } from '../views';

// Every view's body until the epic that owns the view builds it: what will
// appear there, or, on the dashboard of a garage still under review, that;
// or the view's own empty state, when its story has given it one.
@Component({
  imports: [EmptyState, HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-dashboard-view',
  styleUrl: './view.css',
  templateUrl: './view.html',
})
export class View {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;
  private readonly data = toSignal(inject(ActivatedRoute).data, {
    initialValue: {},
  });
  protected readonly state = computed(
    () => (this.data() as { view?: DashboardView }).view?.emptyState,
  );
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

  constructor() {
    // An empty state's text is one of its area's.
    effect(() => {
      const { area } = this.data() as { area?: Area };
      if (this.state() && area) void this.i18n.enter(area);
    });
  }
}
