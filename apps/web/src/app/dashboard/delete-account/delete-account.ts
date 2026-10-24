import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { supportAddress } from '../../public/contact/contact';
import { DeleteAccountDialog } from '../delete-account-dialog/delete-account-dialog';
import { Session } from '../session';

// "Șterge contul" at the end of Setări, or inside the driver's "Contul tău"
// panel (`inPanel`: an h3 and no card of its own). A garage's owner cannot:
// the garage is closed first, through support.
@Component({
  host: { '[class.in-panel]': 'inPanel()' },
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-delete-account',
  styleUrl: './delete-account.css',
  templateUrl: './delete-account.html',
})
export class DeleteAccount {
  readonly inPanel = input(false);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  protected readonly language = inject(I18n).language;
  protected readonly address = supportAddress();

  protected readonly owner = computed(
    () =>
      this.session
        .current()
        ?.garageAccess?.some((access) => access.role === 'owner') ?? false,
  );

  protected open() {
    void this.overlays.open(DeleteAccountDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'shell.deleteAccount.dialogTitle',
    });
  }
}
