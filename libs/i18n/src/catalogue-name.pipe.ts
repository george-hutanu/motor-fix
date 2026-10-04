import { inject, Pipe, PipeTransform } from '@angular/core';

import { I18n } from './i18n';

interface Named {
  name_ro: string;
  name_en?: string | null;
}

// Impure for the same reason as `t`: the language can change under it.
@Pipe({ name: 'catalogueName', pure: false })
export class CatalogueNamePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform({ name_en, name_ro }: Named): string {
    return this.i18n.language() === 'en' && name_en?.trim() ? name_en : name_ro;
  }
}
