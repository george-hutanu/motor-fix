import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  Injectable,
  InjectionToken,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { CURRENT_CONSENT } from '@motor-fix/contracts/consent';
import {
  AuthService,
  type MeDto,
  MeService,
  type OAuthPendingDto,
} from '@motor-fix/data-access';
import { type Language, LanguageChoice } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

type SignOut = 'device' | 'everywhere';
export type Provider = 'google' | 'apple';

// How the page leaves for a provider's sign-in; tests stand in for it.
export const LEAVE = new InjectionToken<(url: string) => void>('LEAVE', {
  factory: () => (url) => location.assign(url),
});

// The screen to come back to after a provider's sign-in, kept in the tab.
const RETURN_TO = 'mf-return-to';

// A sign-out the server has not answered yet, sent again when it can be.
const PENDING = 'mf-sign-out-pending';
const CHANNEL = 'mf-session';

// The role this browser last saw signed in, for the public pages, which never
// ask for the session (each ask renews the cookie). A hint for what they
// show, never for access.
const ROLE = 'mf-role';
const ROLES: readonly string[] = [
  'driver',
  'garage',
  'receptionist',
  'mechanic',
  'admin',
];

// How long a sign-out waits for a language save in flight.
const SAVE_WAIT_MS = 3_000;

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

function storedRole(): MeDto['role'] | null {
  try {
    const value = localStorage.getItem(ROLE);
    return value && ROLES.includes(value) ? (value as MeDto['role']) : null;
  } catch {
    return null;
  }
}

