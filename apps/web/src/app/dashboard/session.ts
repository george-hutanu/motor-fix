import { Injectable, inject, signal } from '@angular/core';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';

// The signed-in account, held in memory only. Without an access token the
// answer is 401 and nobody is signed in; setting `current` to null signs out.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(MeService);
  private readonly language = inject(LanguageChoice);
  readonly current = signal<MeDto | null>(null);
  private loading: Promise<MeDto | null> | null = null;

  async load(): Promise<MeDto | null> {
    const known = this.current();
    if (known) return known;
    this.loading ??= this.api
      .meControllerMe()
      .catch(() => null)
      .then((me) => {
        // At sign-in the account's language wins over the device's.
        if (me) void this.language.choose(me.language);
        this.current.set(me);
        this.loading = null;
        return me;
      });
    return this.loading;
  }
}
