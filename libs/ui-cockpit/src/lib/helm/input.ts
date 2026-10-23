import {
  computed,
  Directive,
  type DoCheck,
  ElementRef,
  effect,
  forwardRef,
  inject,
  input,
  Renderer2,
  signal,
} from '@angular/core';
import type { AbstractControl } from '@angular/forms';
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
// the template's own rule, bound as `[aria-invalid]`, says so. It writes only
// when its answer changes, so a static `aria-invalid` stays; a field under a
// save binds its own rule to the input, never `[attr.aria-invalid]`, or the
// input's removal would not be undone.
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
export class HlmInput implements DoCheck {
  protected readonly field = inject(BrnFieldControl);

  readonly id = input(`hlm-input-${++nextId}`);
  readonly labelableId = this.id;

  // The field's own rule, for a field whose rule is wider than its control's
  // validity: `true`, or an ARIA token (`grammar`, `spelling`) written as
  // given. `false`, `null` and `'false'` read as not invalid.
  readonly ownInvalid = input<boolean | string | null | undefined>(false, {
    alias: 'aria-invalid',
  });

  // The control the brain resolved, followed on every check: a rebound
  // `[formControl]` is another control with its own reveal.
  private readonly control = signal<AbstractControl | null>(null);

  private readonly announced = computed((): string | null => {
    const own = this.ownInvalid();
    if (own === true || own === '') return 'true';
    if (typeof own === 'string' && own !== 'false') return own;
    const control = this.control();
    return control && this.field.invalid() && fieldRevealed(control)
      ? 'true'
      : null;
  });

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const renderer = inject(Renderer2);
    // Written only when the answer changes, so an attribute the template
    // sets on the first render stays until the field's own rule moves it.
    let last: string | null = null;
    effect(() => {
      const now = this.announced();
      if (now === last) return;
      last = now;
      if (now === null) renderer.removeAttribute(element, 'aria-invalid');
      else renderer.setAttribute(element, 'aria-invalid', now);
    });
  }

  ngDoCheck() {
    this.control.set(this.field.ngControl?.control ?? null);
  }
}
