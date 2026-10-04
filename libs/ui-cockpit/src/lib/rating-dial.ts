import { Component, computed, inject, input } from '@angular/core';
import { formatRating, I18n } from '@motor-fix/i18n';

// The gauge opens at the bottom: its track covers 240 of the circle's 360.
const SWEEP = 240;

// Half up on the decimal as written: 4.85 is 4.8499… in binary.
function toRating(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(5, Math.max(0, value));
  const rounded = Math.round(Number((clamped * 10).toPrecision(12))) / 10;
  return rounded > 0 ? rounded : undefined;
}

@Component({
  host: {
    '[attr.aria-label]': 'name()',
    '[attr.data-size]': 'size()',
    '[style.--mf-dial-fill]': 'fill()',
    role: 'img',
  },
  selector: 'mf-rating-dial',
  styles: `
    :host {
      position: relative;
      display: inline-block;
      flex: none;
      aspect-ratio: 1;
      color: var(--mf-text);
    }
    :host([data-size='large']) {
      width: 100%;
      max-width: 240px;
    }
    :host([data-size='small']) {
      width: 60px;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .mf-dial-track {
      stroke: var(--mf-line);
    }
    .mf-dial-ticks {
      stroke: var(--mf-text-secondary);
    }
    .mf-dial-arc,
    .mf-dial-needle {
      stroke: var(--mf-amber-ink);
    }
    .mf-dial-arc {
      transition: stroke-dasharray var(--mf-motion-dial) var(--mf-motion-ease);
    }
    .mf-dial-needle {
      transition: transform var(--mf-motion-dial) var(--mf-motion-ease);
    }
    .mf-dial-hub {
      fill: var(--mf-bg);
      stroke: var(--mf-amber-ink);
    }
    .mf-dial-value {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--mf-font-label);
      font-size: var(--mf-size-small);
      line-height: 1;
    }
    :host([data-size='large']) .mf-dial-value {
      inset: 58% 0 auto;
      font-size: 40px;
    }
  `,
  template: `
    <svg viewBox="0 0 68 68" aria-hidden="true">
      <g transform="rotate(150 34 34)" fill="none">
        <circle class="mf-dial-track" cx="34" cy="34" r="28" pathLength="360" stroke-dasharray="240 120"
          [attr.stroke-width]="size() === 'large' ? 2 : 5" />
        @if (size() === 'large') {
          <circle class="mf-dial-ticks" cx="34" cy="34" r="32" pathLength="360" stroke-width="3"
            stroke-dasharray="1 47 1 47 1 47 1 47 1 47 1 119" stroke-dashoffset="0.5" />
        }
        <circle class="mf-dial-arc" cx="34" cy="34" r="28" pathLength="360" stroke-width="5"
          [attr.stroke-dasharray]="dash()" [attr.stroke-linecap]="fill() > 0 ? 'round' : 'butt'" />
      </g>
      @if (size() === 'large') {
        <line class="mf-dial-needle" x1="34" y1="34" x2="34" y2="12" stroke-width="2" stroke-linecap="round"
          [attr.transform]="'rotate(' + needle() + ' 34 34)'" />
        <circle class="mf-dial-hub" cx="34" cy="34" r="3" stroke-width="1.5" />
      }
    </svg>
    <span class="mf-dial-value" aria-hidden="true">{{ text() }}</span>
  `,
})
export class RatingDial {
  private readonly i18n = inject(I18n);

  readonly value = input<unknown>();
  readonly size = input<'large' | 'small'>('large');

  private readonly rating = computed(() => toRating(this.value()));
  protected readonly fill = computed(() => (this.rating() ?? 0) / 5);
  protected readonly dash = computed(
    () => `${Number((this.fill() * SWEEP).toFixed(1))} 360`,
  );
  protected readonly needle = computed(() => (this.fill() - 0.5) * SWEEP);
  protected readonly text = computed(() =>
    formatRating(this.rating(), this.i18n.language()),
  );
  protected readonly name = computed(() =>
    this.rating() === undefined
      ? this.i18n.t('shell.gauge.none')
      : this.i18n.t('shell.gauge.rating', { value: this.text() }),
  );
}
