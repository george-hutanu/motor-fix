import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  REJECTION_NOTE_MIN,
  VERIFICATION_NOTE_MAX,
  VERIFICATION_REASON_CODES,
  type VerificationReasonCode,
} from '@motor-fix/contracts/verification-target';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

export type VerificationRejectRefusal =
  | 'reasonRequired'
  | 'noteRequired'
  | 'noteTooShort'
  | 'noteTooLong';

// What the dialog opens with: nothing on a first open, or the values the
// server refused and why, when the drawer asks again.
export interface VerificationRejectData {
  reason?: VerificationReasonCode;
  note?: string;
  refused?: VerificationRejectRefusal;
}

export interface VerificationRejection {
  reason: VerificationReasonCode;
  note: string;
}

// "Respinge dosarul": one of the five reasons and the message the garage
// reads. Closes with both (the note trimmed), or "cancelled"; the drawer
// that opened it sends the decision.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The note takes the input's look without HlmInput, whose brain directive
  // writes its own aria-invalid over the one this dialog sets on open.
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-verification-reject',
  styleUrl: './verification-reject.css',
  templateUrl: './verification-reject.html',
})
export class VerificationReject {
  protected readonly task = injectOverlayTask<
    VerificationRejectData,
    OverlayResult<VerificationRejection>
  >();
  private readonly injector = inject(Injector);
  private readonly group =
    viewChild.required<ElementRef<HTMLFieldSetElement>>('group');
  private readonly field =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  protected readonly options = VERIFICATION_REASON_CODES.map((code) => ({
    code,
    label: `admin.file.reject.reasons.${code}`,
  }));
  protected readonly reason = signal<VerificationReasonCode | null>(
    this.task.data.reason ?? null,
  );
  protected readonly note = signal(this.task.data.note ?? '');
  // Why the last confirm was refused; cleared once that field is fixed.
  protected readonly refused = signal<VerificationRejectRefusal | null>(
    this.task.data.refused ?? null,
  );
  protected readonly reasonRefused = computed(
    () => this.refused() === 'reasonRequired',
  );
  protected readonly noteRefused = computed(
    () => !!this.refused() && this.refused() !== 'reasonRequired',
  );
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.note()].length);

  constructor() {
    // The read phase runs after the panel has placed its own first focus.
    afterNextRender(
      { read: () => this.focus(this.refused()) },
      { injector: this.injector },
    );
  }

  protected pick(code: VerificationReasonCode) {
    this.reason.set(code);
    if (this.reasonRefused()) this.refused.set(this.problem());
  }

  protected input(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
    if (this.noteRefused()) this.refused.set(this.problem());
  }

  protected confirm(event: Event) {
    event.preventDefault();
    const problem = this.problem();
    const reason = this.reason();
    if (problem || !reason) {
      this.refused.set(problem);
      afterNextRender(() => this.focus(problem), { injector: this.injector });
      return;
    }
    this.task.close({ note: this.note().trim(), reason });
  }

  private problem(): VerificationRejectRefusal | null {
    if (!this.reason()) return 'reasonRequired';
    const length = [...this.note().trim()].length;
    if (!length) return 'noteRequired';
    if (length < REJECTION_NOTE_MIN) return 'noteTooShort';
    return length > VERIFICATION_NOTE_MAX ? 'noteTooLong' : null;
  }

  // The note when it is the field refused, else the chosen reason, or the
  // first one when none is chosen yet.
  private focus(refused: VerificationRejectRefusal | null) {
    if (refused && refused !== 'reasonRequired') {
      this.field().nativeElement.focus();
      return;
    }
    const group = this.group().nativeElement;
    (
      group.querySelector<HTMLInputElement>('input:checked') ??
      group.querySelector<HTMLInputElement>('input')
    )?.focus();
  }
}
