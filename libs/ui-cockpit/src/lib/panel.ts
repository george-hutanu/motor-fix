import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  selector: 'mf-panel',
  styles: `
    .mf-panel {
      background: var(--mf-panel);
      border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-panel);
      padding: var(--mf-space-5);
      animation: mf-rise var(--mf-motion-rise) var(--mf-motion-ease) calc(var(--mf-panel-step, 0) * var(--mf-motion-stagger)) backwards;
    }
    :host(:nth-child(2 of mf-panel)) {
      --mf-panel-step: 1;
    }
    :host(:nth-child(3 of mf-panel)) {
      --mf-panel-step: 2;
    }
    :host(:nth-child(4 of mf-panel)) {
      --mf-panel-step: 3;
    }
    :host(:nth-child(5 of mf-panel)) {
      --mf-panel-step: 4;
    }
    :host(:nth-child(6 of mf-panel)) {
      --mf-panel-step: 5;
    }
    :host(:nth-child(7 of mf-panel)) {
      --mf-panel-step: 6;
    }
    :host(:nth-child(8 of mf-panel)) {
      --mf-panel-step: 7;
    }
    :host(:nth-child(9 of mf-panel)) {
      --mf-panel-step: 8;
    }
    :host(:nth-child(10 of mf-panel)) {
      --mf-panel-step: 9;
    }
    :host(:nth-child(11 of mf-panel)) {
      --mf-panel-step: 10;
    }
    :host(:nth-child(n + 12 of mf-panel)) {
      --mf-panel-step: 11;
    }
    h2 {
      margin: 0 0 var(--mf-space-4);
      color: var(--mf-text-secondary);
    }
    h2 a {
      color: inherit;
      text-underline-offset: 0.2em;
    }
  `,
  template: `
    <section class="mf-panel" [attr.aria-labelledby]="heading() ? headingId : null">
      @if (heading()) {
        <h2 class="mf-label" [id]="headingId">
          @if (link(); as to) {
            <a [routerLink]="to">{{ heading() }}</a>
          } @else {
            {{ heading() }}
          }
        </h2>
      }
      <ng-content />
    </section>
  `,
})
export class Panel {
  readonly heading = input<string>();
  // The view the heading opens, if the panel stands for one.
  readonly link = input<unknown[] | string>();
  protected readonly headingId = inject(_IdGenerator).getId('mf-panel-title-');
}
