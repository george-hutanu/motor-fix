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

export type VerificationMoreRefusal =
  | 'noteRequired'
  | 'noteTooShort'
  | 'noteTooLong';

// What the dialog opens with: nothing on a first open, or what the server
// refused and why, when the drawer asks again.
export interface VerificationMoreData {
  note?: string;
  requestedItems?: VerificationReasonCode[];
  refused?: VerificationMoreRefusal;
}

export interface VerificationMoreRequest {
  note: string;
  requestedItems: VerificationReasonCode[];
}

// "Ce lipsește?": the message the garage reads and, optionally, what it
// concerns. Closes with both (the note trimmed, the ticks in the list's
// order), or "cancelled"; the drawer that opened it sends the request.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The note takes the input's look without HlmInput, whose brain directive
  // writes its own aria-invalid over the one this dialog sets.
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-verification-more',
  styleUrl: './verification-more.css',
  templateUrl: './verification-more.html',
})
export class VerificationMore {
  protected readonly task = injectOverlayTask<
    VerificationMoreData,
    OverlayResult<VerificationMoreRequest>
  >();
  private readonly injector = inject(Injector);
  private readonly field =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  protected readonly options = VERIFICATION_REASON_CODES.map((code) => ({
    code,
    label: `admin.file.more.items.${code}`,
  }));
  protected readonly ticked = signal<ReadonlySet<VerificationReasonCode>>(
    new Set(this.task.data.requestedItems ?? []),
  );
  protected readonly note = signal(this.task.data.note ?? '');
  // Why the last confirm was refused; cleared once the note is fixed.
  protected readonly refused = signal<VerificationMoreRefusal | null>(
    this.task.data.refused ?? null,
  );
  protected readonly refusal = computed(() => {
    const refused = this.refused();
    return refused ? `admin.file.more.${refused}` : null;
  });
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.note().trim()].length);

  constructor() {
    // The read phase runs after the panel has placed its own first focus.
    afterNextRender(
      { read: () => this.field().nativeElement.focus() },
      { injector: this.injector },
    );
  }

  protected toggle(code: VerificationReasonCode, event: Event) {
    const next = new Set(this.ticked());
    if ((event.target as HTMLInputElement).checked) next.add(code);
    else next.delete(code);
    this.ticked.set(next);
  }

  protected input(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
    if (this.refused()) this.refused.set(this.problem());
  }

  protected confirm(event: Event) {
    event.preventDefault();
    const problem = this.problem();
    if (problem) {
      this.refused.set(problem);
      afterNextRender(() => this.field().nativeElement.focus(), {
        injector: this.injector,
      });
      return;
    }
    this.task.close({
      note: this.note().trim(),
      requestedItems: VERIFICATION_REASON_CODES.filter((code) =>
        this.ticked().has(code),
      ),
    });
  }

  private problem(): VerificationMoreRefusal | null {
    const length = this.count();
    if (!length) return 'noteRequired';
    if (length < REJECTION_NOTE_MIN) return 'noteTooShort';
    return length > VERIFICATION_NOTE_MAX ? 'noteTooLong' : null;
  }
}
