import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';

import { liveView } from '../../live/view';
import { LegalCheckPanel } from '../legal-check-panel/legal-check-panel';
import { Live } from '../live';
import { garageOf, Session } from '../session';

// The owner's legal check on the Panou, read again whenever the garage's
// verification changes or an admin re-checks it; a 404 (no approved file)
// shows nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalCheckPanel],
  selector: 'mf-garage-legal-check',
  templateUrl: './garage-legal-check.html',
})
export class GarageLegalCheck {
  private readonly api = inject(GaragesService);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId ?? '',
  );
  protected readonly view = liveView(
    () => this.api.legalCheckControllerRead({ garageId: this.garageId() }),
    {
      changes: this.live.on([
        'verification.decided',
        'verification.check_recorded',
        'verification.reopened',
        'recheck.recorded',
      ]),
      goneOn: [404],
      resync: this.live.resync,
      retryAfter: 60_000,
    },
  );
}
