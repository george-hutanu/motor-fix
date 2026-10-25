import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { type AcceptanceDto, MeService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Session } from '../../dashboard/session';

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

// The texts changed since the account accepted them: accept the ones in force,
// or sign out. Nothing else closes it, and nothing behind it answers until then.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-reaccept',
  styleUrl: './reaccept.css',
  templateUrl: './reaccept.html',
})
export class Reaccept {
  private readonly me = inject(MeService);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<
    AcceptanceDto,
    'accepted' | 'signed-out'
  >();

  protected readonly versions = signal(this.task.data);
  protected readonly sending = signal(false);
  protected readonly failed = signal(false);
  protected readonly lang = this.i18n.language;

  constructor() {
    void this.i18n.enter('public');
  }

  protected async accept() {
    if (this.sending()) return;
    this.sending.set(true);
    this.failed.set(false);
    try {
      await this.me.acceptanceControllerAccept({ body: this.versions() });
      this.task.close('accepted');
    } catch (error) {
      // Another version came into force while the dialog was up.
      const versions = versionsOf((error as { error?: unknown }).error);
      if (versions) this.versions.set(versions);
      else this.failed.set(true);
    } finally {
      this.sending.set(false);
    }
  }

  protected async signOut() {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      await this.session.signOut();
      await this.router.navigateByUrl(`/${this.lang()}`);
    } finally {
      this.sending.set(false);
      this.task.close('signed-out');
    }
  }
}
