import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, Overlays } from '@motor-fix/overlays';

import { HlmButton } from './helm/button';
import { HlmInput } from './helm/input';
import { HlmLabel } from './helm/label';

let fields = 0;

// The catalogue's sample task: one field, a result, and a second task on top.
@Component({
  imports: [HlmButton, HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-cockpit-sample-task',
  styles: `
    :host {
      display: grid;
      gap: var(--mf-space-4);
    }
    p {
      margin: 0;
    }
    .field {
      display: grid;
      gap: var(--mf-space-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-space-3);
    }
  `,
  template: `
    <p>{{ 'cockpit.overlay.intro' | t }}</p>
    <div class="field">
      <label hlmLabel [for]="fieldId">{{ 'cockpit.overlay.field' | t }}</label>
      <input hlmInput [id]="fieldId" autocomplete="off" />
    </div>
    <div class="row">
      <button hlmBtn type="button" (click)="task.close('saved')">
        {{ 'cockpit.overlay.done' | t }}
      </button>
      <button hlmBtn type="button" variant="secondary" (click)="openAnother()">
        {{ 'cockpit.overlay.again' | t }}
      </button>
    </div>
  `,
})
export class CockpitSampleTask {
  protected readonly task = injectOverlayTask<undefined, 'saved'>();
  private readonly overlays = inject(Overlays);
  protected readonly fieldId = `mf-sample-field-${++fields}`;

  protected openAnother() {
    void this.overlays.open(CockpitSampleTask, {
      shape: 'dialog',
      title: 'cockpit.overlay.title',
    });
  }
}
