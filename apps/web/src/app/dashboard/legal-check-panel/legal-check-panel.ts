import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { recheckedSince } from '@motor-fix/contracts/verification-target';
import type { DocumentCycleDto } from '@motor-fix/data-access/models/document-cycle-dto';
import type { LegalCheckDto } from '@motor-fix/data-access/models/legal-check-dto';
import type { LegalCheckRowDto } from '@motor-fix/data-access/models/legal-check-row-dto';
import {
  formatDay,
  formatShortMonthYear,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

const LAMPS: Record<LegalCheckRowDto['state'], string> = {
  failed: 'red',
  not_run: 'grey',
  ok: 'green',
  warning: 'amber',
};

// The calendar day after a YYYY-MM-DD day.
const dayAfter = (day: string) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

// "Verificare legală": the four rows of the garage's legal check, each with
// its state in words and colour, the "Suspendat" tag and the failed re-check
// while the garage is suspended, the yearly documents' cycle and the button
// that asks for their upload, and the note on monthly re-checks; or a
// skeleton while it loads, or the error and a retry. It shows what it is given; its host reads and refreshes it.
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
  readonly upload = output<void>();
  protected readonly skeletons = [1, 2, 3, 4];
  protected readonly canUpload = computed(
    () => this.data()?.documents?.canUpload === true,
  );
  protected readonly suspended = computed(
    () => this.data()?.status === 'suspended',
  );

  protected readonly rows = computed(() => {
    const data = this.data();
    if (!data) return [];
    return data.rows.map((row) => ({
      checked: this.checked(row, data),
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

  private day(value: string | null): string {
    return formatDay(value, this.i18n.language());
  }

  private detail(row: LegalCheckRowDto, data: LegalCheckDto): string {
    // The RAR row stands for the failed re-check that suspended the garage.
    if (row.failure) {
      const said = this.i18n.t(`garage.legal.rar.failure.${row.failure}`, {
        day: this.day(row.checkedOn),
      });
      return row.detail ? `${said} · ${row.detail}` : said;
    }
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
        return this.documentsDetail(data.documents);
    }
  }

  private documentsDetail(cycle: DocumentCycleDto | null): string {
    const said = this.i18n.t('garage.legal.documents.detail');
    return cycle ? `${said} · ${this.cycle(cycle)}` : said;
  }

  private cycle(cycle: DocumentCycleDto): string {
    const key = 'garage.legal.documents.cycle';
    switch (cycle.row) {
      case 'valid':
      case 'due':
        return this.i18n.t(`${key}.renew`, {
          month: formatShortMonthYear(cycle.dueOn, this.i18n.language()),
        });
      case 'in_review':
        return this.i18n.t(`${key}.in_review`);
      case 'overdue':
        return this.i18n.t(`${key}.overdue`, {
          off: this.day(dayAfter(cycle.graceUntil ?? cycle.dueOn)),
          since: this.day(dayAfter(cycle.dueOn)),
        });
      case 'refused':
        return this.i18n.t(`${key}.refused`, {
          note: cycle.refusal?.note ?? '',
        });
    }
  }

  private checked(row: LegalCheckRowDto, data: LegalCheckDto): string {
    if (row.state === 'not_run') return this.i18n.t('garage.legal.notChecked');
    if (row.kind === 'company' || row.kind === 'caen') {
      return this.i18n.t(`garage.legal.${row.kind}.checked`);
    }
    if (!row.checkedOn) return this.i18n.t(`garage.legal.${row.kind}.checked`);
    const rechecked =
      row.kind === 'rar' &&
      (row.failure !== undefined ||
        recheckedSince(data.latestRecheck, data.lastCheckedOn));
    return this.i18n.t(
      rechecked
        ? 'garage.legal.rar.recheckedOn'
        : `garage.legal.${row.kind}.checkedOn`,
      { day: this.day(row.checkedOn) },
    );
  }
}
