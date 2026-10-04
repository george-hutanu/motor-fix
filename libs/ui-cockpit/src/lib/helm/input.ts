import { Directive } from '@angular/core';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';
import { BrnInput } from '@spartan-ng/brain/input';

@Directive({
  host: { class: 'spartan-input', 'data-slot': 'input' },
  hostDirectives: [
    { directive: BrnInput, inputs: ['id'] },
    // Without the input, the brain's host binding drops the field's own
    // aria-describedby (the id of its error message).
    { directive: BrnFieldControlDescribedBy, inputs: ['aria-describedby'] },
  ],
  selector: '[hlmInput]',
})
export class HlmInput {}
