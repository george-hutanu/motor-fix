import { _IdGenerator } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  Directive,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Chart } from 'chart.js';

import {
  type ChartPoint,
  type ChartType,
  type ChartUnit,
  chartConfig,
  formatValue,
  readTheme,
} from './chart-config';
import { HlmButton } from './helm/button';
import { HlmTableImports } from './helm/table';
import { Panel } from './panel';

@Directive()
abstract class CockpitChart {
  protected abstract readonly type: ChartType;

  readonly title = input.required<string>();
  readonly points = input<readonly ChartPoint[]>([]);
  readonly unit = input.required<ChartUnit>();
  readonly loading = input(false, { transform: booleanAttribute });
  readonly error = input(false, { transform: booleanAttribute });
  readonly retry = output<void>();

  private readonly i18n = inject(I18n);
  private readonly document = inject(DOCUMENT);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly scheme = signal(0);
  private chart?: Chart<ChartType, number[], string>;

  protected readonly tableId = inject(_IdGenerator).getId('mf-chart-table-');
  protected readonly tableShown = signal(false);

  protected readonly rows = computed(() =>
    this.points().map((p) => ({
      label: p.label,
      value: formatValue(this.unit(), p.value, this.i18n.language()),
    })),
  );

  protected readonly summary = computed(() => {
    const points = this.points();
    const language = this.i18n.language();
    const finite = points.filter((p) => Number.isFinite(p.value));
    const byValue = [...finite].sort((a, b) => b.value - a.value);
    const [high, low] = [byValue[0], byValue.at(-1)];
    const first = points[0]?.label ?? '';
    const last = points.at(-1)?.label ?? '';
    const value = (p?: ChartPoint) =>
      formatValue(this.unit(), p?.value, language);
    return this.i18n.t('shell.chart.summary', {
      high: value(high),
      highLabel: high?.label ?? '',
      low: value(low),
      lowLabel: low?.label ?? '',
      period: first === last ? first : `${first} – ${last}`,
      title: this.title(),
    });
  });

  constructor() {
    afterRenderEffect(() => {
      this.scheme();
      const canvas = this.canvas()?.nativeElement;
      if (this.chart && this.chart.canvas !== canvas) this.destroyChart();
      if (!canvas) return;
      const config = chartConfig(
        this.type,
        this.points(),
        this.unit(),
        this.i18n.language(),
        readTheme(canvas),
        matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
      if (!this.chart) {
        this.chart = new Chart(canvas, config);
        return;
      }
      this.chart.data = config.data;
      this.chart.options = config.options ?? {};
      this.chart.update('none');
    });

    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.destroyChart());

    afterNextRender(() => {
      const schemeQuery = matchMedia('(prefers-color-scheme: light)');
      const redraw = () => this.scheme.update((n) => n + 1);
      const tapOutside = (event: Event) => {
        if (!this.chart || event.target === this.chart.canvas) return;
        this.chart.setActiveElements([]);
        this.chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        this.chart.update('none');
      };
      schemeQuery.addEventListener('change', redraw);
      this.document.addEventListener('pointerdown', tapOutside);
      destroyRef.onDestroy(() => {
        schemeQuery.removeEventListener('change', redraw);
        this.document.removeEventListener('pointerdown', tapOutside);
      });
    });
  }

  private destroyChart() {
    this.chart?.destroy();
    this.chart = undefined;
  }
}

const template = `
  <mf-panel [heading]="title()">
    <div class="mf-chart" [attr.aria-busy]="loading() || null">
      @if (loading()) {
        <div class="mf-chart-skeleton" aria-hidden="true"></div>
      } @else if (error()) {
        <div class="mf-chart-message">
          <button hlmBtn variant="secondary" (click)="retry.emit()">
            {{ 'shell.chart.retry' | t }}
          </button>
        </div>
      } @else if (points().length === 0) {
        <p class="mf-chart-message">{{ 'shell.chart.empty' | t }}</p>
      } @else {
        <div class="mf-chart-plot">
          <canvas #canvas role="img" [attr.aria-label]="summary()"></canvas>
        </div>
        <button
          hlmBtn
          variant="ghost"
          [attr.aria-controls]="tableId"
          [attr.aria-expanded]="tableShown()"
          (click)="tableShown.set(!tableShown())"
        >
          {{ 'shell.chart.table' | t }}
        </button>
        @if (tableShown()) {
          <table hlmTable [id]="tableId">
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col">{{ 'shell.chart.label' | t }}</th>
                <th hlmTh scope="col">{{ 'shell.chart.value' | t }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of rows(); track $index) {
                <tr hlmTr>
                  <td hlmTd>{{ row.label }}</td>
                  <td hlmTd>{{ row.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    </div>
  </mf-panel>
`;

const styles = `
  .mf-chart {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-3);
    justify-items: start;
  }
  .mf-chart-plot,
  .mf-chart-skeleton,
  .mf-chart-message {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 200px;
  }
  .mf-chart-skeleton {
    background: var(--mf-panel-raised);
    border-radius: var(--mf-radius-control);
  }
  .mf-chart-message {
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--mf-text-secondary);
  }
  :host {
    display: block;
    min-width: 0;
  }
  canvas {
    display: block;
    max-width: 100%;
  }
`;

const imports = [HlmButton, HlmTableImports, Panel, TranslatePipe];

@Component({ imports, selector: 'mf-bar-chart', styles, template })
export class BarChart extends CockpitChart {
  protected readonly type = 'bar';
}

@Component({ imports, selector: 'mf-line-chart', styles, template })
export class LineChart extends CockpitChart {
  protected readonly type = 'line';
}
