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

import { GarageLegalCheck } from '../../garage-legal-check/garage-legal-check';
import { GarageReviewsPanel } from '../../garage-reviews/garage-reviews-panel/garage-reviews-panel';
import { homeSections, linksTo } from '../../garage-sections';
import { SectionTitle } from '../../section-title/section-title';
import { garageOf, Session } from '../../session';
import { VerificationProgress } from '../../verification-progress/verification-progress';
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
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FirstStepsCard,
    NgTemplateOutlet,
    GarageLegalCheck,
    GarageRequestsPanel,
    GarageReviewsPanel,
    OwnJobsSection,
    RouterLink,
    SectionTitle,
    SuspendedBanner,
    TranslatePipe,
    VerificationProgress,
  ],
  selector: 'mf-garage-home',
  styleUrl: './garage-home.css',
  templateUrl: './garage-home.html',
})
export class GarageHome {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
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
  protected readonly sections = computed(() =>
    homeSections(this.session.shown()),
  );
  // Her own jobs come right after the requests, or first without them.
  protected readonly ownAfter = computed(() =>
    this.ownJobs()
      ? this.sections().findIndex((section) => section.key === 'req')
      : null,
  );
  protected readonly team = computed(() =>
    linksTo(this.session.shown(), 'team'),
  );
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
}
