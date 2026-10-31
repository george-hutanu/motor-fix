import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
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
    '[class.mf-dial-swing-in]': 'swingIn()',
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
      transform: rotate(var(--mf-dial-needle));
      transform-origin: 34px 34px;
      transition: transform var(--mf-motion-dial) var(--mf-motion-ease);
    }
    @starting-style {
      :host(.mf-dial-swing-in) .mf-dial-needle {
        transform: rotate(-120deg);
      }
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
      font-size: var(--mf-size-display);
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
        @if (needle(); as angle) {
          <line class="mf-dial-needle" x1="34" y1="34" x2="34" y2="12" stroke-width="2" stroke-linecap="round" [style.--mf-dial-needle]="angle" />
        }
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
  // No rating, no needle: one resting at 0 would read as a poor rating.
  protected readonly needle = computed(() => {
    const rating = this.rating();
    return rating === undefined
      ? undefined
      : `${Number(((rating / 5 - 0.5) * SWEEP).toFixed(1))}deg`;
  });
  // A rating arriving after none swings the needle in from the 0 mark; a host
  // binding, so it sees every change and not only those the needle renders.
  protected readonly swingIn = linkedSignal({
    computation: (rating, previous) =>
      rating !== undefined &&
      previous !== undefined &&
      previous.source === undefined,
    source: this.rating,
  });
  protected readonly text = computed(() =>
    formatRating(this.rating(), this.i18n.language()),
  );
  protected readonly name = computed(() =>
    this.rating() === undefined
      ? this.i18n.t('shell.gauge.none')
      : this.i18n.t('shell.gauge.rating', { value: this.text() }),
  );
}
