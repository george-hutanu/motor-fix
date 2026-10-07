import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';

import type { Counts, DashboardView } from './views';

// The dashboards' menu on a phone; from 768 px the side menu takes over.
@Component({
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  selector: 'mf-dashboard-tab-bar',
  styles: `
    :host {
      display: block;
      position: sticky;
      bottom: 0;
      z-index: 10;
      border-top: 1px solid var(--mf-line);
      background: color-mix(in srgb, var(--mf-bg) 74%, transparent);
      -webkit-backdrop-filter: saturate(160%) blur(18px);
      backdrop-filter: saturate(160%) blur(18px);
    }
    @media (min-width: 768px) { :host { display: none; } }
    @media (prefers-reduced-transparency: reduce) {
      :host { background: var(--mf-bg); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    nav {
      display: flex;
      overflow-x: auto;
      padding: 6px 8px max(14px, var(--mf-safe-bottom));
    }
    a {
      display: flex;
      flex: 1 0 auto;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 66px;
      min-height: 48px;
      padding: 0 6px;
      color: var(--mf-text-secondary);
      font-size: var(--mf-size-label);
      font-weight: 700;
      line-height: 1.15;
      text-decoration: none;
      white-space: nowrap;
    }
    .marker { width: 18px; height: 3px; border-radius: 2px; background: var(--mf-line); }
    .name { display: inline-flex; align-items: center; gap: 4px; }
    .chip {
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
      background: var(--mf-amber); color: var(--mf-on-amber);
      font-size: var(--mf-size-label); line-height: 18px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    a[aria-current="page"] { color: var(--mf-amber-ink); }
    a[aria-current="page"] .marker { background: var(--mf-amber-ink); }
  `,
  template: `
    <nav [attr.aria-label]="name() | t">
      @for (view of views(); track view.path) {
        @let count = view.counter ? counts()[view.counter] : undefined;
        <a
          #tab
          [routerLink]="view.path ? [base(), view.path] : base()"
          routerLinkActive=""
          ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: !view.path }"
          (isActiveChange)="$event && reveal(tab)"
          [attr.aria-label]="count ? ('shell.frame.counter' | t: { label: (view.tab | t), waiting: count }) : null"
        ><span class="marker" aria-hidden="true"></span><span class="name"><span class="label">{{ view.tab | t }}</span>@if (count) {<span class="chip" aria-hidden="true">{{ count > 99 ? '99+' : count }}</span>}</span></a>
      }
    </nav>
  `,
})
export class DashboardTabBar {
  readonly base = input.required<string>();
  readonly views = input.required<readonly DashboardView[]>();
  // A translation key: the dashboard's name, for the landmark.
  readonly name = input.required<string>();
  readonly counts = input<Counts>({});

  // Once the tab is marked current; `nearest` keeps the page itself still.
  // `scrollIntoView` is absent on the server and in jsdom.
  protected reveal(tab: HTMLElement) {
    tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}
