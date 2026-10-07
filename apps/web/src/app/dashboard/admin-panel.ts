import { Component, computed, inject, signal } from '@angular/core';
import { formatNum, I18n } from '@motor-fix/i18n';

import { AdminOverview } from './admin-overview';

type Figures = NonNullable<ReturnType<AdminOverview['figures']>>;

interface Tile {
  label: string;
  state: 'loading' | 'value' | 'failed' | 'soon';
  number?: string;
  line?: string;
  name: string;
}

// The figures with no data behind them yet show "în curând" until their
// stories ship them.
const TILES: readonly { key: string; line?: (f: Figures) => number | null }[] =
  [
    { key: 'garagesListed', line: (f) => f.garagesApprovedThisMonth },
    { key: 'requestsToday' },
    { key: 'answerRate' },
    { key: 'bookings' },
    {
      key: 'activeDrivers',
      line: (f) =>
        f.activeDriversMonthStart === undefined
          ? null
          : f.activeDrivers - f.activeDriversMonthStart,
    },
    { key: 'reportedReviews' },
  ];

const MISSING = '—';

@Component({
  selector: 'mf-admin-panel',
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-space-3);
    }
    @media (min-width: 768px) {
      :host { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (min-width: 1024px) {
      :host { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    }
    [role='group'] {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-2);
      min-width: 0;
      padding: var(--mf-space-4);
      background: var(--mf-panel);
      border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-control);
    }
    .label {
      font-size: var(--mf-size-label);
      color: var(--mf-text-secondary);
      overflow-wrap: anywhere;
    }
    .number {
      display: flex;
      align-items: center;
      gap: var(--mf-space-2);
      min-height: 32px;
      font-family: var(--mf-font-label);
      font-size: clamp(18px, 5vw, 24px);
      color: var(--mf-text);
      overflow-wrap: anywhere;
    }
    .line {
      font-size: var(--mf-size-small);
      color: var(--mf-text-secondary);
      overflow-wrap: anywhere;
    }
    .skeleton {
      display: block;
      height: 1em;
      width: 60%;
      border-radius: var(--mf-radius-chip);
      background: var(--mf-line);
    }
    button {
      display: inline-grid;
      place-items: center;
      min-width: var(--mf-tap);
      min-height: var(--mf-tap);
      padding: 0;
      font: inherit;
      font-size: var(--mf-size-small);
      color: var(--mf-text-secondary);
      background: none;
      border: 0;
      cursor: pointer;
    }
    .tip {
      position: absolute;
      inset: auto var(--mf-space-2) var(--mf-space-2);
      padding: var(--mf-space-2);
      font-size: var(--mf-size-small);
      color: var(--mf-text);
      background: var(--mf-panel-raised);
      border: 1px solid var(--mf-line-strong);
      border-radius: var(--mf-radius-chip);
    }
  `,
  template: `
    @for (tile of tiles(); track tile.label) {
      <div
        role="group"
        [attr.aria-label]="tile.name"
        [attr.aria-busy]="tile.state === 'loading' ? 'true' : null"
      >
        <span class="label">{{ tile.label }}</span>
        @switch (tile.state) {
          @case ('loading') {
            <span class="number"><span class="skeleton"></span></span>
            <span class="line"><span class="skeleton"></span></span>
          }
          @case ('failed') {
            <span class="number">
              {{ tile.number }}
              <button
                type="button"
                [attr.aria-label]="tile.line"
                [attr.aria-expanded]="tip() === tile.label"
                (click)="tip.set(tile.label)"
                (focus)="tip.set(tile.label)"
                (blur)="tip.set(null)"
                (keydown.escape)="tip.set(null)"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" />
                  <path d="M9 8v5M9 5v1" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </button>
            </span>
            <span class="tip" role="tooltip" [hidden]="tip() !== tile.label">{{ tile.line }}</span>
          }
          @default {
            <span class="number">{{ tile.number }}</span>
            @if (tile.line) {
              <span class="line">{{ tile.line }}</span>
            }
          }
        }
      </div>
    }
  `,
})
export class AdminPanel {
  private readonly overview = inject(AdminOverview);
  private readonly i18n = inject(I18n);
  protected readonly tip = signal<string | null>(null);

  protected readonly tiles = computed(() => {
    const figures = this.overview.figures();
    const loading = this.overview.loading() && !this.overview.failed();
    return TILES.map(({ key, line }): Tile => {
      const label = this.t(key);
      if (!line) return this.missing(label, 'soon', this.t('soon'));
      if (figures)
        return this.value(label, figures[key as keyof Figures], line(figures));
      if (loading) return { label, name: label, state: 'loading' };
      return this.missing(label, 'failed', this.t('unavailable'));
    });
  });

  private t(key: string, params?: Record<string, string>) {
    return this.i18n.t(`admin.panel.${key}`, params);
  }

  private missing(label: string, state: 'soon' | 'failed', line: string): Tile {
    const name =
      state === 'soon' ? `${label}, ${line}` : `${label}, ${MISSING}, ${line}`;
    return { label, line, name, number: MISSING, state };
  }

  private value(
    label: string,
    figure: number | undefined,
    change: number | null,
  ): Tile {
    const language = this.i18n.language();
    const number = formatNum(figure, language);
    const line =
      change === null
        ? undefined
        : this.t('thisMonth', {
            n: formatNum(Math.abs(change), language),
            sign: change < 0 ? '−' : '+',
          });
    return {
      label,
      line,
      name: [label, number, line].filter(Boolean).join(', '),
      number,
      state: 'value',
    };
  }

  constructor() {
    void this.i18n.enter('admin');
  }
}
