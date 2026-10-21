import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
} from '@angular/core';
import type { VerificationStageStatus } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access/models/me-dto';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Live } from '../../dashboard/live';
import { Session } from '../../dashboard/session';
import { liveView } from '../../live/view';
import { VerificationStages } from '../verification-stages/verification-stages';

const KEY = 'public.verificationStatus.';

export const ownedGarage = (me: MeDto | null) =>
  me?.garageAccess.find((access) => access.role === 'owner')?.garageId;

const STAGE_NAME: Record<VerificationStageStatus, string> = {
  approved: `${KEY}approved`,
  draft: `${KEY}notSent`,
  in_review: `${KEY}inReview`,
  more_requested: `${KEY}moreRequested`,
  rejected: `${KEY}rejected`,
  submitted: `${KEY}submitted`,
};

// The signed-in owner's listing on its way to the map: the session's garage
// read again whenever an admin opens, decides or reopens its file, and on
// every reconnect of the account's live stream.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe, VerificationStages],
  selector: 'mf-listing-status',
  styleUrl: './listing-status.css',
  templateUrl: './listing-status.html',
})
export class ListingStatus {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  private readonly session = inject(Session);
  // What the send answered, shown until the first read does.
  readonly sent = input<VerificationStageStatus | null>(null);

  protected readonly view = liveView(
    () =>
      this.api.verificationStatusControllerRead({
        garageId: ownedGarage(this.session.current()) ?? '',
      }),
    {
      changes: this.live.on([
        'verification.opened',
        'verification.decided',
        'verification.reopened',
      ]),
      goneOn: [],
      resync: this.live.resync,
    },
  );
  protected readonly status = computed(
    () => this.view.value()?.status ?? this.sent(),
  );
  protected readonly announcement = computed(() => {
    const status = this.status();
    return status
      ? this.i18n.t(`${KEY}now`, { stage: this.i18n.t(STAGE_NAME[status]) })
      : '';
  });

  constructor() {
    this.live.open();
    inject(DestroyRef).onDestroy(() => this.live.close());
  }
}
