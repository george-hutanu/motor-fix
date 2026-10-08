import { Directive, ElementRef, effect, inject, model } from '@angular/core';
import { baniToLei, leiToBani } from '@motor-fix/contracts/price-range';

// Nine digits pass every price, so the range check names a too-high one,
// and keep the bani a safe integer.
const DIGITS_MAX = 9;

// Whole lei as people type or paste them: "1.200 lei" is 1200.
export const leiDigits = (typed: string) =>
  typed
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, DIGITS_MAX);

// A price field in whole lei that holds bani, the unit the draft and the
// writes keep; an empty field holds nothing, never 0.
@Directive({
  host: { '(input)': 'typed()', inputmode: 'numeric' },
  selector: 'input[mfLei]',
})
export class LeiInput {
  private readonly field: HTMLInputElement = inject(ElementRef).nativeElement;

  readonly mfLei = model<number | undefined>();

  constructor() {
    effect(() => {
      const bani = this.mfLei();
      const shown = bani === undefined ? '' : String(baniToLei(bani));
      if (this.field.value !== shown) this.field.value = shown;
    });
  }

  protected typed() {
    const digits = leiDigits(this.field.value);
    this.field.value = digits;
    this.mfLei.set(digits ? leiToBani(Number(digits)) : undefined);
  }
}
