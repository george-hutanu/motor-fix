import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { VerificationStageStatus } from '@motor-fix/contracts';
import { TranslatePipe } from '@motor-fix/i18n';

const KEY = 'public.verificationStatus.';

// How far along each status is: the number of stages it lights.
const REACHED: Record<VerificationStageStatus, number> = {
  approved: 3,
  draft: 0,
  in_review: 2,
  more_requested: 2,
  rejected: 2,
  submitted: 1,
};

const SECOND: Partial<Record<VerificationStageStatus, string>> = {
  more_requested: `${KEY}moreRequested`,
  rejected: `${KEY}rejected`,
};

// The three stages a listing goes through on its way to the map, lit by its
// verification status; what a request for more or a rejection says sits
// under the second.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-verification-stages',
  styleUrl: './verification-stages.css',
  templateUrl: './verification-stages.html',
})
export class VerificationStages {
  readonly status = input.required<VerificationStageStatus>();
  readonly requestedItems = input<readonly string[]>([]);
  readonly reason = input<{ code: string; note: string } | null>(null);

  protected readonly stages = computed(() => {
    const status = this.status();
    const reached = REACHED[status];
    return [
      `${KEY}submitted`,
      SECOND[status] ?? `${KEY}inReview`,
      `${KEY}approved`,
    ].map((name, i) => ({
      current: i === reached - 1,
      lit: i < reached,
      name,
    }));
  });
  protected readonly items = computed(() =>
    this.status() === 'more_requested'
      ? this.requestedItems().map((code) => `${KEY}items.${code}`)
      : [],
  );
  protected readonly rejection = computed(() => {
    const reason = this.reason();
    return this.status() === 'rejected' && reason
      ? { name: `${KEY}items.${reason.code}`, note: reason.note }
      : null;
  });
  protected readonly offMap = computed(() => this.status() !== 'approved');
}
