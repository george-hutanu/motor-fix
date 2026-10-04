import { Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// "Ieși de pe toate dispozitivele?": closes with true only on "Ieși".
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-sign-out-everywhere',
  styles: `
    :host { display: flex; flex-direction: column; gap: 1.5rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  `,
  template: `
    <p>{{ 'shell.signOutEverywhere.text' | t }}</p>
    <div class="actions">
      <button hlmBtn type="button" (click)="task.close(true)">
        {{ 'shell.signOutEverywhere.confirm' | t }}
      </button>
      <button hlmBtn variant="ghost" type="button" (click)="task.close(false)">
        {{ 'shell.signOutEverywhere.cancel' | t }}
      </button>
    </div>
  `,
})
export class SignOutEverywhere {
  protected readonly task = injectOverlayTask<undefined, boolean>();
}