function keepRole(role: MeDto['role'] | null) {
  try {
    if (role) localStorage.setItem(ROLE, role);
    else localStorage.removeItem(ROLE);
  } catch {
    // No storage: a public page shows what it shows a visitor.
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

// The garage of the session, from the person's memberships, never the address.
export const garageOf = (me: MeDto | null) =>
  me?.garageId
    ? (me.garageAccess.find((garage) => garage.garageId === me.garageId) ??
      null)
    : null;

// How long after its own password change a tab ignores the live sign-out.
const KEEP_THROUGH_REVOKE_MS = 30_000;

// The signed-in account. The access token lives in this object's memory only;
// the refresh token is a cookie the page cannot read, used to renew it.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly me = inject(MeService);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageChoice);
  private readonly leave = inject(LEAVE);
  readonly current = signal<MeDto | null>(null);
  // The role this browser last saw signed in, kept across visits.
  readonly roleHint = signal<MeDto['role'] | null>(storedRole());
  // What the screen shows: the session's account, or, while the sign-in gate
  // is open over the screen, the one a failed renewal forgot. Display only:
  // access is decided on current.
  private readonly kept = signal<MeDto | null>(null);
  readonly shown = computed(() => this.current() ?? this.kept());
  // The account the last failed renewal forgot, until a session or a sign-out.
  private lapsed: MeDto | null = null;
  // The session ended in another tab of this browser.
  readonly ended = new Subject<void>();
  private readonly tabs: BroadcastChannel | null = null;
  private accessToken: string | null = null;
  // Until when this tab's own password change keeps it signed in.
  private keepUntil = 0;
  private loading: Promise<MeDto | null> | null = null;
  private renewing: Promise<boolean> | null = null;
  // Bumped at sign-out, so an answer that arrives later restores nothing.
  private generation = 0;
  // The role whose token is held while its account is still loading.
  private switchingTo: MeDto['role'] | null = null;
  // Bumped when the cookie starts a new session.
  private starts = 0;
  // Bumped when a role switch has put its account on screen.
  private switches = 0;

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

  // A code by WhatsApp; the answer is the same whether or not an account
  // holds the number.
  async phoneCode(phone: string, language: 'ro' | 'en') {
    await this.auth.phoneSignInControllerPhoneCode({
      body: { language, phone },
    });
  }

  // 'profile' when no account holds the number: the same code with a name
  // creates one, sending the current consent the form's tick stands for.
  async signInWithPhone(
    phone: string,
    code: string,
    remember: boolean,
    profile?: { name: string; language: 'ro' | 'en' },
  ) {
    await this.sendPending();
    const answer = await this.auth.phoneSignInControllerPhoneSignIn({
      body: {
        code,
        phone,
        remember,
        ...(profile && { consent: CURRENT_CONSENT, ...profile }),
      },
    });
    if (answer.next === 'profile') return 'profile';
    const { accessToken } = answer;
    if (!accessToken) throw new Error('no session opened');
    this.started(accessToken);
    this.current.set(null);
    return this.load();
  }

  // A new driver account, signed in as a sign-in would be. The form calls it
  // only once the consent tick is set, so it sends the current versions.
  async signUp(
    name: string,
    email: string,
    password: string,
    language: 'ro' | 'en',
  ) {
    await this.sendPending();
    const { accessToken } = await this.auth.authControllerSignUp({
      body: { consent: CURRENT_CONSENT, email, language, name, password },
    });
    this.started(accessToken);
    this.current.set(null);
    return this.load();
  }

  // The page leaves for the provider; the server brings it back to
  // /{lang}/sign-in/return with the result.
  async leaveFor(
    provider: Provider,
    choice: {
      language: 'ro' | 'en';
      remember: boolean;
      returnTo?: string | null;
    },
  ) {
    await this.sendPending();
    try {
      // Without one, an address kept by the area guard stays for the return.
      if (choice.returnTo) sessionStorage.setItem(RETURN_TO, choice.returnTo);
    } catch {
      // No storage: the person lands on their role's home instead.
    }
    const query = new URLSearchParams({
      language: choice.language,
      remember: String(choice.remember),
    });
    this.leave(`/api/v1/auth/oauth/${provider}?${query}`);
  }

  // The dashboard address a visitor asked for, opened once they sign in.
  keepReturnTo(url: string) {
    try {
      sessionStorage.setItem(RETURN_TO, url);
    } catch {
      // No storage: the person lands on their role's home instead.
    }
  }

  // The kept screen, once, and only an address of this site.
  takeReturnTo(): string | null {
    try {
      const kept = sessionStorage.getItem(RETURN_TO);
      sessionStorage.removeItem(RETURN_TO);
      return kept && /^\/(?![/\\])/.test(kept) ? kept : null;
    } catch {
      return null;
    }
  }

  // What the provider gave for a new person, or null when nothing waits.
  providerPending(): Promise<OAuthPendingDto | null> {
    return this.auth.oauthControllerPending().catch(() => null);
  }

  // The new person's account, once the consent tick is set.
  async completeProviderSignUp(name: string, language: 'ro' | 'en') {
    const { accessToken } = await this.auth.oauthControllerComplete({
      body: { consent: CURRENT_CONSENT, language, name },
    });
    this.started(accessToken);
    this.current.set(null);
    return this.load();
  }

  // A new password from a reset link: the answer is a session, as sign-in's.
  async resetPassword(token: string, password: string) {
    await this.sendPending();
    const { accessToken } = await this.auth.passwordResetControllerComplete({
      body: { password, token },
    });
    this.started(accessToken);
    this.current.set(null);
    return this.load();
  }

  // A new password from the dashboard. The server then signs out every
  // session but this one, and tells them all live: this tab keeps going
  // through that word while the change is sent and for a while after.
  async changePassword(body: {
    currentPassword?: string;
    newPassword: string;
  }) {
    this.keepUntil = Number.POSITIVE_INFINITY;
    try {
      await this.auth.passwordChangeControllerChange({ body });
      this.keepUntil = Date.now() + KEEP_THROUGH_REVOKE_MS;
    } catch (error) {
      this.keepUntil = 0;
      throw error;
    }
  }

  // Whether a "sessions ended" word is this tab's own password change.
  keepsThroughRevoke(): boolean {
    return Date.now() < this.keepUntil;
  }

  // One renewal at a time, whoever asks.
  renew(): Promise<boolean> {
    if (this.renewing) return this.renewing;
    const generation = this.generation;
    // The role this tab shows, so a switch in another tab leaves it alone.
    const role = this.switchingTo ?? this.current()?.role;
    // A role switch that answers first wins: this answer is for the old role.
    const sent = this.accessToken;
    const replaced = () => this.accessToken !== sent;
    const renewing: Promise<boolean> = this.auth
      .authControllerRefresh({ body: role ? { role } : {} })
      .then(
        (answer) => {
          if (generation !== this.generation) return false;
          if (replaced()) return true;
          if (typeof answer?.accessToken !== 'string' || !answer.accessToken) {
            this.lapse();
            return false;
          }
          this.accessToken = answer.accessToken;
          return true;
        },
        () => {
          if (generation !== this.generation) return false;
          if (replaced()) return true;
          this.lapse();
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
      this.hint(answer?.role ?? null);
      return answer;
    });
    this.loading = loading;
    return loading;
  }

  // What the server now says about the signed-in account; the old answer
  // stays on screen until then, and stays when the server does not answer.
  async reload(): Promise<void> {
    if (!this.current()) return;
    const generation = this.generation;
    // A sign-in or a role switch meanwhile: this answer is for the old one.
    // A renewal is not: the retry after a 401 answers for the same account.
    const { starts, switches } = this;
    // Sent under a switch's token: the switch's own load decides the account,
    // and a failed switch takes that role back.
    const underSwitch = this.switchingTo !== null;
    const answer = await this.me.meControllerMe().catch(() => null);
    if (!answer || underSwitch || generation !== this.generation) return;
    if (starts === this.starts && switches === this.switches) {
      this.current.set(answer);
    }
  }

  // The tab's session in another of the account's roles. A failure leaves the
  // token and the account as they were, and rejects.
  async switchRole(role: MeDto['role']): Promise<MeDto | null> {
    const generation = this.generation;
    const { accessToken } = await this.auth.authControllerSwitchRole({
      body: { role },
    });
    if (generation !== this.generation) return null;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('no access token in the answer');
    }
    const before = this.accessToken;
    this.accessToken = accessToken;
    this.switchingTo = role;
    try {
      const answer = await this.me.meControllerMe();
      if (generation !== this.generation) return null;
      this.switches++;
      this.current.set(answer);
      this.hint(answer.role);
      return answer;
    } catch (error) {
      // The old token still holds the old role for its last minutes.
      if (generation === this.generation) this.accessToken = before;
      throw error;
    } finally {
      this.switchingTo = null;
    }
  }

  // The forgotten account stays on screen until the gate's dialog closes,
  // and is gone for good once it has.
  async keepShownWhile<T>(open: Promise<T>): Promise<T> {
    if (!this.current() && this.lapsed) this.kept.set(this.lapsed);
    try {
      return await open;
    } finally {
      this.lapsed = null;
      this.kept.set(null);
    }
  }

  // This device, every tab of this browser.
  signOut(): Promise<void> {
    return this.end('device');
  }

  // Every session of the account, on every device.
  signOutEverywhere(): Promise<void> {
    return this.end('everywhere');
  }

  // The server already ended this session (session.revoked): forgotten here
  // only. Asking it, or telling the other tabs, could reach a session this
  // browser started since, under the same cookie (a password reset).
  revoked(): void {
    this.drop();
  }

  // Signed out here whatever the server answers. A language save in flight
  // gets to send the language last tapped first, but a save that hangs never
  // keeps the person signed in.
  private async end(kind: SignOut) {
    if (this.saving) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.saving,
        new Promise((resolve) => {
          timer = setTimeout(resolve, SAVE_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
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
    this.lapsed = null;
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
    this.lapsed = null;
    this.kept.set(null);
    this.forget();
    this.hint(null);
  }

  private hint(role: MeDto['role'] | null) {
    this.roleHint.set(role);
    keepRole(role);
  }

  private async ask(): Promise<MeDto | null> {
    await this.sendPending();
    if (!this.accessToken && !(await this.renew())) return null;
    return this.me.meControllerMe().catch(() => null);
  }

  private lapse() {
    this.lapsed = this.current() ?? this.lapsed;
    this.forget();
    this.hint(null);
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
