import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import { GarageLegalCheck } from '../../garage-legal-check/garage-legal-check';
import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';
import { SuspendedBanner } from '../suspended-banner/suspended-banner';

// The garage's Panou: the "Profil verificat" pill for the owner and the
// receptionist of an approved garage, and the legal check for its owner; the
// four newest waiting requests for whoever may answer quotes; the review line
// while the garage is a draft; the suspension banner above it all while the
// garage is suspended.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageLegalCheck,
    GarageRequestsPanel,
    SuspendedBanner,
    TranslatePipe,
  ],
  selector: 'mf-garage-home',
  styleUrl: './garage-home.css',
  templateUrl: './garage-home.html',
})
export class GarageHome {
  private readonly session = inject(Session);
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly garage = computed(() => garageOf(this.session.shown()));
  protected readonly draft = computed(() => this.garage()?.status === 'draft');
  protected readonly verified = computed(() => {
    const garage = this.garage();
    return (
      garage?.status === 'approved' &&
      (garage.role === 'owner' || garage.role === 'receptionist')
    );
  });
  protected readonly owner = computed(
    () => this.verified() && this.garage()?.role === 'owner',
  );

  constructor() {
    void inject(I18n).enter('garage');
  }
}
