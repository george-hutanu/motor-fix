import { Component, input } from '@angular/core';
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

  // Once the tab is marked current; `nearest` keeps the page itself still.
  // `scrollIntoView` is absent on the server and in jsdom.
  protected reveal(tab: HTMLElement) {
    tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}
