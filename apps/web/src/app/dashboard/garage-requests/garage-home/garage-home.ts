import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';

// The garage's Panou: the four newest waiting requests for whoever may answer
// quotes; the review line while the garage is a draft.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GarageRequestsPanel, TranslatePipe],
  selector: 'mf-garage-home',
  styleUrl: './garage-home.css',
  templateUrl: './garage-home.html',
})
export class GarageHome {
  private readonly session = inject(Session);
  protected readonly feed = inject(GarageRequestsFeed);
  protected readonly draft = computed(
    () => garageOf(this.session.shown())?.status === 'draft',
  );
}
