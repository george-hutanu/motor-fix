// Its own entry point: chart.js registers its pieces when first imported, a
// side effect the main entry would carry into the first page's bundle.
export { BarChart, LineChart } from './lib/chart';
export type { ChartPoint, ChartUnit } from './lib/chart-config';
