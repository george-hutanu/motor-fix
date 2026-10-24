import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  ErrorHandler,
  effect,
  Injector,
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
import { LOCALITY_MAX } from '@motor-fix/contracts/place-section';
import type { CarDto, MeDto, ReviewDto } from '@motor-fix/data-access';
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
import { ConsentBar } from '../../consent/consent-bar/consent-bar';
import { Voice } from '../../voice/voice';
import { AddCar } from '../add-car/add-car';
import { AdminFilters } from '../admin-filters/admin-filters';
import type { FiltersChoice } from '../admin-filters-sheet/admin-filters-sheet';
import { AdminOverview } from '../admin-overview';
import { Bell } from '../bell/bell';
import { openContact } from '../contact-task/open-contact';
import { EmailBanner } from '../email-banner/email-banner';
import { GarageRequestsFeed } from '../garage-requests/garage-requests-feed';
import { initials } from '../initials';
import { InviteStaff } from '../invite-staff/invite-staff';
import { Live } from '../live';
import { LiveChange } from '../live-in-place/live-in-place';
import { PushDevice } from '../push-device';
import { garageOf, Session } from '../session';
import { SignOutEverywhere } from '../sign-out-everywhere/sign-out-everywhere';
import { DashboardTabBar } from '../tab-bar/tab-bar';
import {
  type Area,
  allowedViews,
  type Counts,
  DASHBOARDS,
  type DashboardView,
} from '../views';

