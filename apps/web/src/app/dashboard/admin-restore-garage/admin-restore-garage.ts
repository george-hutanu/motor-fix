import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SUSPENSION_LIFT_NOTE_MAX } from '@motor-fix/contracts/suspension-limits';
import { AdminService, type RestoreGarageDto } from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

export type RestoreCause =
  | 'admin'
  | 'documents_overdue'
  | 'recheck_failed'
  | 'report_confirmed';

// How the dialog ended: put back, given up, or found already moved (the
// list or the file reads again).
export type RestoreResult = 'restored' | 'cancelled' | 'stale';

export interface AdminRestoreGarageData {
  // The garage's current RAR activities, pre-ticked for the re-check.
  activities: readonly { code: string; nameEn: string; nameRo: string }[];
  cause: RestoreCause;
  // The yearly documents' cycle reads `due`; null when the opener does not
  // know (the list), the server then judging alone.
  documentsDue: boolean | null;
  fromTime: string | null;
  garageId: string;
  name: string;
  rarVerdict: string | null;
  reason: string | null;
  // The Bucharest day: the re-check's date defaults to it and goes no later.
  today: string;
}

type Field = 'checkedOn' | 'activities' | 'note';

// The codes after which the garage is no longer the one the admin opened.
const STALE = new Set(['garage_already_restored', 'garage_not_suspended']);
const NOTE_REQUIRED = new Set<RestoreCause>(['admin', 'report_confirmed']);

// "suspendat · <why>", as the suspended list reads a row.
export function suspensionState(
  i18n: I18n,
  cause: RestoreCause | null | undefined,
  rarVerdict: string | null | undefined,
) {
  if (!cause) return i18n.t('admin.suspended.alone');
  const text =
    cause === 'recheck_failed'
      ? i18n.t(`admin.suspended.rar.${rarVerdict ?? 'none'}`)
      : i18n.t(`admin.suspended.cause.${cause}`);
  return i18n.t('admin.suspended.state', { text });
}

// Putting a suspended garage back on the map, with the proof its cause
// asks for: a valid RAR re-check recorded here, the yearly documents valid,
// or a note on what was fixed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-admin-restore-garage',
  styleUrl: './admin-restore-garage.css',
  templateUrl: './admin-restore-garage.html',
})
export class AdminRestoreGarage {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    AdminRestoreGarageData,
    RestoreResult
  >();

  protected readonly data = this.task.data;
  protected readonly noteMax = SUSPENSION_LIFT_NOTE_MAX;
  protected readonly recheck = this.data.cause === 'recheck_failed';
  protected readonly documents = this.data.cause === 'documents_overdue';
  protected readonly noteRequired = NOTE_REQUIRED.has(this.data.cause);

  protected readonly checkedOn = signal(this.data.today);
  protected readonly ticked = signal(
    new Set(this.data.activities.map((a) => a.code)),
  );
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly stale = signal(false);
  protected readonly error = signal<{
    field: Field | null;
    text: string;
  } | null>(null);

  protected readonly state = computed(() => {
    this.i18n.language();
    return suspensionState(this.i18n, this.data.cause, this.data.rarVerdict);
  });
  protected readonly since = computed(() =>
    this.data.fromTime
      ? this.i18n.t('admin.suspended.since', {
          date: formatDay(this.data.fromTime, this.i18n.language()),
        })
      : null,
  );
  protected readonly activities = computed(() => {
    const en = this.i18n.language() === 'en';
    return this.data.activities.map((a) => ({
      code: a.code,
      name: en ? a.nameEn : a.nameRo,
    }));
  });
  // Code points after trimming, as the server counts them.
  protected readonly count = computed(() => [...this.note().trim()].length);
  protected readonly ready = computed(() => {
    if (this.count() > SUSPENSION_LIFT_NOTE_MAX) return false;
    if (this.documents && this.data.documentsDue === false) return false;
    if (this.recheck) return this.checkedOn() !== '' && this.ticked().size > 0;
    return true;
  });

  protected faulty(field: Field) {
    return this.error()?.field === field;
  }

  protected typedDate(event: Event) {
    this.checkedOn.set((event.target as HTMLInputElement).value);
  }

  protected typedNote(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
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

  protected close(result: RestoreResult) {
    this.task.markUnchanged();
    this.task.close(result);
  }

  async submit(event: Event) {
    event.preventDefault();
    if (this.busy() || this.stale() || !this.ready()) return;
    const note = this.note().trim();
    if (this.noteRequired && note === '') {
      this.error.set({
        field: 'note',
        text: this.i18n.t('admin.restore.noteRequired'),
      });
      return;
    }
    const body: RestoreGarageDto = {};
    if (note !== '') body.note = note;
    if (this.recheck) {
      body.recheck = {
        activities: this.data.activities
          .map((a) => a.code)
          .filter((code) => this.ticked().has(code)),
        checkedOn: this.checkedOn(),
      };
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.suspensionControllerRestore({
        body,
        id: this.data.garageId,
      });
      this.close('restored');
    } catch (error) {
      this.refused(error);
    } finally {
      this.busy.set(false);
    }
  }

  // A refusal is shown in the dialog, what was entered kept; a lost call or a
  // server failure can be sent again.
  private refused(error: unknown) {
    const problem = toProblem(error);
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 0 || status >= 500 || !problem.detail) {
      this.error.set({
        field: null,
        text: this.i18n.t('admin.restore.failed'),
      });
      return;
    }
    if (STALE.has(problem.code)) this.stale.set(true);
    this.error.set({ field: fieldOf(error), text: problem.detail });
  }
}

// The one control the server's refusal names, when the dialog has it.
function fieldOf(error: unknown): Field | null {
  const field =
    error instanceof HttpErrorResponse
      ? (error.error as { field?: unknown } | null)?.field
      : undefined;
  return field === 'checkedOn' || field === 'activities' || field === 'note'
    ? field
    : null;
}
