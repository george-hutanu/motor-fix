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
  DOCUMENT_REFUSAL_NOTE_MAX,
  DOCUMENT_REFUSAL_REASONS,
  type DocumentRefusalReason,
} from '@motor-fix/contracts/legal-documents';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

type Refusal = 'reasonRequired' | 'noteRequired' | 'noteTooLong';

// The document's name, as the drawer shows it.
export interface DocumentRefuseData {
  document: string;
}

export interface DocumentRefusal {
  reason: DocumentRefusalReason;
  note: string;
}

// "Refuză documentul": one of the two reasons and the note the garage reads,
// for one yearly document. Closes with both (the note trimmed), or
// "cancelled"; the drawer that opened it sends the refusal.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-document-refuse',
  styleUrl: './document-refuse.css',
  templateUrl: './document-refuse.html',
})
export class DocumentRefuse {
  protected readonly task = injectOverlayTask<
    DocumentRefuseData,
    OverlayResult<DocumentRefusal>
  >();
  private readonly injector = inject(Injector);
  private readonly group =
    viewChild.required<ElementRef<HTMLFieldSetElement>>('group');
  private readonly field =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  protected readonly options = DOCUMENT_REFUSAL_REASONS.map((code) => ({
    code,
    label: `admin.file.documents.reasons.${code}`,
  }));
  protected readonly reason = signal<DocumentRefusalReason | null>(null);
  protected readonly note = signal('');
  // Why the last confirm was refused; cleared once that field is fixed.
  protected readonly refused = signal<Refusal | null>(null);
  protected readonly reasonRefused = computed(
    () => this.refused() === 'reasonRequired',
  );
  protected readonly noteRefused = computed(
    () => !!this.refused() && this.refused() !== 'reasonRequired',
  );
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.note()].length);

  protected pick(code: DocumentRefusalReason) {
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

  private problem(): Refusal | null {
    if (!this.reason()) return 'reasonRequired';
    const length = [...this.note().trim()].length;
    if (!length) return 'noteRequired';
    return length > DOCUMENT_REFUSAL_NOTE_MAX ? 'noteTooLong' : null;
  }

  private focus(refused: Refusal | null) {
    if (refused && refused !== 'reasonRequired') {
      this.field().nativeElement.focus();
      return;
    }
    this.group()
      .nativeElement.querySelector<HTMLInputElement>('input')
      ?.focus();
  }
}
