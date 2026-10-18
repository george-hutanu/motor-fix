import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { focusMain } from '@motor-fix/overlays';

// The first stop of Tab on every route: it skips the bars and menus to the
// page's main content. The page has a <base href>, so a bare "#main" would
// send the router to "/#main"; the click moves the focus itself instead and
// the href stays for what a link means.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-skip-link',
  styleUrl: './skip-link.css',
  templateUrl: './skip-link.html',
})
export class SkipLink {
  private readonly document = inject(DOCUMENT);

  protected skip(event: Event): void {
    event.preventDefault();
    focusMain(this.document);
  }
}
