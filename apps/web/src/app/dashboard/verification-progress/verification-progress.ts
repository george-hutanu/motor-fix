import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { liveView } from '../../live/view';
import { STAGE_NAME } from '../../public/listing-status/listing-status';
import { VerificationStages } from '../../public/verification-stages/verification-stages';
import { openContact } from '../contact-task/open-contact';
import { Live } from '../live';
import { garageOf, Session } from '../session';

// The dashboard of a garage still waiting for approval: where its file
// stands, read again whenever an admin opens, decides or reopens it. Only the
// owner reads the file; the rest of the staff are told it is being checked.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe, VerificationStages],
  selector: 'mf-verification-progress',
  styleUrl: './verification-progress.css',
  templateUrl: './verification-progress.html',
})
export class VerificationProgress {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);

  private readonly garage = computed(() => garageOf(this.session.current()));
  protected readonly owner = computed(() => this.garage()?.role === 'owner');

  protected readonly view = liveView(
    async () => {
      const garage = untracked(this.garage);
      return garage?.role === 'owner'
        ? this.api.verificationStatusControllerRead({
            garageId: garage.garageId,
          })
        : null;
    },
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
  // Said when the stage changes on screen, never for the first read.
  protected readonly announcement = computed(() => {
    const status = this.view.value()?.status;
    return this.view.reads() > 1 && status && Object.hasOwn(STAGE_NAME, status)
      ? this.i18n.t('public.verificationStatus.now', {
          stage: this.i18n.t(STAGE_NAME[status]),
        })
      : '';
  });

  constructor() {
    void this.i18n.enter('public');
    // An approval reaches the session only when it is read again; the
    // dashboard opens once it says approved.
    effect(() => {
      this.view.reads();
      untracked(() => {
        if (
          this.view.value()?.status === 'approved' &&
          this.garage()?.status === 'draft'
        )
          void this.session.reload();
      });
    });
  }

  protected contact() {
    void openContact(this.overlays);
  }
}
