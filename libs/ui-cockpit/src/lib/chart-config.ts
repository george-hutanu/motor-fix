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
export interface ChartTheme {
  amber: string;
  bg: string;
  font: string;
  line: string;
  text: string;
  textSecondary: string;
}

const FORMATS = { count: formatNum, km: formatKm, lei: formatLei } as const;

export const formatValue = (
  unit: ChartUnit,
  value: unknown,
  language: Language,
) => FORMATS[unit](value, language);

// A canvas cannot read CSS variables, so the chart takes the token values.
export function readTheme(el: Element): ChartTheme {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(`--mf-${name}`).trim();
  return {
    amber: token('amber-ink'),
    bg: token('bg'),
    font: token('font-body'),
    line: token('line'),
    text: token('text'),
    textSecondary: token('text-secondary'),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
      if (!area) return undefined;
      const fade = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      fade.addColorStop(0, withAlpha(theme.amber, 0.25));
      fade.addColorStop(1, withAlpha(theme.amber, 0));
      return fade;
    },
    borderCapStyle: 'round',
    borderColor: theme.amber,
    borderJoinStyle: 'round',
    borderWidth: 2,
    data: values,
    fill: 'origin',
    pointBackgroundColor: theme.amber,
    pointHitRadius: 22,
    pointHoverRadius: 4,
    pointRadius: 0,
    tension: 0,
  };
}

export function chartConfig(
  type: ChartType,
  points: readonly ChartPoint[],
  unit: ChartUnit,
  language: Language,
  theme: ChartTheme,
  reducedMotion: boolean,
): ChartConfiguration<ChartType, number[], string> {
  const format = (value: unknown) => formatValue(unit, value, language);
  const ticks = {
    color: theme.textSecondary,
    font: { family: theme.font, size: 12 },
  };
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
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
      interaction: { axis: 'x', intersect: false, mode: 'nearest' },
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: theme.text,
          bodyColor: theme.bg,
          bodyFont: { family: theme.font, size: 12, weight: 600 },
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
      responsive: true,
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: { ...ticks, autoSkip: true, maxRotation: 0, minRotation: 0 },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: theme.line, drawTicks: false, lineWidth: 1 },
          ticks: { ...ticks, callback: format, maxTicksLimit: 5 },
        },
      },
    },
    type,
  };
}
