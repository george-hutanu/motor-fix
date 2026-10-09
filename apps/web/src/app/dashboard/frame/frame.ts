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
  type Params,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import {
  CITY_ALL,
  CITY_KEY,
  PERIODS,
  type Period,
} from '@motor-fix/contracts/figure-choices';
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

import { segmentsOf } from '../../addresses';
import { AddCar } from '../add-car/add-car';
import { AdminFilters } from '../admin-filters/admin-filters';
import type { FiltersChoice } from '../admin-filters-sheet/admin-filters-sheet';
import { AdminOverview } from '../admin-overview';
import { Bell } from '../bell/bell';
import { EmailBanner } from '../email-banner/email-banner';
import { initials } from '../initials';
import { InviteStaff } from '../invite-staff/invite-staff';
import { Live } from '../live';
import { LiveChange } from '../live-in-place/live-in-place';
import { PushDevice } from '../push-device';
import { garageOf, Session } from '../session';
import { SignOutEverywhere } from '../sign-out-everywhere/sign-out-everywhere';
import { DashboardTabBar } from '../tab-bar/tab-bar';
import { type Area, allowedViews, type Counts, DASHBOARDS } from '../views';

type Role = MeDto['role'];

// The chips' order, whatever order the account holds its roles in.
// The Panou address's choice; anything else in it is the default (163-FR-009).
const choiceOf = (query: Params): FiltersChoice => {
  const { city, period } = query;
  return {
    city:
      typeof city === 'string' && CITY_KEY.test(city) && city.length <= 80
        ? city
        : CITY_ALL,
    period: PERIODS.includes(period) ? (period as Period) : 'default',
  };
};
// The address of a choice: the defaults are left out.
const queryOf = ({ city, period }: FiltersChoice) => ({
  city: city === CITY_ALL ? null : city,
  period: period === 'default' ? null : period,
});

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
    AdminFilters,
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
  styleUrl: './frame.css',
  templateUrl: './frame.html',
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
  // The header's city: "Toată țara", "București" translated, others as recorded.
  private readonly cityName = (key: string, recorded?: string) =>
    key === CITY_ALL || key === 'bucuresti'
      ? this.i18n.t(`shell.frame.admin.city.${key === CITY_ALL ? 'all' : key}`)
      : recorded;
  protected readonly place = computed(() => {
    const overview = this.adminOverview;
    if (!overview) return undefined;
    const key = overview.city();
    return this.cityName(
      key,
      overview.cities().find((c) => c.key === key)?.name,
    );
  });
  protected readonly cities = computed(() => {
    const listed = (this.adminOverview?.cities() ?? []).filter(
      (c) => c.key !== CITY_ALL,
    );
    return [{ key: CITY_ALL }, ...listed].map(({ key, ...c }) => ({
      key,
      name: this.cityName(key, 'name' in c ? c.name : key) ?? key,
    }));
  });
  // The header's count is the city's, read with the city's figures.
  protected readonly headerLoading = computed(() => {
    const overview = this.adminOverview;
    if (!overview) return false;
    return (
      overview.loading() ||
      (overview.city() !== CITY_ALL && overview.figuresLoading())
    );
  });
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
  // Signing out can wait up to 3 s for a language save in flight.
  protected readonly signingOut = signal(false);
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
  // The garage the dashboard is for, only on the garage dashboard.
  protected readonly garage = computed(() =>
    this.area() === 'garage' ? garageOf(this.session.shown()) : null,
  );
  protected readonly entries = computed(() =>
    allowedViews(
      this.area(),
      this.session.shown()?.capabilities ?? [],
      this.garage()?.features,
    ),
  );
  // The address on screen.
  private readonly address = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(({ urlAfterRedirects }) => this.router.parseUrl(urlAfterRedirects)),
    ),
    // Created while its own navigation runs: router.url is still the old one.
    {
      initialValue:
        this.router.currentNavigation()?.finalUrl ??
        this.router.parseUrl(this.router.url),
    },
  );
  // ['app', <area>, <view>?, …] of the address on screen.
  private readonly segments = computed(() => segmentsOf(this.address()));
  // The admin's "Panou", the one view with a city and a period.
  protected readonly onPanel = computed(
    () => !!this.adminOverview && this.segments()[2] === undefined,
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
    if (this.adminOverview) this.followAddress(this.adminOverview);
  }

  // Panou's address holds the choice; an unknown one is corrected in place,
  // and every other view reads the whole country (163-FR-009).
  private followAddress(overview: AdminOverview) {
    effect(() => {
      if (!this.onPanel()) {
        untracked(() => overview.choose(CITY_ALL, 'default'));
        return;
      }
      const query = this.address().queryParams;
      const choice = choiceOf(query);
      const written = queryOf(choice);
      untracked(() => {
        if (
          (query['city'] ?? null) !== written.city ||
          (query['period'] ?? null) !== written.period
        )
          this.writeChoice(choice, true);
        overview.choose(choice.city, choice.period);
      });
    });
    // The server knows no such city: the address drops it.
    effect(() => {
      if (!overview.fellBack() || !this.onPanel()) return;
      untracked(() =>
        this.writeChoice({ city: CITY_ALL, period: overview.period() }, true),
      );
    });
  }

  protected chooseFigures(choice: FiltersChoice) {
    this.writeChoice(choice, false);
  }

  private writeChoice(choice: FiltersChoice, replaceUrl: boolean) {
    void this.router.navigate([this.base()], {
      queryParams: queryOf(choice),
      queryParamsHandling: 'merge',
      replaceUrl,
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
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.push.forget();
      this.live.close();
      await this.session.signOut();
      await this.router.navigateByUrl('/');
    } finally {
      this.signingOut.set(false);
    }
  }

  private async revoked() {
    this.live.close();
    this.session.revoked();
    await this.router.navigateByUrl('/');
  }

  protected async signOutEverywhere() {
    if (this.signingOut()) return;
    const answer = await this.overlays.open<boolean>(SignOutEverywhere, {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
    if (answer !== true || this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.push.forget();
      this.live.close();
      await this.session.signOutEverywhere();
      await this.router.navigateByUrl('/');
    } finally {
      this.signingOut.set(false);
    }
  }
}
