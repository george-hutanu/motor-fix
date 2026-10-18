import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { LegalCheckDto, LegalCheckRowDto } from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

const LAMPS: Record<LegalCheckRowDto['state'], string> = {
  failed: 'red',
  not_run: 'grey',
  ok: 'green',
  warning: 'amber',
};

// "Verificare legală": the four rows of the garage's legal check, each with
// its state in words and colour, or a skeleton while it loads, or the error
// and a retry. It shows what it is given; its host reads and refreshes it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-legal-check-panel',
  styleUrl: './legal-check-panel.css',
  templateUrl: './legal-check-panel.html',
})
export class LegalCheckPanel {
  private readonly i18n = inject(I18n);
  readonly data = input<LegalCheckDto | undefined>();
  readonly loading = input(false);
  readonly failed = input(false);
  readonly retry = output<void>();
  protected readonly skeletons = [1, 2, 3, 4];

  protected readonly rows = computed(() => {
    const data = this.data();
    if (!data) return [];
    return data.rows.map((row) => ({
      checked: this.checked(row),
      detail: this.detail(row, data),
      kind: row.kind,
      label: this.i18n.t(`garage.legal.${row.kind}.label`),
      lamp: LAMPS[row.state],
      state: this.i18n.t(`garage.legal.state.${row.state}`),
    }));
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  private detail(row: LegalCheckRowDto, data: LegalCheckDto): string {
    if (row.missing.length) {
      return row.missing
        .map((kind) => this.i18n.t(`garage.legal.documents.missing.${kind}`))
        .join(' · ');
    }
    if (row.detail) return row.detail;
    switch (row.kind) {
      case 'company':
        return this.i18n.t('garage.legal.company.detail', {
          company: data.companyName,
        });
      case 'caen':
        return this.i18n.t(
          data.isMobile
            ? 'garage.legal.caen.detailMobile'
            : 'garage.legal.caen.detail',
        );
      case 'rar': {
        const en = this.i18n.language() === 'en';
        return data.rarActivities.length
          ? data.rarActivities.map((a) => (en ? a.nameEn : a.nameRo)).join(', ')
          : this.i18n.t('garage.legal.rar.register');
      }
      case 'documents':
        return this.i18n.t('garage.legal.documents.detail');
    }
  }

  private checked(row: LegalCheckRowDto): string {
    if (row.state === 'not_run') return this.i18n.t('garage.legal.notChecked');
    if (row.kind === 'company' || row.kind === 'caen') {
      return this.i18n.t(`garage.legal.${row.kind}.checked`);
    }
    return row.checkedOn
      ? this.i18n.t(`garage.legal.${row.kind}.checkedOn`, {
          day: formatDay(row.checkedOn, this.i18n.language()),
        })
      : this.i18n.t(`garage.legal.${row.kind}.checked`);
  }
}
