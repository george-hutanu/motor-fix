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
      animation: mf-rise var(--mf-motion-rise) var(--mf-motion-ease) calc(var(--mf-panel-step, 0) * var(--mf-motion-stagger)) backwards;
    }
    :host(:nth-child(2)) {
      --mf-panel-step: 1;
    }
    :host(:nth-child(3)) {
      --mf-panel-step: 2;
    }
    :host(:nth-child(4)) {
      --mf-panel-step: 3;
    }
    :host(:nth-child(5)) {
      --mf-panel-step: 4;
    }
    :host(:nth-child(6)) {
      --mf-panel-step: 5;
    }
    :host(:nth-child(7)) {
      --mf-panel-step: 6;
    }
    :host(:nth-child(8)) {
      --mf-panel-step: 7;
    }
    :host(:nth-child(9)) {
      --mf-panel-step: 8;
    }
    :host(:nth-child(10)) {
      --mf-panel-step: 9;
    }
    :host(:nth-child(11)) {
      --mf-panel-step: 10;
    }
    :host(:nth-child(12)) {
      --mf-panel-step: 11;
    }
    h2 {
      margin: 0 0 var(--mf-space-4);
      color: var(--mf-text-secondary);
    }
  `,
  template: `
    <section class="mf-panel" [attr.aria-labelledby]="heading() ? headingId : null">
      @if (heading()) {
        <h2 class="mf-label" [id]="headingId">{{ heading() }}</h2>
      }
      <ng-content />
    </section>
  `,
})
export class Panel {
  readonly heading = input<string>();
  protected readonly headingId = inject(_IdGenerator).getId('mf-panel-title-');
}
