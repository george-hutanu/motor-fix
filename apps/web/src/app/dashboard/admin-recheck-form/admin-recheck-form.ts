import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RECHECK_DETAIL_MAX } from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type RecheckDueRowDto,
  type RecordRecheckDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

export interface AdminRecheckFormData {
  row: RecheckDueRowDto;
  // The list's Bucharest day: the date checked defaults to it and goes no
  // later.
  today: string;
}

type Choice = 'ok' | NonNullable<RecordRecheckDto['failure']>;
// The control a refusal names, marked as invalid.
type Field = 'checkedOn' | 'activities' | 'detail';

const CHOICES: readonly Choice[] = ['ok', 'expired', 'suspended', 'withdrawn'];

// One garage's monthly look-up in the RAR register, recorded: the result,
// the day it was checked and, when valid, the activities the authorisation
// still covers (the garage's own, which it can only narrow). A failure takes
// what the register shows and a second step, since it suspends the garage.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-admin-recheck-form',
  styleUrl: './admin-recheck-form.css',
  templateUrl: './admin-recheck-form.html',
})
export class AdminRecheckForm {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    AdminRecheckFormData,
    'recorded' | 'cancelled'
  >();

  protected readonly row = this.task.data.row;
  protected readonly today = this.task.data.today;
  protected readonly detailMax = RECHECK_DETAIL_MAX;
  protected readonly choices = computed(() => {
    this.i18n.language();
    return CHOICES.map((choice) => ({
      choice,
      label: this.i18n.t(`admin.rechecks.results.${choice}`),
    }));
  });

  protected readonly chosen = signal<Choice | null>(null);
  protected readonly checkedOn = signal(this.today);
  protected readonly ticked = signal(new Set(this.row.activities));
  protected readonly detail = signal('');
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<{
    field: Field | null;
    text: string;
  } | null>(null);

  protected readonly failure = computed(() => {
    const chosen = this.chosen();
    return chosen && chosen !== 'ok' ? chosen : null;
  });
  // Code points after trimming, as the server counts them.
  protected readonly count = computed(() => [...this.detail().trim()].length);
  protected readonly detailFits = computed(
    () => this.count() > 0 && this.count() <= RECHECK_DETAIL_MAX,
  );
  protected readonly activities = computed(() => {
    const en = this.i18n.language() === 'en';
    return this.row.activityNames.map((a) => ({
      code: a.code,
      name: en ? a.nameEn : a.nameRo,
    }));
  });

  protected faulty(field: Field) {
    return this.error()?.field === field;
  }

  protected choose(choice: Choice) {
    this.chosen.set(choice);
    this.error.set(null);
  }

  protected typedDate(event: Event) {
    this.checkedOn.set((event.target as HTMLInputElement).value);
  }

  protected typedDetail(event: Event) {
    this.detail.set((event.target as HTMLTextAreaElement).value);
  }

  protected toggle(code: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.ticked.update((all) => {
      const next = new Set(all);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  // The register opens in its own tab as any link does; the RAR number goes
  // to the clipboard beside it, quietly when there is none to copy.
  async copy() {
    const clipboard = globalThis.navigator?.clipboard;
    if (!this.row.rarNumber || !clipboard) return;
    try {
      await clipboard.writeText(this.row.rarNumber);
      toast(this.i18n.t('admin.file.register.rarCopied'));
    } catch {
      // The tab still opens; the admin types the number there.
    }
  }

  async submit(event: Event) {
    event.preventDefault();
    const chosen = this.chosen();
    if (!chosen) return;
    if (chosen === 'ok') {
      await this.send({
        activities: this.row.activities.filter((code) =>
          this.ticked().has(code),
        ),
        checkedOn: this.checkedOn(),
        lastCheckedOn: this.row.lastCheckedOn,
        result: 'ok',
      });
      return;
    }
    if (!this.detailFits()) return;
    if (!this.confirming()) {
      this.confirming.set(true);
      return;
    }
    await this.send({
      checkedOn: this.checkedOn(),
      detail: this.detail().trim(),
      failure: chosen,
      lastCheckedOn: this.row.lastCheckedOn,
      result: 'failed',
    });
  }

  private async send(body: RecordRecheckDto) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.recheckControllerRecord({
        body,
        id: this.row.garageId,
      });
      this.task.markUnchanged();
      this.task.close('recorded');
    } catch (error) {
      // The refusal is shown on the form, what was entered kept.
      this.confirming.set(false);
      this.error.set({
        field: fieldOf(error),
        text: toProblem(error).detail ?? this.i18n.t('admin.rechecks.failed'),
      });
    } finally {
      this.busy.set(false);
    }
  }
}

// The one control the server's refusal names, when the form has it.
function fieldOf(error: unknown): Field | null {
  const field =
    error instanceof HttpErrorResponse
      ? (error.error as { field?: unknown } | null)?.field
      : undefined;
  return field === 'checkedOn' || field === 'activities' || field === 'detail'
    ? field
    : null;
}
