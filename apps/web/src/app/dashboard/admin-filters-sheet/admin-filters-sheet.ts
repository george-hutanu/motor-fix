import { Component, computed, inject, signal } from '@angular/core';
import { PERIODS, type Period } from '@motor-fix/contracts/figure-choices';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

export interface FiltersChoice {
  city: string;
  period: Period;
}

export interface FiltersData extends FiltersChoice {
  // Each city with the name to show, "Toată țara" first.
  cities: readonly { key: string; name: string }[];
}

// The phone's filters: the cities above the periods; "Aplică" closes with the
// choice, Escape or the close button with no change.
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-admin-filters-sheet',
  styleUrl: './admin-filters-sheet.css',
  templateUrl: './admin-filters-sheet.html',
})
export class AdminFiltersSheet {
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<FiltersData, FiltersChoice>();
  // The six periods in order, each with its name in the current language.
  protected readonly periods = computed(() =>
    PERIODS.map((key) => ({
      key,
      name: this.i18n.t(`shell.frame.admin.period.${key}`),
    })),
  );
  protected readonly city = signal(this.task.data.city);
  protected readonly period = signal<Period>(this.task.data.period);

  protected apply() {
    this.task.close({ city: this.city(), period: this.period() });
  }
}
