import { booleanAttribute, Component, input, isDevMode } from '@angular/core';

export type LampState = 'green' | 'red' | 'amber' | 'grey';

const STATES: readonly unknown[] = ['green', 'red', 'amber', 'grey'];

// Typed for templates, but data can still bring any string at run time.
function toState(value: unknown): LampState {
  if (STATES.includes(value)) return value as LampState;
  if (isDevMode())
    console.warn(`mf-lamp: unknown state "${value}", shown grey`);
  return 'grey';
}

@Component({
  host: {
    '[attr.data-pulse]': 'pulse() ? "" : null',
    '[attr.data-state]': 'state()',
    class: 'mf-lamp',
  },
  selector: 'mf-lamp',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-space-2);
      color: var(--mf-text);
      font-family: var(--mf-font-body);
      font-size: var(--mf-size-body);
      font-weight: 600;
    }
    :host([data-state='green']) {
      --mf-lamp-colour: var(--mf-green);
    }
    :host([data-state='red']) {
      --mf-lamp-colour: var(--mf-red);
    }
    :host([data-state='amber']) {
      --mf-lamp-colour: var(--mf-amber-ink);
    }
    :host([data-state='grey']) {
      --mf-lamp-colour: var(--mf-text-secondary);
    }
    .mf-lamp-dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--mf-lamp-colour);
      box-shadow: 0 0 12px var(--mf-lamp-colour);
    }
    @media (forced-colors: active) {
      .mf-lamp-dot {
        outline: 1px solid CanvasText;
      }
    }
  `,
  template: `<span class="mf-lamp-dot" aria-hidden="true"></span>{{ label() }}`,
})
export class Lamp {
  readonly state = input<LampState, unknown>('grey', { transform: toState });
  readonly label = input.required<string>();
  readonly pulse = input(false, { transform: booleanAttribute });
}
