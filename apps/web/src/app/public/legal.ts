import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { LEGAL_LABELS, LEGAL_TEXTS, type LegalText } from './legal-texts';

// The terms of use or the privacy notice, whole, rendered on the server and
// open to anyone: the sign-up tick links here in a new tab.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'mf-legal',
  styles: `
    :host { display: block; padding: var(--mf-space-4); }
    article { display: grid; gap: var(--mf-space-3); max-width: 42rem; }
    h1, h2, p { margin: 0; overflow-wrap: anywhere; }
    h2 { margin-top: var(--mf-space-3); }
    .meta { color: var(--mf-text-secondary); }
    .draft { padding: var(--mf-space-3); border-radius: var(--mf-radius-control); background: var(--mf-amber-tint); }
  `,
  template: `
    <article>
      <h1>{{ document().title }}</h1>
      <p class="meta">{{ labels().version }} {{ document().version }}</p>
      <p class="draft" role="note">{{ labels().draft }}</p>
      @for (section of document().sections; track section.heading) {
        <h2>{{ section.heading }}</h2>
        @for (paragraph of section.paragraphs; track $index) {
          <p>{{ paragraph }}</p>
        }
      }
    </article>
  `,
})
export class Legal {
  private readonly language = inject(I18n).language;
  private readonly text: LegalText =
    inject(ActivatedRoute).snapshot.data['text'];

  protected readonly document = computed(
    () => LEGAL_TEXTS[this.language()][this.text],
  );
  protected readonly labels = computed(() => LEGAL_LABELS[this.language()]);
}
