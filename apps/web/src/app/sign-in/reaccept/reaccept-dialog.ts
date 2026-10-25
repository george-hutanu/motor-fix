import { Injectable, inject } from '@angular/core';
import type { AcceptanceDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { Session } from '../../dashboard/session';

// Kept out of the dialog's own module, which loads only when it opens.
// The versions in force a consent_required refusal names, or null.
export const versionsOf = (body: unknown): AcceptanceDto | null => {
  const refusal = body as
    | (Partial<AcceptanceDto> & { code?: unknown })
    | null
    | undefined;
  return refusal?.code === 'consent_required' &&
    typeof refusal.termsVersion === 'string' &&
    typeof refusal.privacyVersion === 'string'
    ? {
        privacyVersion: refusal.privacyVersion,
        termsVersion: refusal.termsVersion,
      }
    : null;
};

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
