import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
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
// stands, read again whenever an admin opens, decides or reopens it and
// whenever it is sent again. Only the owner reads the file and answers a
// request for more; the rest of the staff are told it is being checked.
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
  private readonly router = inject(Router);
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
        'verification.submitted',
      ]),
      goneOn: [],
      resync: this.live.resync,
    },
  );
  // The stage a re-read moved the file to; never the first read's.
  private readonly moved = signal<keyof typeof STAGE_NAME | null>(null);
  protected readonly announcement = computed(() => {
    const status = this.moved();
    return status && Object.hasOwn(STAGE_NAME, status)
      ? this.i18n.t('public.verificationStatus.now', {
          stage: this.i18n.t(STAGE_NAME[status]),
        })
      : '';
  });

  constructor() {
    void this.i18n.enter('public');
    // Each read announces a new stage; the frame reads the session again on
    // the same decision and on every resync, which opens the dashboard.
    let shown: string | undefined;
    effect(() => {
      this.view.reads();
      untracked(() => {
        const status = this.view.value()?.status;
        if (shown !== undefined && status !== shown)
          this.moved.set(status ?? null);
        shown = status;
      });
    });
  }

  // The form opens over the garage's saved listing.
  protected complete() {
    void this.router.navigateByUrl('/list-your-garage');
  }

  protected contact() {
    void openContact(this.overlays);
  }
}
