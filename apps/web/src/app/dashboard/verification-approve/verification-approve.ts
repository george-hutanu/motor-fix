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

export type VerificationApproveResult = OverlayResult<{ note?: string }>;

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
  // Shown once a confirm without the note it needs was pressed.
  protected readonly refused = signal(false);
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
    if (this.note().trim()) this.refused.set(false);
  }

  protected confirm(event: Event) {
    event.preventDefault();
    const note = this.note().trim();
    if (this.required && !note) {
      this.refused.set(true);
      return;
    }
    this.task.close(note ? { note } : {});
  }
}
