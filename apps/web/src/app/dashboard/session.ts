import { Injectable, inject, signal } from '@angular/core';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { type Language, LanguageChoice } from '@motor-fix/i18n';

// The signed-in account, held in memory only. Without an access token the
// answer is 401 and nobody is signed in; setting `current` to null signs out.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(MeService);
  private readonly language = inject(LanguageChoice);
  readonly current = signal<MeDto | null>(null);
  private loading: Promise<MeDto | null> | null = null;
  // The language last tapped, and the save sending it, one at a time.
  private wanted: Language | null = null;
  private saving: Promise<void> | null = null;

  constructor() {
    this.language.taps.subscribe((language) => {
      this.wanted = language;
      if (this.saving) return;
      this.saving = this.save().finally(() => {
        this.saving = null;
      });
    });
  }

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

  // Signed out, a tap stays on the device. A failed save is sent again at the
  // next tap; an answer for an account no longer held is dropped.
  private async save() {
    let me = this.current();
    // Ends on the language last sent, whatever the answer says.
    let sent = me?.language;
    while (me && this.wanted && this.wanted !== sent) {
      sent = this.wanted;
      let saved: MeDto;
      try {
        saved = await this.api.meControllerUpdate({ body: { language: sent } });
      } catch {
        return;
      }
      if (this.current() !== me) return;
      this.current.set(saved);
      me = saved;
    }
  }
}
