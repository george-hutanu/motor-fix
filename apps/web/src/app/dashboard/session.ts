import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { type Language, LanguageChoice } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

type SignOut = 'device' | 'everywhere';

// A sign-out the server has not answered yet, sent again when it can be.
const PENDING = 'mf-sign-out-pending';
const CHANNEL = 'mf-session';

// No answer, or an outage: the server may not have ended the session.
const unanswered = (error: unknown) =>
  !(error instanceof HttpErrorResponse) ||
  error.status === 0 ||
  error.status >= 500;

function pending(): SignOut | null {
  try {
    const value = localStorage.getItem(PENDING);
    return value === 'device' || value === 'everywhere' ? value : null;
  } catch {
    return null;
  }
}

function keepPending(kind: SignOut | null) {
  try {
    if (kind) localStorage.setItem(PENDING, kind);
    else localStorage.removeItem(PENDING);
  } catch {
    // No storage: the sign-out is simply not sent again.
  }
}

// The signed-in account. The access token lives in this object's memory only;
// the refresh token is a cookie the page cannot read, used to renew it.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly me = inject(MeService);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageChoice);
  readonly current = signal<MeDto | null>(null);
  // The session ended in another tab of this browser.
  readonly ended = new Subject<void>();
  private readonly tabs: BroadcastChannel | null = null;
  private accessToken: string | null = null;
  private loading: Promise<MeDto | null> | null = null;
  private renewing: Promise<boolean> | null = null;
  // Bumped at sign-out, so an answer that arrives later restores nothing.
  private generation = 0;
  // Bumped when the cookie starts a new session.
  private starts = 0;

  // The language last tapped, and the save sending it, one at a time.
  private wanted: Language | null = null;
  private saving: Promise<void> | null = null;

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      if (typeof BroadcastChannel === 'function') {
        this.tabs = new BroadcastChannel(CHANNEL);
        this.tabs.onmessage = () => {
          this.drop();
          this.ended.next();
        };
      }
      window.addEventListener('online', () => void this.sendPending());
    }
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
    await this.sendPending();
    const { accessToken } = await this.auth.authControllerSignIn({
      body: { email, password, remember },
    });
    this.started(accessToken);
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
    await this.sendPending();
    const { accessToken } = await this.auth.authControllerSignUp({
      body: { email, language, name, password },
    });
    this.started(accessToken);
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

  // This device, every tab of this browser.
  signOut(): Promise<void> {
    return this.end('device');
  }

  // Every session of the account, on every device.
  signOutEverywhere(): Promise<void> {
    return this.end('everywhere');
  }

  // Signed out here at once, whatever the server answers.
  private async end(kind: SignOut) {
    this.drop();
    this.tabs?.postMessage('signed-out');
    await this.send(kind);
  }

  private async send(kind: SignOut) {
    const starts = this.starts;
    let left: SignOut | null = null;
    try {
      await (kind === 'device'
        ? this.auth.authControllerSignOut()
        : this.auth.authControllerSignOutEverywhere());
    } catch (error) {
      if (unanswered(error)) left = kind;
    }
    // A session started meanwhile: what is left was for the old cookie.
    if (starts === this.starts) keepPending(left);
  }

  // The cookie now holds the new session: an old sign-out must never reach it.
  private started(accessToken: string) {
    this.accessToken = accessToken;
    this.starts++;
    keepPending(null);
  }

  // Before the cookie starts a session, so it never ends a new one.
  private async sendPending() {
    const kind = pending();
    if (kind) await this.send(kind);
  }

  private drop() {
    this.generation++;
    this.loading = null;
    this.renewing = null;
    this.forget();
  }

  private async ask(): Promise<MeDto | null> {
    await this.sendPending();
    if (!this.accessToken && !(await this.renew())) return null;
    return this.me.meControllerMe().catch(() => null);
  }

  private forget() {
    this.accessToken = null;
    this.current.set(null);
  }

  // Signed out, a tap stays on the device. A failed save is sent again at the
  // next tap; an answer for an account no longer signed in is dropped.
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
      const now = this.current();
      if (now?.id !== saved.id) return;
      // Signed in again meanwhile, the reload brought the old language back.
      if (now !== me) void this.language.choose(saved.language);
      this.current.set(saved);
      me = saved;
    }
  }
}
