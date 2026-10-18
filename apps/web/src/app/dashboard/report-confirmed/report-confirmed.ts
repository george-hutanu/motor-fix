import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { REPORT_REASON_MAX } from '@motor-fix/contracts/verification-target';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

type ReportConfirmedResult = OverlayResult<{ reason: string }>;

// "Sesizare confirmată": asks for the reason the garage will see, as its
// suspension carries it. Closes with the reason (trimmed), or "cancelled";
// the confirm waits for a reason, and the drawer sends the decision.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-report-confirmed',
  styleUrl: './report-confirmed.css',
  templateUrl: './report-confirmed.html',
})
export class ReportConfirmed {
  protected readonly task = injectOverlayTask<unknown, ReportConfirmedResult>();

  protected readonly reason = signal('');
  protected readonly tooLong = signal(false);
  protected readonly blank = computed(() => !this.reason().trim());
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.reason()].length);

  protected input(event: Event) {
    this.reason.set((event.target as HTMLTextAreaElement).value);
    if (this.tooLong() && !this.over()) this.tooLong.set(false);
  }

  protected confirm(event: Event) {
    event.preventDefault();
    if (this.blank()) return;
    if (this.over()) {
      this.tooLong.set(true);
      return;
    }
    this.task.close({ reason: this.reason().trim() });
  }

  private over() {
    return [...this.reason().trim()].length > REPORT_REASON_MAX;
  }
}
