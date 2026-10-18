import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { REPORT_NOTE_MAX } from '@motor-fix/contracts/verification-target';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

type ReportUnfoundedResult = OverlayResult<{ note?: string }>;

// "Sesizare nefondată": closes the file's open reports with an optional
// internal note. Closes with the note (trimmed, left out when blank), or
// "cancelled"; the drawer that opened it sends the decision.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-report-unfounded',
  styleUrl: './report-unfounded.css',
  templateUrl: './report-unfounded.html',
})
export class ReportUnfounded {
  protected readonly task = injectOverlayTask<unknown, ReportUnfoundedResult>();

  protected readonly note = signal('');
  protected readonly tooLong = signal(false);
  // Code points, as the server counts them, so an emoji is one.
  protected readonly count = computed(() => [...this.note()].length);

  protected input(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
    if (this.tooLong() && !this.over()) this.tooLong.set(false);
  }

  protected confirm(event: Event) {
    event.preventDefault();
    if (this.over()) {
      this.tooLong.set(true);
      return;
    }
    const note = this.note().trim();
    this.task.close(note ? { note } : {});
  }

  private over() {
    return [...this.note().trim()].length > REPORT_NOTE_MAX;
  }
}
