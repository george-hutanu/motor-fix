import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { supportAddress } from '../../public/contact/contact';
import { DeleteAccountDialog } from '../delete-account-dialog/delete-account-dialog';
import { Session } from '../session';

// "Șterge contul" at the end of Setări. A garage's owner cannot: the garage is
// closed first, through support.
@Component({
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-delete-account',
  styleUrl: './delete-account.css',
  templateUrl: './delete-account.html',
})
export class DeleteAccount {
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
