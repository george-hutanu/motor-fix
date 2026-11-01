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
// menu holds that view, its text alone otherwise or with no view named.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  selector: 'mf-section-title',
  styleUrl: './section-title.css',
  templateUrl: './section-title.html',
})
export class SectionTitle {
  readonly heading = input.required<string>();
  readonly view = input<string>();
  private readonly session = inject(Session);
  protected readonly href = computed(() => {
    const view = this.view();
    return view && linksTo(this.session.shown(), view)
      ? `/app/garage/${view}`
      : null;
  });
}
