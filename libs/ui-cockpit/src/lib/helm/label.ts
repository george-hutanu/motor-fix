import { Directive } from '@angular/core';
import { BrnLabel } from '@spartan-ng/brain/label';

@Directive({
  host: { class: 'spartan-label', 'data-slot': 'label' },
  hostDirectives: [{ directive: BrnLabel, inputs: ['id', 'for'] }],
  selector: '[hlmLabel]',
})
export class HlmLabel {}
