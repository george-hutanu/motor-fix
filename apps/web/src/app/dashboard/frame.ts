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
import type { CarDto, MeDto } from '@motor-fix/data-access';
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

import { AddCar } from './add-car/add-car';
import { AdminOverview } from './admin-overview';
import { Bell } from './bell';
import { EmailBanner } from './email-banner';
import { initials } from './initials';
import { InviteStaff } from './invite-staff';
import { Live } from './live';
import { LiveChange } from './live-in-place';
import { PushDevice } from './push-device';
import { Session } from './session';
import { SignOutEverywhere } from './sign-out-everywhere';
import { DashboardTabBar } from './tab-bar';
import { type Area, allowedViews, type Counts, DASHBOARDS } from './views';
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
    Bell,
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
  providers: [AdminOverview],
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
    header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mf-space-3); }
    header h1 { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .title { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; padding-top: var(--mf-space-3); }
    .admin-label, .eyebrow { color: var(--mf-text-secondary); font-size: var(--mf-size-label); font-weight: 700; letter-spacing: 0.08em; }
    .admin-line, .line { margin: 0; color: var(--mf-text-secondary); font-size: var(--mf-size-small); overflow-wrap: anywhere; }
    .who { display: flex; align-items: center; gap: var(--mf-space-2); min-width: 0; overflow-wrap: anywhere; }
    .avatar {
      display: inline-flex; flex: none; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 50%; background: var(--mf-line);
      color: var(--mf-text-secondary); font-size: var(--mf-size-label); font-weight: 700;
    }
    .skeleton { display: inline-block; width: 12rem; max-width: 50%; height: 0.9em; border-radius: var(--mf-radius-chip); background: var(--mf-line); vertical-align: middle; }
    aside nav a { display: flex; align-items: center; gap: var(--mf-space-2); }
    .chip {
      min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
      background: var(--mf-amber); color: var(--mf-on-amber);
      font-size: var(--mf-size-label); font-weight: 700; line-height: 20px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    main { flex: 1 0 auto; }
    .chip-skeleton { width: 20px; height: 20px; border-radius: 10px; background: var(--mf-line); }
    .live-offline:empty { display: none; }
    .live-offline {
      margin: 0 0 var(--mf-space-3); padding: var(--mf-space-2) var(--mf-space-4);
      border-block: 1px solid var(--mf-amber-ink);
      color: var(--mf-text-secondary); font-size: var(--mf-size-small); overflow-wrap: anywhere;
    }
    .live-status { margin: var(--mf-space-2) 0 0; padding: 0; color: var(--mf-text-secondary); font-size: var(--mf-size-small); }
    @media (min-width: 768px) {
      :host { grid-template: 1fr / minmax(0, 16rem) minmax(0, 1fr); }
      aside nav { display: flex; }
    }
  `,
  template: `
    <aside>
      <a routerLink="/" [attr.aria-label]="'shell.frame.home' | t">{{ 'shell.frame.logo' | t }}</a>
      <span class="eyebrow">{{ dashboard().tag | t }}</span>
      <nav [attr.aria-label]="'shell.frame.menu' | t">
        @for (view of entries(); track view.path) {
          @let count = view.counter ? counts()[view.counter] : undefined;
          <a
            [routerLink]="view.path ? [base(), view.path] : base()"
            routerLinkActive=""
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: !view.path }"
            [attr.aria-label]="count ? ('shell.frame.counter' | t: { label: (view.label | t), waiting: count }) : null"
          >{{ view.label | t }}@if (count) {<span class="chip" aria-hidden="true">{{ count > 99 ? '99+' : count }}</span>} @else if (view.counter && countsLoading()) {<span class="chip-skeleton" aria-hidden="true"></span>}</a>
        }
      </nav>
      <div class="account">
        @if (roles().length > 1) {
          <div class="roles" role="group" [attr.aria-label]="'shell.frame.roles.label' | t">
            @for (chip of roles(); track chip.role) {
              <button
                type="button"
                [attr.aria-pressed]="chip.role === session.shown()?.role"
                [disabled]="switching()"
                (click)="switchTo(chip.role)"
              >{{ chip.label | t }}</button>
            }
          </div>
        }
        <div class="who">
          @if (letters(); as l) {<span class="avatar" aria-hidden="true">{{ l }}</span>}
          <mf-as-written [text]="session.shown()?.name ?? ''" />
        </div>
        @if (addsCar()) {
          <button type="button" (click)="addCar()">{{ 'shell.frame.addCar' | t }}</button>
        }
        @if (inviteGarage(); as garageId) {
          <button type="button" (click)="invite(garageId)">{{ 'shell.frame.invite' | t }}</button>
        }
        <button type="button" (click)="signOut()">{{ 'shell.frame.signOut' | t }}</button>
        <button type="button" (click)="signOutEverywhere()">{{ 'shell.frame.signOutEverywhere' | t }}</button>
      </div>
    </aside>
    <div class="view">
      <header>
        @if (adminOverview; as overview) {
          <div class="title">
            <span class="admin-label">{{ 'shell.frame.admin.label' | t }}</span>
            <h1>{{ open().label | t }}</h1>
            <p class="admin-line" [attr.aria-busy]="overview.loading()">
              {{ 'shell.frame.admin.place' | t }}
              @if (overview.loading()) {
                · <span class="skeleton" aria-hidden="true"></span>
              } @else if (overview.waiting(); as count) {
                · {{ 'shell.frame.admin.waiting' | t: { count } }}
              } @else if (overview.waiting() === 0) {
                · {{ 'shell.frame.admin.none' | t }}
              }
            </p>
          </div>
        } @else {
          <div class="title">
            <h1>{{ (open().title ?? open().label) | t }}</h1>
            @if (open().subtitle; as line) {<p class="line">{{ line | t }}</p>}
          </div>
        }
        <mf-language-switch /><mf-bell />
      </header>
      <p class="live-offline" role="status">@if (offline()) { {{ 'shell.live.offline' | t }} }</p>
      <mf-email-banner />
      <p class="live-status" role="status" [mfLiveChange]="lastTest()">
        @if (lastTest(); as at) { {{ 'shell.live.test' | t }} · {{ at | clock }} }
      </p>
      <main><router-outlet /></main>
      <mf-dashboard-tab-bar [base]="base()" [views]="entries()" [name]="dashboard().name" [counts]="counts()" [countsLoading]="countsLoading()" />
    </div>
    <hlm-toaster />
  `,
})
export class Frame implements OnInit {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly live = inject(Live);
  protected readonly offline = this.live.offline;
  private readonly overlays = inject(Overlays);
  private readonly push = inject(PushDevice);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly base = computed(
    () => this.session.shown()?.landing ?? '/app/driver',
  );
  // The area guard admits only a landing of one of the three dashboards.
  private readonly area = computed(
    () => this.base().slice('/app/'.length) as Area,
  );
  protected readonly dashboard = computed(() => DASHBOARDS[this.area()]);
  // Each dashboard has its own frame, so the area at creation is the frame's.
  protected readonly adminOverview =
    this.area() === 'admin' ? inject(AdminOverview) : null;
  protected readonly countsLoading = computed(
    () => this.adminOverview?.loading() ?? false,
  );
  protected readonly counts = computed<Counts>(() => ({
    garagesWaiting: this.adminOverview?.waiting(),
  }));
  protected readonly roles = computed(() => {
    const held = this.session.shown()?.roles ?? [];
    return ROLES.filter(({ role }) => held.includes(role));
  });
  protected readonly switching = signal(false);
  protected readonly letters = computed(() =>
    initials(this.session.shown()?.name ?? ''),
  );
  // A garage account that is not a driver adds its first car from here.
  protected readonly addsCar = computed(() => {
    const me = this.session.shown();
    return me?.role === 'garage' && !me.roles.includes('driver');
  });
  // The owner's garage, while the garage role with the team right is on.
  protected readonly inviteGarage = computed(() => {
    const me = this.session.shown();
    return me?.role === 'garage' && me.capabilities.includes('garage.team')
      ? me.garageId
      : null;
  });
  // When the epic's test update last arrived: it changes this line in place.
  protected readonly lastTest = signal<string | null>(null);
  protected readonly entries = computed(() =>
    allowedViews(this.area(), this.session.shown()?.capabilities ?? []),
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
        // Every session ended (all devices, a password reset), here or elsewhere.
        if (message.kind === 'session.revoked') void this.revoked();
      });
    // The stream may have missed events: read the account again.
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.session.reload());
    // Signed out in another tab of this browser.
    this.session.ended
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.live.close();
        void this.router.navigateByUrl('/');
      });
    // A browser with push on saves its device again.
    void this.push.refresh();
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

  // The saved car made the account a driver: the reload shows its new chip.
  protected async addCar() {
    const car = await this.overlays.open<CarDto, { plates: string[] }>(AddCar, {
      data: { plates: [] },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
    if (car !== 'cancelled') await this.session.reload();
  }

  protected invite(garageId: string) {
    void this.overlays.open<'sent', { garageId: string }>(InviteStaff, {
      data: { garageId },
      shape: 'dialog',
      title: 'garage.invite.title',
    });
  }

  protected async signOut() {
    await this.push.forget();
    this.live.close();
    await this.session.signOut();
    await this.router.navigateByUrl('/');
  }

  private async revoked() {
    this.live.close();
    this.session.revoked();
    await this.router.navigateByUrl('/');
  }

  protected async signOutEverywhere() {
    const answer = await this.overlays.open<boolean>(SignOutEverywhere, {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
    if (answer !== true) return;
    await this.push.forget();
    this.live.close();
    await this.session.signOutEverywhere();
    await this.router.navigateByUrl('/');
  }
}
