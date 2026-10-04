import { Directive, input } from '@angular/core';
import { BrnButton } from '@spartan-ng/brain/button';

type ButtonVariant = 'default' | 'secondary' | 'ghost';

// One size only: every button keeps the 44 px target.
@Directive({
  host: {
    '[class.spartan-button-variant-default]': "variant() === 'default'",
    '[class.spartan-button-variant-ghost]': "variant() === 'ghost'",
    '[class.spartan-button-variant-secondary]': "variant() === 'secondary'",
    class: 'spartan-button',
    'data-slot': 'button',
  },
  hostDirectives: [{ directive: BrnButton, inputs: ['disabled'] }],
  selector: 'button[hlmBtn], a[hlmBtn]',
})
export class HlmButton {
  readonly variant = input<ButtonVariant>('default');
}
