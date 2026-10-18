import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  REPORT_NOTE_MAX,
  REPORT_REASON_MAX,
} from '@motor-fix/contracts/verification-target';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

export interface ReportDecisionData {
  decision: 'unfounded' | 'confirmed';
}

type ReportDecisionResult = OverlayResult<
  { note?: string } | { reason: string }
>;

const KEY = 'admin.file.reportDecision';

// Asks for the one text a decision on the reports carries. "Sesizare
// nefondată" takes an optional internal note and closes with it trimmed (left
// out when blank); "Sesizare confirmată" waits for the reason the garage will
// see, as its suspension carries it. Either closes as "cancelled" instead;
// the drawer that opened it sends the decision.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-report-decision',
  styleUrl: './report-decision.css',
  templateUrl: './report-decision.html',
})
export class ReportDecision {
  protected readonly task = injectOverlayTask<
    ReportDecisionData,
    ReportDecisionResult
  >();

  protected readonly confirmed = this.task.data?.decision === 'confirmed';
  private readonly max = this.confirmed ? REPORT_REASON_MAX : REPORT_NOTE_MAX;
  protected readonly keys = this.confirmed
    ? {
        count: `${KEY}.reasonCount`,
        label: `${KEY}.reason`,
        submit: `${KEY}.confirmedSubmit`,
        tooLong: `${KEY}.reasonTooLong`,
      }
    : {
        count: `${KEY}.noteCount`,
        label: `${KEY}.note`,
        submit: `${KEY}.unfounded`,
        tooLong: `${KEY}.noteTooLong`,
      };

  protected readonly text = signal('');
  protected readonly tooLong = signal(false);
  protected readonly blank = computed(
    () => this.confirmed && !this.text().trim(),
  );
  // Code points after trimming, as the server counts them: an emoji is one,
  // and the spaces at the ends the limit never reads are not counted.
  protected readonly count = computed(() => [...this.text().trim()].length);

  protected input(event: Event) {
    this.text.set((event.target as HTMLTextAreaElement).value);
    if (this.tooLong() && !this.over()) this.tooLong.set(false);
  }

  protected confirm(event: Event) {
    event.preventDefault();
    if (this.blank()) return;
    if (this.over()) {
      this.tooLong.set(true);
      return;
    }
    const text = this.text().trim();
    if (this.confirmed) this.task.close({ reason: text });
    else this.task.close(text ? { note: text } : {});
  }

  private over() {
    return this.count() > this.max;
  }
}
