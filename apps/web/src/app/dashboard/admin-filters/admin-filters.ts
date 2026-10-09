import { Component, computed, inject, input, output } from '@angular/core';
import { PERIODS, type Period } from '@motor-fix/contracts/figure-choices';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  AdminFiltersSheet,
  type FiltersChoice,
  type FiltersData,
} from '../admin-filters-sheet/admin-filters-sheet';

// The admin header's city and period: from 768 px a drop-down and a segmented
// radio group, below it one button opening the same choice in a bottom sheet.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-admin-filters',
  styleUrl: './admin-filters.css',
  templateUrl: './admin-filters.html',
})
export class AdminFilters {
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  // Each city with the name to show, "Toată țara" first.
  readonly cities = input.required<readonly { key: string; name: string }[]>();
  readonly city = input.required<string>();
  readonly period = input.required<Period>();
  readonly choose = output<FiltersChoice>();
  // The six periods in order, each with its name in the current language.
  protected readonly periods = computed(() =>
    PERIODS.map((key) => ({
      key,
      name: this.i18n.t(`shell.frame.admin.period.${key}`),
    })),
  );

  private readonly cityName = computed(
    () => this.cities().find((c) => c.key === this.city())?.name ?? '',
  );
  protected readonly summary = computed(() => ({
    city: this.cityName(),
    period: this.i18n.t(`shell.frame.admin.period.${this.period()}`),
  }));

  protected chooseCity(city: string) {
    this.choose.emit({ city, period: this.period() });
  }

  protected choosePeriod(period: Period) {
    this.choose.emit({ city: this.city(), period });
  }

  protected async openSheet() {
    const chosen = await this.overlays.open<FiltersChoice, FiltersData>(
      AdminFiltersSheet,
      {
        confirmDiscard: false,
        data: {
          cities: this.cities,
          city: this.city(),
          period: this.period(),
        },
        shape: 'dialog',
        title: 'shell.frame.admin.filters.title',
      },
    );
    if (chosen !== 'cancelled') this.choose.emit(chosen);
  }
}
