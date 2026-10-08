import {
  Component,
  computed,
  type ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';
import type { BrandDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

const STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
};

// A radio group of buttons: one Tab stop on the selected tile, the arrow
// keys move the selection and the focus together.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-brand-picker',
  styleUrl: './brand-picker.css',
  templateUrl: './brand-picker.html',
})
export class BrandPicker {
  readonly brands = input.required<BrandDto[]>();
  readonly selected = input.required<string>();
  readonly select = output<string>();
  // The first time a person reaches for the picker, by any means.
  readonly touched = output<void>();
  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');
  // The group keeps one Tab stop even when the selection is not among the
  // tiles: the first tile then takes it.
  protected readonly stop = computed(() => {
    const slugs = this.brands().map((brand) => brand.slug);
    return slugs.includes(this.selected()) ? this.selected() : slugs[0];
  });

  protected move(event: KeyboardEvent, index: number) {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const count = this.brands().length;
    const next = (index + step + count) % count;
    this.select.emit(this.brands()[next].slug);
    this.tiles()[next]?.nativeElement.focus();
  }
}
