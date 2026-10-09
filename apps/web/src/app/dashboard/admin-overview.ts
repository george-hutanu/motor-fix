import { HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, inject, signal } from '@angular/core';
import { CITY_ALL, type Period } from '@motor-fix/contracts/figure-choices';
import {
  type AdminOverviewControllerOverview$Params,
  type AdminOverviewDto,
  AdminService,
} from '@motor-fix/data-access';

import { liveResource } from './live';

interface Choice {
  readonly city: string;
  readonly period: Period;
}

const keyOf = ({ city, period }: Choice) => `${city}|${period}`;
const paramsOf = ({
  city,
  period,
}: Choice): AdminOverviewControllerOverview$Params => ({
  ...(city !== CITY_ALL && { city }),
  ...(period !== 'default' && { period }),
});

// The server knows no such city: it has no listed garage any more.
const unknownCity = (failure: unknown) =>
  failure instanceof HttpErrorResponse &&
  failure.status === 400 &&
  Array.isArray(failure.error?.errors) &&
  failure.error.errors.some(
    (e: { field?: string } | null) => e?.field === 'city',
  );

// The admin header's, menu's and panel's numbers for the chosen city and
// period, kept current by the files' events.
@Injectable()
export class AdminOverview {
  private readonly api = inject(AdminService);
  private readonly choice = signal<Choice>({
    city: CITY_ALL,
    period: 'default',
  });
  private readonly unknown = signal(false);
  readonly city = computed(() => this.choice().city);
  readonly period = computed(() => this.choice().period);
  // The chosen city was refused and the whole country is shown instead.
  readonly fellBack = this.unknown.asReadonly();

  private readonly overview = liveResource(
    () => this.read(),
    ['verification.submitted', 'verification.decided', 'verification.reopened'],
  );

  readonly loading = this.overview.isLoading;
  readonly failed = this.overview.failed;
  // The answer to the current choice; an older one is never shown.
  private readonly current = computed(() => {
    const value = this.overview.value();
    if (this.failed() || !value) return undefined;
    return value.key === keyOf(this.choice()) ? value.answer : undefined;
  });
  // The choice changed and its figures are being read.
  readonly figuresLoading = computed(
    () =>
      !this.loading() &&
      !this.failed() &&
      this.overview.value() !== undefined &&
      this.current() === undefined,
  );
  // A count that may be stale is not shown: no number beats a wrong one.
  // The menu's counter is the platform's, whatever the choice.
  readonly waiting = computed(() =>
    this.failed() ? undefined : this.overview.value()?.answer.garagesWaiting,
  );
  // The header's: the chosen city's, or the platform's for the whole country.
  readonly headerWaiting = computed(() =>
    this.city() === CITY_ALL
      ? this.waiting()
      : this.current()?.cityGaragesWaiting,
  );
  readonly cities = computed(() => this.overview.value()?.answer.cities ?? []);
  readonly figures = computed(() => {
    const value = this.current();
    if (!value) return undefined;
    return {
      activeDrivers: value.activeDrivers,
      activeDriversMonthStart: value.activeDriversMonthStart,
      activeDriversPeriodStart: value.activeDriversPeriodStart,
      garagesApprovedInPeriod: value.garagesApprovedInPeriod,
      garagesApprovedThisMonth: value.garagesApprovedThisMonth,
      garagesListed: value.garagesListed,
      period: this.period(),
    };
  });

  // Reads the figures for this city and period; the same choice reads nothing.
  choose(city: string, period: Period) {
    const next = { city, period };
    if (keyOf(next) === keyOf(this.choice())) return;
    this.unknown.set(false);
    this.choice.set(next);
    this.overview.reload();
  }

  private async read(): Promise<{ key: string; answer: AdminOverviewDto }> {
    const choice = this.choice();
    try {
      const answer = await this.api.adminOverviewControllerOverview(
        paramsOf(choice),
      );
      return { answer, key: keyOf(choice) };
    } catch (failure) {
      if (choice.city === CITY_ALL || !unknownCity(failure)) throw failure;
      this.unknown.set(true);
      this.choice.set({ city: CITY_ALL, period: choice.period });
      return this.read();
    }
  }
}
