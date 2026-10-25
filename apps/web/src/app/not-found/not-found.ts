import {
  afterNextRender,
  Component,
  DestroyRef,
  inject,
  RESPONSE_INIT,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  I18n,
  isLanguage,
  LanguageChoice,
  LanguageSwitch,
  TranslatePipe,
} from '@motor-fix/i18n';

@Component({
  imports: [LanguageSwitch, RouterLink, TranslatePipe],
  selector: 'mf-not-found',
  styleUrl: './not-found.css',
  templateUrl: './not-found.html',
})
export class NotFound {
  constructor() {
    // Only the server render provides it; in the browser there is no status to
    // set. The maintenance page's 503 wins over this one.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response && response.status !== 503) response.status = 404;

    // An address with no known language prefix is Romanian, as the server sent
    // it: undo the remembered language, which is applied after the first render
    // (registered earlier, so it runs first). Nor does another tab's choice move
    // it while it is open. The router reuses this page from one unknown address
    // to the next, so the URL, not the constructor, says when that holds.
    const i18n = inject(I18n);
    const choice = inject(LanguageChoice);
    let release: (() => void) | undefined;
    let rendered = false;
    afterNextRender(() => {
      rendered = true;
      if (release) void i18n.use('ro');
    });
    inject(ActivatedRoute)
      .url.pipe(takeUntilDestroyed())
      .subscribe(([first]) => {
        const unknown = !(first && isLanguage(first.path));
        if (unknown && !release) {
          release = choice.hold();
          if (rendered) void i18n.use('ro');
        } else if (!unknown && release) {
          release();
          release = undefined;
        }
      });
    inject(DestroyRef).onDestroy(() => release?.());
  }
}
