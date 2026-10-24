import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { supportAddress } from '../../public/contact/contact';
import { DeleteAccountDialog } from '../delete-account-dialog/delete-account-dialog';
import { Live } from '../live';
import { PushDevice } from '../push-device';
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
  private readonly live = inject(Live);
  private readonly push = inject(PushDevice);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;
  protected readonly address = supportAddress();

  protected readonly owner = computed(
    () =>
      this.session
        .current()
        ?.garageAccess?.some((access) => access.role === 'owner') ?? false,
  );

  protected async open() {
    const deleted = await this.overlays.open<true>(DeleteAccountDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'shell.deleteAccount.dialogTitle',
    });
    if (deleted !== true) return;
    // The account and its sessions are gone: nothing is asked of the server
    // any more, which would only answer with a sign-in. The dialog has stepped
    // back over its history entry, so the way Home is not undone. The session
    // goes once Home is open: forgotten under the dashboard, it would send its
    // own way Home, overtaking this one and the toast with it.
    this.live.close();
    await this.push.dropped();
    await this.router.navigateByUrl('/');
    this.session.revoked();
    toast(this.i18n.t('shell.deleteAccount.done'));
  }
}
