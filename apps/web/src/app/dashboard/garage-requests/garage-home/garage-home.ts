import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import type { Capability } from '@motor-fix/contracts/capabilities';
import { formatDayMonth, I18n, TranslatePipe } from '@motor-fix/i18n';

import { GarageLegalCheck } from '../../garage-legal-check/garage-legal-check';
import { garageOf, Session } from '../../session';
import { VerificationProgress } from '../../verification-progress/verification-progress';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';
import { SuspendedBanner } from '../suspended-banner/suspended-banner';

// The garage's Panou, each section behind a capability of the table: the
// "Profil verificat" pill and the RAR check line of an approved garage for
// whoever holds its profile, the legal check, suspended too, for whoever holds
// its switches; the four newest waiting requests for whoever may answer
// quotes; the suspension banner above it all while the garage is suspended.
// Someone who holds none of them reads that their jobs will appear here. A
// draft garage sees only where its verification stands.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageLegalCheck,
    GarageRequestsPanel,
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
  // No garage-wide section: the own jobs are all there is (their sections
  // come with their story).
  protected readonly ownJobsOnly = computed(
    () =>
      !this.holds('garage.profile') && !this.holds('garage.feature_switches'),
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
