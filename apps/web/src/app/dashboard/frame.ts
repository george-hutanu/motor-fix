import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  type OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import {
  AsWritten,
  ClockPipe,
  I18n,
  LanguageSwitch,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmToaster, toast } from '@motor-fix/ui-cockpit';
import { filter, map } from 'rxjs';

import { EmailBanner } from './email-banner';
import { Live } from './live';
import { LiveChange } from './live-in-place';
import { Session } from './session';
import { SignOutEverywhere } from './sign-out-everywhere';
import { DashboardTabBar } from './tab-bar';
import { type Area, allowedViews, DASHBOARDS } from './views';
import { segmentsOf } from '../addresses';

type Role = MeDto['role'];

// The chips' order, whatever order the account holds its roles in.
const ROLES: readonly { role: Role; label: string }[] = [
  { label: 'shell.frame.roles.driver', role: 'driver' },
  { label: 'shell.frame.roles.garage', role: 'garage' },
  { label: 'shell.frame.roles.receptionist', role: 'receptionist' },
  { label: 'shell.frame.roles.mechanic', role: 'mechanic' },
  { label: 'shell.frame.roles.admin', role: 'admin' },
];

// Below 768 px the bar replaces the menu; the rest of the aside (logo, area,
// name, the two sign-outs) stays on top as the account band.
@Component({
  imports: [
    AsWritten,
    ClockPipe,
    DashboardTabBar,
    EmailBanner,
    HlmToaster,
    LanguageSwitch,
    LiveChange,
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
    aside nav a[aria-current="page"] { color: var(--mf-amber-ink); }
    .account { margin-top: auto; display: flex; flex-direction: column; gap: 0.25rem; }
    .roles { display: flex; flex-wrap: wrap; gap: var(--mf-space-2); margin-bottom: var(--mf-space-2); }
    .roles button {
      min-height: var(--mf-tap); padding: 0 var(--mf-space-3);
      border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-chip);
      background: transparent; color: var(--mf-text-secondary);
      font: inherit; font-size: var(--mf-size-small); cursor: pointer;
    }
    .roles button[aria-pressed="true"] { border-color: var(--mf-amber); color: var(--mf-amber-ink); cursor: default; }
    .roles button:disabled { cursor: progress; }
    .view { display: flex; flex-direction: column; min-width: 0; }
    main { flex: 1 0 auto; }
    .live-status { margin: 0; padding: var(--mf-space-2) var(--mf-space-3); color: var(--mf-text-secondary); font-size: var(--mf-size-small); }
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
            routerLinkActive=""
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: !view.path }"
          >{{ view.label | t }}</a>
        }
      </nav>
      <div class="account">
        @if (roles().length > 1) {
          <div class="roles" role="group" [attr.aria-label]="'shell.frame.roles.label' | t">
            @for (chip of roles(); track chip.role) {
              <button
                type="button"
                [attr.aria-pressed]="chip.role === session.current()?.role"
                [disabled]="switching()"
                (click)="switchTo(chip.role)"
              >{{ chip.label | t }}</button>
            }
          </div>
        }
        <mf-as-written [text]="session.current()?.name ?? ''" />
        <button type="button" (click)="signOut()">{{ 'shell.frame.signOut' | t }}</button>
        <button type="button" (click)="signOutEverywhere()">{{ 'shell.frame.signOutEverywhere' | t }}</button>
      </div>
    </aside>
    <div class="view">
      <header><h1>{{ open().label | t }}</h1><mf-language-switch /></header>
      <mf-email-banner />
      @if (lastTest(); as at) {
        <p class="live-status" role="status" [mfLiveChange]="at">{{ 'shell.live.test' | t }} · {{ at | clock }}</p>
      }
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
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly base = computed(
    () => this.session.current()?.landing ?? '/app/driver',
  );
  // The area guard admits only a landing of one of the three dashboards.
  private readonly area = computed(
    () => this.base().slice('/app/'.length) as Area,
  );
  protected readonly dashboard = computed(() => DASHBOARDS[this.area()]);
  protected readonly roles = computed(() => {
    const held = this.session.current()?.roles ?? [];
    return ROLES.filter(({ role }) => held.includes(role));
  });
  protected readonly switching = signal(false);
  // When the epic's test update last arrived: it changes this line in place.
  protected readonly lastTest = signal<string | null>(null);
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
        if (message.kind === 'live.test') this.lastTest.set(message.at);
        if (message.kind === 'account.email_confirmed') {
          void this.session.reload();
        }
        // Signed out on all devices, from this one or another.
        if (message.kind === 'session.revoked') void this.signOut();
      });
    // Signed out in another tab of this browser.
    this.session.ended
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.live.close();
        void this.router.navigateByUrl('/');
      });
    this.live.open();
    this.destroyRef.onDestroy(() => this.live.close());
  }

  // The effect above opens the new role's dashboard once the account reloads;
  // the live connection reopens to join that role's channels.
  protected async switchTo(role: Role) {
    if (this.switching() || role === this.session.current()?.role) return;
    this.switching.set(true);
    try {
      if (await this.session.switchRole(role)) {
        this.live.close();
        this.live.open();
      }
    } catch {
      toast(this.i18n.t('shell.frame.roles.failed'));
    } finally {
      this.switching.set(false);
    }
  }

  protected async signOut() {
    this.live.close();
    await this.session.signOut();
    await this.router.navigateByUrl('/');
  }

  protected async signOutEverywhere() {
    const answer = await this.overlays.open<boolean>(SignOutEverywhere, {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
    if (answer !== true) return;
    this.live.close();
    await this.session.signOutEverywhere();
    await this.router.navigateByUrl('/');
  }
}
