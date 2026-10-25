import {
  afterNextRender,
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';

import type { Counts, DashboardView } from '../views';

// The dashboards' menu on a phone; from 768 px the side menu takes over.
@Component({
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  selector: 'mf-dashboard-tab-bar',
  styleUrl: './tab-bar.css',
  templateUrl: './tab-bar.html',
})
export class DashboardTabBar {
  readonly base = input.required<string>();
  readonly views = input.required<readonly DashboardView[]>();
  // A translation key: the dashboard's name, for the landmark.
  readonly name = input.required<string>();
  readonly counts = input<Counts>({});
  // The counts' first read is on its way.
  readonly countsLoading = input(false);
  // An entry that opens a task over the view, not a page.
  readonly act = output<DashboardView>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Tabs that arrive after the current one was marked (a garage's feature
    // switches, the counts' chips) can push it out of sight: reveal it again.
    afterRenderEffect(() => {
      this.views();
      this.counts();
      const tab = this.host.nativeElement.querySelector<HTMLElement>(
        'a[aria-current="page"]',
      );
      if (tab) this.reveal(tab);
    });
    // A phone turned sideways and back leaves the bar scrolled where the
    // wide screen clamped it, so a change of width reveals the current tab
    // again. Height alone (the browser's address bar) leaves it be.
    afterNextRender(() => {
      const nav = this.host.nativeElement.querySelector('nav');
      if (!nav || typeof ResizeObserver === 'undefined') return;
      let width: number | undefined;
      const observer = new ResizeObserver(([entry]) => {
        const next = entry.contentRect.width;
        const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (width !== undefined && next > 0 && next !== width && current) {
          this.reveal(current);
        }
        width = next;
      });
      observer.observe(nav);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  // Once the tab is marked current; `nearest` keeps the page itself still.
  // `scrollIntoView` is absent on the server and in jsdom.
  protected reveal(tab: HTMLElement) {
    tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}
