import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  type ApprovalGap,
  VERIFICATION_NOTE_MAX,
} from '@motor-fix/contracts/verification-target';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

export interface VerificationApproveData {
  missing: ApprovalGap[];
}

type VerificationApproveResult = OverlayResult<{ note?: string }>;

// "Aprobă și publică": lists what the approval passes over, and asks for a
// note when anything does. Closes with the note (trimmed, left out when
// blank), or "cancelled"; the drawer that opened it sends the decision.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-verification-approve',
  styleUrl: './verification-approve.css',
  templateUrl: './verification-approve.html',
})
export class VerificationApprove {
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    VerificationApproveData,
    VerificationApproveResult
  >();
  protected readonly max = VERIFICATION_NOTE_MAX;
  protected readonly required = this.task.data.missing.length > 0;

  protected readonly note = signal('');
  // Why the last confirm was refused: the note it needs is missing, or it
  // runs past the limit. Cleared once the note is fixed.
  protected readonly refused = signal<'noteRequired' | 'noteTooLong' | null>(
    null,
  );
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.note()].length);

  protected readonly lines = computed(() => {
    this.i18n.language();
    return this.task.data.missing.map((gap) =>
      'document' in gap
        ? this.i18n.t('admin.file.approve.missingDocument', {
            document: this.i18n.t(
              `public.listing.documents.kinds.${gap.document}.label`,
            ),
          })
        : this.i18n.t('admin.file.approve.missingCheck', {
            label: this.i18n.t(`admin.file.checks.${gap.kind}`),
            result: this.i18n.t(`admin.file.approve.results.${gap.result}`),
          }),
    );
  });

  protected input(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
    if (this.refused() && !this.problem()) this.refused.set(null);
  }

  protected confirm(event: Event) {
    event.preventDefault();
    const problem = this.problem();
    if (problem) {
      this.refused.set(problem);
      return;
    }
    const note = this.note().trim();
    this.task.close(note ? { note } : {});
  }

  private problem() {
    const note = this.note().trim();
    if (this.required && !note) return 'noteRequired';
    return [...note].length > this.max ? 'noteTooLong' : null;
  }
}
