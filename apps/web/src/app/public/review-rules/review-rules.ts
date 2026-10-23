import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

// What a review may not say, and how a reported one is decided: public,
// rendered on the server, linked from the review drawer and the footer.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-review-rules',
  styleUrl: './review-rules.css',
  templateUrl: './review-rules.html',
})
export class ReviewRules {
  // Built in code: the template checker takes only literal keys.
  protected readonly rules = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    name: `public.reviewRules.rule.${n}.name`,
    why: `public.reviewRules.rule.${n}.why`,
  }));
}
