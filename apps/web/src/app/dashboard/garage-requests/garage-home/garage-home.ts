import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Capability } from '@motor-fix/contracts/capabilities';
import { formatDayMonth, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { openBlockTime } from '../../block-time-dialog/open-block-time';
import {
  DashboardSectionsPanel,
  type PanelRow,
  type SectionsPanelData,
} from '../../dashboard-sections-panel/dashboard-sections-panel';
import { GarageLayout } from '../../garage-layout';
import { GarageLegalCheck } from '../../garage-legal-check/garage-legal-check';
import { GarageReviewsPanel } from '../../garage-reviews/garage-reviews-panel/garage-reviews-panel';
import { homeSections, linksTo } from '../../garage-sections';
import { LiftSchedule } from '../../lift-schedule/lift-schedule';
import { SectionTitle } from '../../section-title/section-title';
import { garageOf, Session } from '../../session';
import { VerificationProgress } from '../../verification-progress/verification-progress';
import { WeeklyFiguresPanel } from '../../weekly-figures-panel/weekly-figures-panel';
import { FirstStepsCard } from '../first-steps-card/first-steps-card';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';
import { OwnJobsSection } from '../own-jobs-section/own-jobs-section';
import { SuspendedBanner } from '../suspended-banner/suspended-banner';

// The garage's Panou: the "Profil verificat" pill and the RAR check line of an
// approved garage for whoever holds its profile, the legal check, suspended
// too, for whoever holds its switches, and the suspension banner while the
// garage is suspended; then its sections in their default order, each behind a
// capability of the table and its feature switch, each title opening its full
// view. The requests and the reviews show their newest rows; every other
// section says in one sentence what it will show.
// A mechanic, who holds no garage-wide section, sees her own jobs after the
// requests, with a link to her day sheet while she holds it and the garage
// keeps day sheets on. A draft garage sees only where its verification stands.
// The owner of a verified garage with no request and no review yet gets the
// first steps above the sections.
// Every garage person keeps her own layout: the sections she hid stay out,
// the strip counts what is shown, and "Personalizează panoul" opens the panel
// that switches them; with all of them hidden one line says how to get one
// back.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FirstStepsCard,
    NgTemplateOutlet,
    GarageLegalCheck,
    GarageRequestsPanel,
    GarageReviewsPanel,
    HlmButton,
    LiftSchedule,
    OwnJobsSection,
    RouterLink,
    SectionTitle,
    SuspendedBanner,
    TranslatePipe,
    VerificationProgress,
    WeeklyFiguresPanel,
  ],
  selector: 'mf-garage-home',
  styleUrl: './garage-home.css',
  templateUrl: './garage-home.html',
})
export class GarageHome {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  protected readonly layout = inject(GarageLayout);
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly garage = computed(() => garageOf(this.session.shown()));
  private readonly holds = (capability: Capability) =>
    (this.session.shown()?.capabilities ?? []).includes(capability);
  protected readonly draft = computed(() => this.garage()?.status === 'draft');
  protected readonly verified = computed(
    () => this.garage()?.status === 'approved' && this.holds('garage.profile'),
  );
  // The legal check is read while approved, and while suspended to see why.
  protected readonly owner = computed(() => {
    const status = this.garage()?.status;
    return (
      this.holds('garage.feature_switches') &&
      (status === 'approved' || status === 'suspended')
    );
  });
  // No garage-wide section: her own jobs are her Panou.
  protected readonly ownJobs = computed(
    () =>
      !this.holds('garage.profile') &&
      !this.holds('garage.feature_switches') &&
      this.holds('garage.own_jobs'),
  );
  protected readonly daySheet = computed(
    () =>
      this.holds('garage.schedule') &&
      this.garage()?.features?.['day_sheets'] !== false,
  );
  private readonly reviewsPanel = viewChild(GarageReviewsPanel);
  private readonly sections = computed(() =>
    homeSections(this.session.shown()),
  );
  // The sections drawn: none until the layout answers, then the ones not hidden.
  protected readonly shown = computed(() => {
    if (!this.layout.ready()) return [];
    const hidden = this.layout.hidden();
    return this.sections().filter((section) => !hidden.has(section.key));
  });
  protected readonly count = computed(() =>
    this.layout.ready()
      ? this.i18n.t('garage.home.panel.count', {
          x: this.shown().length,
          y: this.sections().length,
        })
      : null,
  );
  protected readonly allHidden = computed(
    () =>
      this.layout.ready() &&
      this.sections().length > 0 &&
      this.shown().length === 0,
  );
  // Her own jobs come right after the requests, or first without them, once
  // the layout answers.
  protected readonly ownAfter = computed(() =>
    this.ownJobs() && this.layout.ready()
      ? this.shown().findIndex((section) => section.key === 'req')
      : null,
  );
  // The panel's rows: every section she may see, in her order.
  private readonly rows = computed<PanelRow[]>(() => {
    const hidden = this.layout.hidden();
    return this.sections().map((section, at) => ({
      description: this.i18n.t(`garage.home.panel.description.${section.key}`),
      key: section.key,
      name: this.i18n.t(`garage.home.panel.name.${section.key}`),
      position: at + 1,
      shown: !hidden.has(section.key),
    }));
  });
  protected readonly team = computed(() =>
    linksTo(this.session.shown(), 'team'),
  );
  // The owner and a receptionist hold time for a mechanic or a lift while
  // the garage keeps either switch on (a missing key is on).
  private readonly switches = computed(() => {
    const features = this.garage()?.features;
    return {
      lifts: features?.['lift_schedule'] !== false,
      team: features?.['team_mechanics'] !== false,
    };
  });
  protected readonly canBlockTime = computed(() => {
    const role = this.garage()?.role;
    const { lifts, team } = this.switches();
    return (role === 'owner' || role === 'receptionist') && (lifts || team);
  });
  // Until the first request or review, every one of the garage's lists read
  // empty: a list still loading or failed shows no card.
  protected readonly firstSteps = computed(
    () =>
      this.holds('garage.feature_switches') &&
      this.garage()?.status === 'approved' &&
      this.feed.visible() &&
      !this.feed.loading() &&
      !this.feed.failed() &&
      this.feed.rows()?.length === 0 &&
      this.feed.closed()?.length === 0 &&
      this.feed.quoted()?.length === 0 &&
      this.reviewsPanel()?.count() === 0,
  );
  protected readonly checkedLine = computed(() => {
    const garage = this.garage();
    if (!this.verified() || !garage?.lastCheckedOn) return null;
    return this.i18n.t(
      garage.rechecked
        ? 'garage.legal.pillRecheckedOn'
        : 'garage.legal.pillCheckedOn',
      { day: formatDayMonth(garage.lastCheckedOn, this.i18n.language()) },
    );
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  protected open() {
    const data: SectionsPanelData = {
      messages: 'garage.home.panel',
      rows: () => this.rows(),
      toggle: (key, shown) => this.layout.toggle(key, shown),
    };
    void this.overlays.open(DashboardSectionsPanel, {
      confirmDiscard: false,
      data,
      shape: 'drawer',
      title: 'garage.home.panel.title',
    });
  }

  // One dialog at a time: a second press while it loads or shows opens none.
  protected async blockTime() {
    const garageId = this.garage()?.garageId;
    if (!garageId || this.blocking) return;
    this.blocking = true;
    try {
      await openBlockTime(this.overlays, { garageId, ...this.switches() });
    } finally {
      this.blocking = false;
    }
  }
  private blocking = false;
}
