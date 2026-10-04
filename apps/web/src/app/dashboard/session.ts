import { Injectable, inject, signal } from '@angular/core';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';

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

  // One renewal at a time, whoever asks.
  renew(): Promise<boolean> {
    const generation = this.generation;
    this.renewing ??= this.auth
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
          this.forget();
          return false;
        },
      )
      .finally(() => {
        this.renewing = null;
      });
    return this.renewing;
  }

  async load(): Promise<MeDto | null> {
    const known = this.current();
    if (known) return known;
    const generation = this.generation;
    this.loading ??= this.ask().then((answer) => {
      this.loading = null;
      const me = generation === this.generation ? answer : null;
      // At sign-in the account's language wins over the device's.
      if (me) void this.language.choose(me.language);
      this.current.set(me);
      return me;
    });
    return this.loading;
  }

  async signOut(): Promise<void> {
    this.generation++;
    this.forget();
    try {
      await this.auth.authControllerSignOut();
    } catch {
      // Signed out here anyway; the server's copy expires on its own.
    } finally {
      this.forget();
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
}
