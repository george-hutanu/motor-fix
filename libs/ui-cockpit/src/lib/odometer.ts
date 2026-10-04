import { Component, computed, inject, input } from '@angular/core';
import { formatLei, formatLeiRange, I18n } from '@motor-fix/i18n';

// The odometer shows whole lei: each amount is rounded before formatting, so
// the shared price formats never add decimals.
const toWholeLei = (bani: unknown) =>
  typeof bani === 'number' && Number.isFinite(bani)
    ? Math.round(bani / 100) * 100
    : bani;

@Component({
  selector: 'mf-odometer',
  styles: `
    :host {
      display: inline-block;
      color: var(--mf-text);
      font-family: var(--mf-font-label);
      font-size: 20px;
      line-height: 1;
      white-space: nowrap;
    }
    .mf-odometer-value {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .mf-odometer-digit {
      display: inline-block;
      box-sizing: border-box;
      width: 1.1em;
      padding: 0.2em 0;
      background: var(--mf-bg);
      border: 1px solid var(--mf-line);
      border-radius: 8px;
      text-align: center;
    }
    .mf-odometer-spoken {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  template: `
    <span class="mf-odometer-value" aria-hidden="true">
      @for (char of chars(); track $index) {
        @if (char >= '0' && char <= '9') {
          <span class="mf-odometer-digit" [style.--mf-digit]="char">{{ char }}</span>
        } @else {
          <span>{{ char }}</span>
        }
      }
    </span>
    <span aria-live="polite" aria-atomic="true">
      <span class="mf-odometer-spoken">{{ text() }}</span>
    </span>
  `,
})
export class Odometer {
  private readonly i18n = inject(I18n);

  readonly from = input<unknown>();
  // Left unbound (undefined) for a single price. Bound for a range, where a
  // missing end (null, NaN) shows the dash: never bind an optional end here
  // expecting a single price.
  readonly to = input<unknown>();

  protected readonly text = computed(() => {
    const language = this.i18n.language();
    const from = toWholeLei(this.from());
    return this.to() === undefined
      ? formatLei(from, language)
      : formatLeiRange(from, toWholeLei(this.to()), language);
  });
  protected readonly chars = computed(() => [...this.text()]);
}
