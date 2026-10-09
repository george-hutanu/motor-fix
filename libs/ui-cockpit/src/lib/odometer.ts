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
      max-width: 100%;
      color: var(--mf-text);
      font-family: var(--mf-font-label);
      font-size: var(--mf-size-field);
      line-height: 1;
      white-space: nowrap;
    }
    .mf-odometer-value {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      white-space: pre;
    }
    .mf-odometer-digit {
      display: inline-block;
      box-sizing: border-box;
      width: 1.1em;
      padding: 4px 0;
      background: var(--mf-bg);
      border: 1px solid var(--mf-line);
      border-radius: 8px;
      text-align: center;
      position: relative;
      overflow: hidden;
      color: transparent;
    }
    /* The rolling 0–9 column drawn over the cell's own digit. */
    .mf-odometer-digit::before {
      content: "0\\A 1\\A 2\\A 3\\A 4\\A 5\\A 6\\A 7\\A 8\\A 9";
      position: absolute;
      inset: 0 0 auto;
      color: var(--mf-text);
      line-height: calc(1em + 8px);
      white-space: pre;
      translate: 0 calc(var(--mf-digit) * -1 * (1em + 8px));
      transition: translate var(--mf-motion-roll) var(--mf-motion-ease);
    }
    @media (forced-colors: active) {
      .mf-odometer-digit {
        color: inherit;
      }
      .mf-odometer-digit::before {
        content: none;
      }
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
