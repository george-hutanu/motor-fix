import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, inject, input } from '@angular/core';

@Component({
  selector: 'mf-panel',
  styles: `
    .mf-panel {
      background: var(--mf-panel);
      border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-panel);
      padding: var(--mf-space-5);
    }
    h2 {
      margin: 0 0 var(--mf-space-4);
      color: var(--mf-text-secondary);
    }
  `,
  template: `
    <section class="mf-panel" [attr.aria-labelledby]="title() ? headingId : null">
      @if (title()) {
        <h2 class="mf-label" [id]="headingId">{{ title() }}</h2>
      }
      <ng-content />
    </section>
  `,
})
export class Panel {
  readonly title = input<string>();
  protected readonly headingId = inject(_IdGenerator).getId('mf-panel-title-');
}
