import { Injectable, inject } from '@angular/core';
import type { AcceptanceDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { Session } from '../../dashboard/session';

// An API call refused while the account's acceptance is pending waits on this
// one dialog: true once accepted, false once the person signed out instead.
@Injectable({ providedIn: 'root' })
export class ReacceptDialog {
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private open: Promise<boolean> | null = null;

  gate(versions: AcceptanceDto): Promise<boolean> {
    this.open ??= this.session
      .keepShownWhile(
        this.overlays.open<'accepted' | 'signed-out', AcceptanceDto>(
          () => import('./reaccept').then((m) => m.Reaccept),
          {
            data: versions,
            dismissible: false,
            shape: 'dialog',
            title: 'public.reaccept.title',
          },
        ),
      )
      .then((answer) => answer === 'accepted')
      .finally(() => {
        this.open = null;
      });
    return this.open;
  }
}
