import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { linksTo } from '../garage-sections';
import { Session } from '../session';

// A Panou section's one heading: the link to its full view while the person's
// menu holds that view, its text alone otherwise.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  selector: 'mf-section-title',
  styleUrl: './section-title.css',
  templateUrl: './section-title.html',
})
export class SectionTitle {
  readonly heading = input.required<string>();
  readonly view = input.required<string>();
  private readonly session = inject(Session);
  protected readonly href = computed(() =>
    linksTo(this.session.shown(), this.view())
      ? `/app/garage/${this.view()}`
      : null,
  );
}
