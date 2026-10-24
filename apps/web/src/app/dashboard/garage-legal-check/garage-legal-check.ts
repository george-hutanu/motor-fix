import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { Overlays } from '@motor-fix/overlays';

import { liveView } from '../../live/view';
import {
  DocumentsUpload,
  type DocumentsUploadData,
} from '../documents-upload/documents-upload';
import { LegalCheckPanel } from '../legal-check-panel/legal-check-panel';
import { Live } from '../live';
import { garageOf, Session } from '../session';

// The owner's legal check on the Panou, read again whenever the garage's
// verification changes, an admin re-checks it, it is suspended, or its yearly
// documents change or fall due; a 404 (no file) shows nothing. The Documente
// row's button opens the upload dialog, and a sent upload reads the panel
// again.
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
  private readonly overlays = inject(Overlays);
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
        'garage.suspended',
        'garage.restored',
        'document.uploaded',
        'document.due',
        'document.overdue',
        'document.accepted',
        'document.refused',
      ]),
      goneOn: [404],
      resync: this.live.resync,
      retryAfter: 60_000,
    },
  );

  async upload() {
    const sent = await this.overlays.open<unknown, DocumentsUploadData>(
      DocumentsUpload,
      {
        data: { garageId: this.garageId() },
        shape: 'dialog',
        title: 'garage.legal.upload.title',
      },
    );
    if (sent !== 'cancelled') this.view.reload();
  }
}
