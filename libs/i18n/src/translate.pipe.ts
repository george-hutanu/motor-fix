import { inject, Pipe, PipeTransform } from '@angular/core';

import { I18n } from './i18n';

// Impure so the view re-reads the language signal; a pure pipe would cache
// the text for as long as the key stays the same.
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
