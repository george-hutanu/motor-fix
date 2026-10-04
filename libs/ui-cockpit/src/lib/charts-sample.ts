import { Component, computed, inject, signal } from '@angular/core';
import { calendarNames, I18n, TranslatePipe } from '@motor-fix/i18n';

import { BarChart, LineChart } from './chart';

// Sample data, not interface text: spend in bani and new garages per month.
const SPEND = [
  32000, 0, 125000, 48000, 0, 210000, 64000, 0, 93000, 15000, 180000, 52000,
];
const GARAGES = [3, 5, 4, 8, 12, 9, 15, 18, 14, 21, 26, 30];

@Component({
  imports: [BarChart, LineChart, TranslatePipe],
  selector: 'mf-cockpit-charts-sample',
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-space-6);
    }
    :host > * {
      flex: 1 1 380px;
    }
  `,
  template: `
    <mf-bar-chart
      unit="lei"
      [title]="'cockpit.charts.spend' | t"
      [points]="spend()"
    />
    <mf-line-chart
      unit="count"
      [title]="'cockpit.charts.garages' | t"
      [points]="garages()"
    />
    <mf-bar-chart unit="lei" [title]="'cockpit.charts.none' | t" />
    <mf-line-chart unit="count" loading [title]="'cockpit.charts.loading' | t" />
    <mf-bar-chart
      unit="lei"
      [title]="'cockpit.charts.error' | t"
      [error]="failed()"
      [points]="spend()"
      (retry)="failed.set(false)"
    />
  `,
})
export class CockpitChartsSample {
  private readonly i18n = inject(I18n);
  private readonly months = computed(() =>
    calendarNames(this.i18n.language()).months.map(
      (m) => `${m[0].toUpperCase()}${m.slice(1)} 2027`,
    ),
  );
  protected readonly spend = computed(() =>
    this.months().map((label, i) => ({ label, value: SPEND[i] })),
  );
  protected readonly garages = computed(() =>
    this.months().map((label, i) => ({ label, value: GARAGES[i] })),
  );
  protected readonly failed = signal(true);
}
