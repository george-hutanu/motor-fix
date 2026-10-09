import {
  afterNextRender,
  Component,
  inject,
  RESPONSE_INIT,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  I18n,
  isLanguage,
  LanguageSwitch,
  TranslatePipe,
} from '@motor-fix/i18n';

@Component({
  imports: [LanguageSwitch, RouterLink, TranslatePipe],
  selector: 'mf-not-found',
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
    // (registered earlier, so it runs first).
    const [first] = inject(ActivatedRoute).snapshot.url;
    if (first && isLanguage(first.path)) return;
    const i18n = inject(I18n);
    afterNextRender(() => void i18n.use('ro'));
  }
}
