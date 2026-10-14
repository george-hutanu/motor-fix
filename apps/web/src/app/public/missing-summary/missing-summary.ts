import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { FieldProblem } from '@motor-fix/contracts';
import { stepOf } from '@motor-fix/contracts/listing-check';
import { TranslatePipe } from '@motor-fix/i18n';

import { textKey } from '../listing-check-texts';
import { STEPS } from '../steps';

// What the summary tells: what is missing, that all is there, that the check
// could not be made, or nothing before sending is asked for.
export type SummaryState = 'missing' | 'complete' | 'failed' | null;

// Above the send button: what still stops the listing from going out,
// grouped by step, each thing a button to its field.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-missing-summary',
  styleUrl: './missing-summary.css',
  templateUrl: './missing-summary.html',
})
export class MissingSummary {
  readonly errors = input<readonly FieldProblem[]>([]);
  readonly state = input<SummaryState>(null);
  // A mobile mechanic's place reads as the registered seat.
  readonly mobile = input(false);
  readonly goTo = output<string>();

  protected readonly groups = computed(() => {
    const mobile = this.mobile();
    const items = this.errors().map((problem) => ({
      field: problem.field,
      key: textKey(problem, mobile),
      step: stepOf(problem.field),
    }));
    return STEPS.map((step) => ({
      items: items.filter((item) => item.step === step.n),
      step,
    })).filter((group) => group.items.length > 0);
  });
  // The title counts what the list shows, never a field no step holds.
  protected readonly count = computed(() =>
    this.groups().reduce((sum, group) => sum + group.items.length, 0),
  );
}