type Role = MeDto['role'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Panou address's choice; anything else in it is the default.
const choiceOf = (query: Params): FiltersChoice => {
  const { city, period } = query;
  return {
    city:
      typeof city === 'string' &&
      CITY_KEY.test(city) &&
      city.length <= LOCALITY_MAX
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
    AdminFilters,
    AsWritten,
    Bell,
    ClockPipe,
    ConsentBar,
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
  providers: [AdminOverview, GarageRequestsFeed],
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
  private readonly errors = inject(ErrorHandler);
  private readonly push = inject(PushDevice);
  private readonly i18n = inject(I18n);
  private readonly voice = inject(Voice);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  // A lost session keeps the frame's own dashboard until Home opens.
  private readonly opened =
    untracked(() => this.session.shown()?.landing) ?? '/app/driver';
  protected readonly base = computed(
    () => this.session.shown()?.landing ?? this.opened,
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
  private readonly requests =
    this.area() === 'garage' ? inject(GarageRequestsFeed) : null;
  protected readonly countsLoading = computed(
    () =>
      (this.adminOverview?.loading() ?? false) ||
      (this.requests?.loading() ?? false),
  );
  // A count from a failed re-read may be old: none is shown until it reads again.
  protected readonly counts = computed<Counts>(() => ({
    garagesWaiting: this.adminOverview?.waiting(),
    requestsWaiting: this.requests?.stale()
      ? undefined
      : this.requests?.total(),
  }));
  protected readonly roles = computed(() => {
    const held = this.session.shown()?.roles ?? [];
    return ROLES.filter(({ role }) => held.includes(role));
  });
  protected readonly switching = signal(false);
  // The review task is open: the address naming a job opens it once.
  private reviewing = false;
  // Signing out can wait up to 3 s for a language save in flight.
  protected readonly signingOut = signal(false);
  private leaving = false;
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
      this.garage()?.status,
    ),
  );
  // The menu and the bar: the views, then the entries that open a task.
  protected readonly menu = computed(() => [
    ...this.entries(),
    ...(this.dashboard().actions ?? []),
  ]);
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
  // The page's one h1. A garage still waiting for approval is titled by its
  // verification, the only thing its dashboard shows.
  protected readonly title = computed(() =>
    this.garage()?.status === 'draft'
      ? 'garage.verification.title'
      : (this.open().title ?? this.open().label),
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
    // A session lost mid-flight (a refused renewal) with no sign-in dialog
    // keeping its account on screen: Home, as after a sign-out.
    effect(() => {
      // Signed back in before Home opened: a later loss goes Home again.
      if (this.session.shown()) this.leaving = false;
      else untracked(() => void this.home());
    });
    // The approval swaps the verification page for the dashboard: the focus
    // follows to its title instead of staying on a control that is gone.
    let status = untracked(() => this.garage()?.status);
    effect(() => {
      const now = this.garage()?.status;
      if (status === 'draft' && now !== undefined && now !== 'draft')
        afterNextRender(
          () =>
            this.host.nativeElement
              .querySelector<HTMLElement>('header h1')
              ?.focus(),
          { injector: this.injector },
        );
      status = now;
    });
    // The draft garage's title is a garage text: loaded with the frame, not
    // after the lazy page, so the header never shows its key.
    effect(() => {
      if (this.garage()?.status === 'draft') void this.i18n.enter('garage');
    });
    if (this.adminOverview) this.followAddress(this.adminOverview);
    // `?review=<job>` on any driver view opens the review of that job.
    effect(() => {
      const job = this.address().queryParams['review'];
      if (this.area() !== 'driver' || typeof job !== 'string') return;
      untracked(() =>
        this.review(job).catch((e: unknown) => this.errors.handleError(e)),
      );
    });
  }

  private async review(job: string) {
    if (this.reviewing) return;
    this.reviewing = true;
    try {
      await this.overlays.open<ReviewDto, { jobId?: string }>(
        () => import('../review-task/review-task').then((m) => m.ReviewTask),
        {
          confirmDiscard: false,
          data: { jobId: UUID.test(job) ? job : undefined },
          shape: 'drawer',
          title: this.voice.key('review'),
        },
      );
    } finally {
      // A task that failed to load lets the next address open it again.
      this.reviewing = false;
    }
    // Closed: the address no longer names the job, unless it already left.
    const here = this.router.parseUrl(this.router.url);
    if (!('review' in here.queryParams)) return;
    const { review: _, ...rest } = here.queryParams;
    here.queryParams = rest;
    await this.router.navigateByUrl(here, { replaceUrl: true });
  }

  // Panou's address holds the choice; an unknown one is corrected in place,
  // and every other view reads the whole country.
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
    // The whole query is written again so the city always comes before the
    // period, whichever was chosen first: one choice, one address.
    const {
      city: _city,
      period: _period,
      ...rest
    } = this.address().queryParams;
    void this.router.navigate([this.base()], {
      queryParams: { ...rest, ...queryOf(choice) },
      replaceUrl,
    });
  }

  // The frame holds the tab's live connection for as long as it is shown.
  ngOnInit() {
    this.live.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((message) => {
        if (message.kind === 'live.test') this.lastTest.set(message.at);
        // A suspension, a restore or a verification decision changes what the garage's
        // dashboard shows, a re-check the RAR line under its verified pill, and
        // the owner's feature switches or a mechanic's change its menu, bar
        // and routes, and a removed mechanic loses the garage's.
        if (
          message.kind === 'account.email_confirmed' ||
          message.kind === 'garage.features_changed' ||
          message.kind === 'mechanic.updated' ||
          message.kind === 'mechanic.removed' ||
          message.kind === 'garage.suspended' ||
          message.kind === 'garage.restored' ||
          message.kind === 'verification.decided' ||
          message.kind === 'recheck.recorded'
        ) {
          void this.session.reload();
        }
        if (message.kind === 'session.revoked') void this.sessionsEnded();
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
        void this.home();
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

  protected act({ action }: DashboardView) {
    if (action === 'contact') void openContact(this.overlays);
  }

  protected invite(garageId: string) {
    void this.overlays.open<'sent', { garageId: string }>(InviteStaff, {
      data: { garageId },
      shape: 'dialog',
      title: 'garage.invite.title',
    });
  }

  // Every way out of the session ends here, once.
  private home() {
    if (this.leaving) return Promise.resolve(true);
    this.leaving = true;
    return this.router.navigateByUrl('/');
  }

  protected async signOut() {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.push.forget();
      this.live.close();
      await this.session.signOut();
      await this.home();
    } finally {
      this.signingOut.set(false);
    }
  }

  // Every session ended (all devices, a password reset), here or elsewhere.
  // Right after this tab's own password change, which keeps its session, the
  // server says whether it still renews instead.
  private async sessionsEnded() {
    // This tab's own account deletion signs it out once it is answered; the
    // stream, whose next try could only be refused, stops here.
    if (this.session.deletingAccount()) {
      this.live.close();
      return;
    }
    if (this.session.keepsThroughRevoke() && (await this.session.renew())) {
      return;
    }
    await this.revoked();
  }

  private async revoked() {
    this.live.close();
    this.session.revoked();
    await this.home();
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
      await this.home();
    } finally {
      this.signingOut.set(false);
    }
  }
}
