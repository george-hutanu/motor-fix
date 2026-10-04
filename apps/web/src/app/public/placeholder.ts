import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@motor-fix/i18n';

// Stands in for the results, garage, mechanic and sign-in screens until they
// are built, so the tab bar has somewhere to lead.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-placeholder',
  styles: `:host { display: block; padding: var(--mf-space-4); }`,
  template: `
    <h1>{{ title | t }}</h1>
    <p>{{ 'public.placeholder.later' | t }}</p>
  `,
})
export class Placeholder {
  // A text key: the workspace check finds every key whole, never assembled.
  protected readonly title: string =
    inject(ActivatedRoute).snapshot.data['title'];
}
