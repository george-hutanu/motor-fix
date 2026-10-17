import { formatKm, formatLei, formatNum, type Language } from '@motor-fix/i18n';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  type ChartDataset,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type ScriptableContext,
  Tooltip,
  type TooltipItem,
} from 'chart.js';
import { color } from 'chart.js/helpers';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

export type ChartType = 'bar' | 'line';
export type ChartUnit = 'lei' | 'km' | 'count';
export interface ChartPoint {
  readonly label: string;
  readonly value: number;
}
interface ChartTheme {
  amber: string;
  bg: string;
  font: string;
  /** The label token in pixels; undefined leaves Chart.js its default. */
  labelSize?: number;
  line: string;
  text: string;
  textSecondary: string;
}

const FORMATS = { count: formatNum, km: formatKm, lei: formatLei } as const;

// Untyped on purpose: a tooltip's raw value and a missing extreme come in too,
// and the shared formats write the dash for anything that is not a number.
export const formatValue = (
  unit: ChartUnit,
  value: unknown,
  language: Language,
) => FORMATS[unit](value, language);

// A canvas cannot read CSS variables, so the chart takes the token values.
export function readTheme(el: Element): ChartTheme {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(`--mf-${name}`).trim();
  const labelSize = Number.parseFloat(token('size-label'));
  return {
    amber: token('amber-ink'),
    bg: token('bg'),
    font: token('font-body'),
    labelSize: Number.isFinite(labelSize) ? labelSize : undefined,
    line: token('line'),
    text: token('text'),
    textSecondary: token('text-secondary'),
  };
}

function dataset(
  type: ChartType,
  values: number[],
  theme: ChartTheme,
): ChartDataset<ChartType, number[]> {
  if (type === 'bar')
    return {
      backgroundColor: theme.amber,
      barThickness: 8,
      borderRadius: 4,
      borderSkipped: 'start',
      data: values,
      hoverBackgroundColor: theme.amber,
    };
  return {
    backgroundColor: ({ chart }: ScriptableContext<'line'>) => {
      const area = chart.chartArea;
      const amber = color(theme.amber);
      if (!area || !amber.valid) return undefined;
      const fade = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      fade.addColorStop(0, amber.alpha(0.25).rgbString());
      fade.addColorStop(1, amber.alpha(0).rgbString());
      return fade;
    },
    borderCapStyle: 'round',
    borderColor: theme.amber,
    borderJoinStyle: 'round',
    borderWidth: 2,
    data: values,
    fill: 'origin',
    pointBackgroundColor: theme.amber,
    pointHoverRadius: 4,
    pointRadius: 0,
  };
}

export function chartConfig(
  type: ChartType,
  points: readonly ChartPoint[],
  unit: ChartUnit,
  language: Language,
  theme: ChartTheme,
  reducedMotion: boolean,
  // Bars running across, one category per row: for long names.
  horizontal = false,
): ChartConfiguration<ChartType, number[], string> {
  const format = (value: unknown) => formatValue(unit, value, language);
  const ticks = {
    color: theme.textSecondary,
    font: { family: theme.font, size: theme.labelSize },
  };
  const [categoryAxis, valueAxis] = horizontal
    ? (['y', 'x'] as const)
    : (['x', 'y'] as const);
  return {
    data: {
      datasets: [
        dataset(
          type,
          points.map((p) => p.value),
          theme,
        ),
      ],
      labels: points.map((p) => p.label),
    },
    options: {
      animation: reducedMotion
        ? false
        : { duration: 1000, easing: 'easeOutQuart' },
      ...(horizontal && { indexAxis: 'y' as const }),
      interaction: { axis: categoryAxis, intersect: false, mode: 'nearest' },
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: theme.text,
          bodyColor: theme.bg,
          bodyFont: { family: theme.font, size: theme.labelSize, weight: 600 },
          callbacks: {
            label: (item: TooltipItem<ChartType>) =>
              `${item.label} · ${format(item.raw)}`,
            title: () => '',
          },
          caretSize: 0,
          cornerRadius: 7,
          displayColors: false,
          padding: { x: 8, y: 5 },
        },
      },
      scales: {
        [categoryAxis]: {
          border: { display: false },
          grid: { display: false },
          ticks: { ...ticks, autoSkip: true, maxRotation: 0, minRotation: 0 },
        },
        [valueAxis]: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: theme.line, drawTicks: false, lineWidth: 1 },
          ticks: {
            ...ticks,
            callback: format,
            maxTicksLimit: 5,
            // A count is whole: no 0,5 request between 0 and 1.
            ...(unit === 'count' && { precision: 0 }),
          },
        },
      },
    },
    type,
  };
}
