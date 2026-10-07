import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, computed, inject, signal } from '@angular/core';
import { type AdminGrowthDto, AdminService } from '@motor-fix/data-access';
import { calendarNames, formatNum, I18n } from '@motor-fix/i18n';
import { LineChart } from '@motor-fix/ui-cockpit';

const FIGURES = ['activeDrivers', 'garagesListed'] as const;

@Component({
  imports: [LineChart],
  selector: 'mf-admin-growth',
  styleUrl: './admin-growth.css',
  templateUrl: './admin-growth.html',
})
export class AdminGrowth {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly headingId = inject(_IdGenerator).getId('mf-growth-');

  protected readonly answer = signal<AdminGrowthDto | undefined>(undefined);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly title = computed(() => this.i18n.t('admin.growth.title'));

  private readonly names = computed(() => calendarNames(this.i18n.language()));

  protected readonly range = computed(() => {
    const months = this.answer()?.months ?? [];
    if (!months.length) return '';
    const { monthsShort } = this.names();
    const short = ({ month: m }: { month: string }) => {
      const [year, month] = m.split('-');
      return `${monthsShort[Number(month) - 1]} ${year}`;
    };
    return `${short(months[0])} – ${short(months[months.length - 1])}`;
  });

  protected readonly charts = computed(() => {
    const months = this.answer()?.months ?? [];
    const { months: full } = this.names();
    const language = this.i18n.language();
    return FIGURES.map((key) => {
      const points = months.map(({ month, [key]: value }) => {
        const [year, m] = month.split('-');
        return { label: `${full[Number(m) - 1]} ${year}`, value: value ?? NaN };
      });
      // Only the live month counted: nothing to draw a line through yet.
      const past = points.slice(0, -1).some((p) => !Number.isNaN(p.value));
      return {
        key,
        latest: formatNum(months.at(-1)?.[key], language),
        points: past ? points : [],
        title: this.i18n.t(`admin.panel.${key}`),
      };
    });
  });

  constructor() {
    void this.i18n.enter('admin');
    void this.read();
  }

  protected async read() {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.answer.set(await this.api.adminOverviewControllerGrowth());
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
