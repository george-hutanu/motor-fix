import { Directive } from '@angular/core';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';
import { BrnInput } from '@spartan-ng/brain/input';

@Directive({
  host: { class: 'spartan-input', 'data-slot': 'input' },
  hostDirectives: [
    { directive: BrnInput, inputs: ['id'] },
    BrnFieldControlDescribedBy,
  ],
  selector: '[hlmInput]',
})
export class HlmInput {}
