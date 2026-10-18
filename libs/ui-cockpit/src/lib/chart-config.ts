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
  // A second figure drawn before the value, as its own lighter bar.
  readonly lead?: number;
}
// The names of the two figures when a point carries a lead.
export interface ChartHeadings {
  readonly leadHeading: string;
  readonly valueHeading: string;
}
// A category's label: its name, or its name over both figures.
type ChartLabel = string | string[];
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

// The lead's bar: the value's amber at half strength.
function leadDataset(
  type: ChartType,
  values: number[],
  theme: ChartTheme,
): ChartDataset<ChartType, number[]> {
  const amber = color(theme.amber);
  const fill = amber.valid ? amber.alpha(0.5).rgbString() : theme.amber;
  return {
    ...dataset(type, values, theme),
    backgroundColor: fill,
    hoverBackgroundColor: fill,
  };
}

// Chart.js gives a side axis at most half the plot's width and clips a name
// wider than that at the panel's edge; 16 characters of 12 px text stay well
// inside half of a 320 px phone's panel. A word longer than that is cut.
const LINE_CHARS = 16;

export function nameLines(label: string): string[] {
  if (label.length <= LINE_CHARS) return [label];
  const words = label
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(
      (word) => word.match(new RegExp(`.{1,${LINE_CHARS}}`, 'gu')) ?? [],
    );
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= LINE_CHARS)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length ? lines : [label];
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
  // With a lead on the points: two bars per category, both figures as text.
  headings?: ChartHeadings,
): ChartConfiguration<ChartType, number[], ChartLabel> {
  const format = (value: unknown) => formatValue(unit, value, language);
  const lead = points.some((p) => p.lead !== undefined) ? headings : undefined;
  const value = dataset(
    type,
    points.map((p) => p.value),
    theme,
  );
  const datasets = lead
    ? [
        {
          ...leadDataset(
            type,
            points.map((p) => p.lead ?? 0),
            theme,
          ),
          label: lead.leadHeading,
        },
        { ...value, label: lead.valueHeading },
      ]
    : [value];
  // Down the side a long name wraps; upright, it stays one string.
  const name = (label: string) => (horizontal ? nameLines(label) : [label]);
  const labels: ChartLabel[] = lead
    ? points.map((p) => [
        ...name(p.label),
        `${lead.leadHeading} ${format(p.lead ?? 0)}`,
        `${lead.valueHeading} ${format(p.value)}`,
      ])
    : points.map((p) => {
        const lines = name(p.label);
        return lines.length > 1 ? lines : p.label;
      });
  const ticks = {
    color: theme.textSecondary,
    font: { family: theme.font, size: theme.labelSize },
  };
  const [categoryAxis, valueAxis] = horizontal
    ? (['y', 'x'] as const)
    : (['x', 'y'] as const);
  return {
    data: { datasets, labels },
    options: {
      animation: reducedMotion
        ? false
        : { duration: 1000, easing: 'easeOutQuart' },
      ...(horizontal && { indexAxis: 'y' as const }),
      // A lead's tooltip shows both bars of the category under its name.
      interaction: {
        axis: categoryAxis,
        intersect: false,
        mode: lead ? 'index' : 'nearest',
      },
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: theme.text,
          bodyColor: theme.bg,
          bodyFont: { family: theme.font, size: theme.labelSize, weight: 600 },
          callbacks: {
            label: (item: TooltipItem<ChartType>) =>
              `${lead ? item.dataset.label : (points[item.dataIndex]?.label ?? item.label)} · ${format(item.raw)}`,
            title: (items: TooltipItem<ChartType>[]) =>
              lead ? (points[items[0]?.dataIndex]?.label ?? '') : '',
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
