import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  type OnInit,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  type UrlTree,
} from '@angular/router';
import {
  AsWritten,
  I18n,
  LanguageSwitch,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmToaster, toast } from '@motor-fix/ui-cockpit';
import { filter, map } from 'rxjs';

import { Live } from './live';
import { Session } from './session';
import { DashboardTabBar } from './tab-bar';
import { type Area, allowedViews, DASHBOARDS } from './views';

const segmentsOf = (tree: UrlTree) =>
  tree.root.children[PRIMARY_OUTLET]?.segments.map((s) => s.path) ?? [];

// Below 768 px the bar replaces the menu; the rest of the aside (logo, area,
// name, sign out) stays on top as the account band.
@Component({
  imports: [
    AsWritten,
    DashboardTabBar,
    HlmToaster,
    LanguageSwitch,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  selector: 'mf-frame',
  styles: `
    :host { display: grid; grid-template: auto 1fr / minmax(0, 1fr); min-height: 100dvh; }
    aside { display: flex; flex-direction: column; gap: 1.25rem; padding: 1rem; }
    aside nav { display: none; flex-direction: column; gap: 0.25rem; }
    .account { margin-top: auto; display: flex; flex-direction: column; gap: 0.25rem; }
    .view { display: flex; flex-direction: column; min-width: 0; }
    main { flex: 1 0 auto; }
    @media (min-width: 768px) {
      :host { grid-template: 1fr / minmax(0, 16rem) minmax(0, 1fr); }
      aside nav { display: flex; }
    }
  `,
  template: `
    <aside>
      <a routerLink="/" [attr.aria-label]="'shell.frame.home' | t">{{ 'shell.frame.logo' | t }}</a>
      <span>{{ dashboard().tag | t }}</span>
      <nav [attr.aria-label]="'shell.frame.menu' | t">
        @for (view of entries(); track view.path) {
          <a
            [routerLink]="view.path ? [base(), view.path] : base()"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: !view.path }"
          >{{ view.label | t }}</a>
        }
      </nav>
      <div class="account">
        <mf-as-written [text]="session.current()?.name ?? ''" />
        <button type="button" (click)="signOut()">{{ 'shell.frame.signOut' | t }}</button>
      </div>
    </aside>
    <div class="view">
      <header><h1>{{ open().label | t }}</h1><mf-language-switch /></header>
      <main><router-outlet /></main>
      <mf-dashboard-tab-bar [base]="base()" [views]="entries()" [name]="dashboard().name" />
    </div>
    <hlm-toaster />
  `,
})
export class Frame implements OnInit {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly base = computed(
    () => this.session.current()?.landing ?? '/app/driver',
  );
  private readonly area = computed(
    () => this.base().slice('/app/'.length) as Area,
  );
  protected readonly dashboard = computed(() => DASHBOARDS[this.area()]);
  protected readonly entries = computed(() =>
    allowedViews(this.area(), this.session.current()?.capabilities ?? []),
  );
  // ['app', <area>, <view>?, …] of the address on screen.
  private readonly segments = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(({ urlAfterRedirects }) =>
        segmentsOf(this.router.parseUrl(urlAfterRedirects)),
      ),
    ),
    // Created while its own navigation runs: router.url is still the old one.
    {
      initialValue: segmentsOf(
        this.router.currentNavigation()?.finalUrl ??
          this.router.parseUrl(this.router.url),
      ),
    },
  );
  protected readonly open = computed(
    () =>
      this.entries().find((view) => view.path === (this.segments()[2] ?? '')) ??
      this.dashboard().views[0],
  );

  constructor() {
    // A role switch or a lost right moves the person off a view they may no
    // longer open; signed out, sign-out itself decides where to go.
    effect(() => {
      if (!this.session.current()) return;
      const [, area, view] = this.segments();
      const off =
        `/app/${area}` !== this.base() ||
        (view !== undefined && !this.entries().some((v) => v.path === view));
      if (off) untracked(() => void this.router.navigateByUrl(this.base()));
    });
  }

  // The frame holds the tab's live connection for as long as it is shown.
  ngOnInit() {
    this.live.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((message) => {
        if (message.kind === 'live.test') toast(this.i18n.t('shell.live.test'));
      });
    this.live.open();
    this.destroyRef.onDestroy(() => this.live.close());
  }

  protected async signOut() {
    this.live.close();
    await this.session.signOut();
    await this.router.navigateByUrl('/');
  }
}
