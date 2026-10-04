import { Injectable, inject, signal } from '@angular/core';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { type Language, LanguageChoice } from '@motor-fix/i18n';

// The signed-in account. The access token lives in this object's memory only;
// the refresh token is a cookie the page cannot read, used to renew it.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly me = inject(MeService);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageChoice);
  readonly current = signal<MeDto | null>(null);
  private accessToken: string | null = null;
  private loading: Promise<MeDto | null> | null = null;
  private renewing: Promise<boolean> | null = null;
  // Bumped at sign-out, so an answer that arrives later restores nothing.
  private generation = 0;

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

  token(): string | null {
    return this.accessToken;
  }

  async signIn(email: string, password: string, remember: boolean) {
    const { accessToken } = await this.auth.authControllerSignIn({
      body: { email, password, remember },
    });
    this.accessToken = accessToken;
    this.current.set(null);
    return this.load();
  }

  // A new driver account, signed in as a sign-in would be.
  async signUp(
    name: string,
    email: string,
    password: string,
    language: 'ro' | 'en',
  ) {
    const { accessToken } = await this.auth.authControllerSignUp({
      body: { email, language, name, password },
    });
    this.accessToken = accessToken;
    this.current.set(null);
    return this.load();
  }

  // One renewal at a time, whoever asks.
  renew(): Promise<boolean> {
    if (this.renewing) return this.renewing;
    const generation = this.generation;
    const renewing: Promise<boolean> = this.auth
      .authControllerRefresh()
      .then(
        (answer) => {
          if (generation !== this.generation) return false;
          if (typeof answer?.accessToken !== 'string' || !answer.accessToken) {
            this.forget();
            return false;
          }
          this.accessToken = answer.accessToken;
          return true;
        },
        () => {
          if (generation === this.generation) this.forget();
          return false;
        },
      )
      .finally(() => {
        if (this.renewing === renewing) this.renewing = null;
      });
    this.renewing = renewing;
    return renewing;
  }

  async load(): Promise<MeDto | null> {
    const known = this.current();
    if (known) return known;
    if (this.loading) return this.loading;
    const generation = this.generation;
    const loading: Promise<MeDto | null> = this.ask().then((answer) => {
      if (this.loading === loading) this.loading = null;
      // An answer that arrives after a sign-out restores nothing.
      if (generation !== this.generation) return null;
      // At sign-in the account's language wins over the device's.
      if (answer) void this.language.choose(answer.language);
      this.current.set(answer);
      return answer;
    });
    this.loading = loading;
    return loading;
  }

  async signOut(): Promise<void> {
    this.generation++;
    this.loading = null;
    this.renewing = null;
    this.forget();
    try {
      await this.auth.authControllerSignOut();
    } catch {
      // Signed out here anyway; the server's copy expires on its own.
    }
  }

  private async ask(): Promise<MeDto | null> {
    if (!this.accessToken && !(await this.renew())) return null;
    return this.me.meControllerMe().catch(() => null);
  }

  private forget() {
    this.accessToken = null;
    this.current.set(null);
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
        saved = await this.me.meControllerUpdate({ body: { language: sent } });
      } catch {
        return;
      }
      if (this.current() !== me) return;
      this.current.set(saved);
      me = saved;
    }
  }
}
