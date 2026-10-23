import {
  computed,
  Directive,
  ElementRef,
  effect,
  forwardRef,
  inject,
  input,
  Renderer2,
} from '@angular/core';
import { fieldRevealed } from '@motor-fix/overlays';
import {
  BrnFieldControl,
  BrnFieldControlDescribedBy,
  BrnLabelable,
} from '@spartan-ng/brain/field';

let nextId = 0;

// The brain's input announces a field `aria-invalid` the moment its control
// is invalid, before any press, and its host binding overwrites the one a
// template sets on the first render. This input keeps the brain's field
// state and data attributes, and announces a field invalid while a save has
// revealed it (`fieldRevealed`) and its control is still invalid, or while
// the template's own rule says so: `[aria-invalid]` as an input, or
// `aria-invalid` / `[attr.aria-invalid]` as an attribute it leaves alone.
@Directive({
  host: {
    '[attr.data-dirty]': 'field.dirty() ? "true" : null',
    '[attr.data-invalid]': 'field.invalid() ? "true" : null',
    '[attr.data-matches-spartan-invalid]':
      'field.spartanInvalid() ? "true" : null',
    '[attr.data-touched]': 'field.touched() ? "true" : null',
    '[id]': 'id()',
    class: 'spartan-input',
    'data-slot': 'input',
  },
  hostDirectives: [
    BrnFieldControl,
    // Without the input, the brain's host binding drops the field's own
    // aria-describedby (the id of its error message).
    { directive: BrnFieldControlDescribedBy, inputs: ['aria-describedby'] },
  ],
  providers: [
    { provide: BrnLabelable, useExisting: forwardRef(() => HlmInput) },
  ],
  selector: '[hlmInput]',
})
export class HlmInput {
  protected readonly field = inject(BrnFieldControl);

  readonly id = input(`hlm-input-${++nextId}`);
  readonly labelableId = this.id;

  // The field's own rule, for a field whose rule is wider than its control's
  // validity. `aria-invalid="false"` reads as not invalid.
  readonly ownInvalid = input<boolean | string | null | undefined>(false, {
    alias: 'aria-invalid',
  });

  private readonly announced = computed(() => {
    const own = this.ownInvalid();
    if (own !== false && own !== null && own !== undefined && own !== 'false')
      return true;
    // Reading `invalid` first wakes this when the brain resolves the control.
    if (!this.field.invalid()) return false;
    const control = this.field.ngControl?.control;
    return !!control && fieldRevealed(control);
  });

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const renderer = inject(Renderer2);
    // Written only when the answer changes, so an attribute the template
    // sets on the first render stays until the field's own rule moves it.
    let last = false;
    effect(() => {
      const now = this.announced();
      if (now === last) return;
      last = now;
      if (now) renderer.setAttribute(element, 'aria-invalid', 'true');
      else renderer.removeAttribute(element, 'aria-invalid');
    });
  }
}
