import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  effect,
  Injectable,
  InjectionToken,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  ANALYTICS_CONSENT_MAX_AGE_DAYS,
  ANALYTICS_CONSENT_VERSION,
} from '@motor-fix/contracts/consent';
import {
  type AnalyticsConsentDto,
  ConsentsService,
  type RecordConsentDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { loadPlausible, pageview } from './plausible/plausible';
import { Session } from '../dashboard/session';
import { routeTemplate } from '../telemetry/route-template/route-template';

export const CONSENT_KEY = 'mf_consent';
const MAX_AGE_MS = ANALYTICS_CONSENT_MAX_AGE_DAYS * 86_400_000;

type Decision = RecordConsentDto['decision'];

// The browser's own analytics choice, its only storage before consent.
export interface StoredChoice extends RecordConsentDto {
  // The account the choice was made under or bound to; null for a visitor.
  accountId: string | null;
  // The server has not taken its record yet.
  pending: boolean;
}

// Where page views go; tests stand in for it.
export const ANALYTICS = new InjectionToken<{
  load: (domain: string) => void;
  pageview: (template: string) => void;
}>('ANALYTICS', { factory: () => ({ load: loadPlausible, pageview }) });

// A choice holds under the current text and for less than 365 days.
export function isValid(
  choice: Pick<StoredChoice, 'at' | 'textVersion'> | null,
  now = Date.now(),
): boolean {
  if (!choice || choice.textVersion !== ANALYTICS_CONSENT_VERSION) return false;
  return now - Date.parse(choice.at) < MAX_AGE_MS;
}

function parse(raw: string | null): StoredChoice | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredChoice> | null;
    return value &&
      typeof value.browserConsentId === 'string' &&
      typeof value.at === 'string' &&
      typeof value.decision === 'string' &&
      typeof value.textVersion === 'string'
      ? ({
          accountId: null,
          language: 'ro',
          pending: false,
          ...value,
        } as StoredChoice)
      : null;
  } catch {
    return null;
  }
}

function read(): StoredChoice | null {
  try {
    return parse(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

function write(choice: StoredChoice | null) {
  try {
    if (choice) localStorage.setItem(CONSENT_KEY, JSON.stringify(choice));
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    // No storage: the choice holds for this page only.
  }
}

// A record worth sending again: no answer, an outage or the address limit.
const retryable = (error: unknown) =>
  !(error instanceof HttpErrorResponse) ||
  error.status === 0 ||
  error.status === 429 ||
  error.status >= 500;

const body = (choice: StoredChoice): RecordConsentDto => ({
  at: choice.at,
  browserConsentId: choice.browserConsentId,
  decision: choice.decision,
  language: choice.language,
  textVersion: choice.textVersion,
});

// Asks for analytics consent and runs analytics only under a valid
// "granted": the bar, the cookie settings, the record on the server, the
// account's choice after a sign-in, and the page views. Nothing runs on the
// server, and nothing loads on a page that names no analytics domain.
@Injectable({ providedIn: 'root' })
export class Consent {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly api = inject(ConsentsService);
  private readonly analytics = inject(ANALYTICS);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly domain =
    inject(DOCUMENT)
      .querySelector<HTMLMetaElement>('meta[name="mf-analytics"]')
      ?.content.trim() || null;
  private readonly choice = signal<StoredChoice | null>(null);
  // The bar waits for its texts.
  private readonly ready = signal(false);
  // The account whose choice was last reconciled.
  private reconciled: string | null = null;

  readonly granted = computed(() => {
    const choice = this.choice();
    return isValid(choice) && choice?.decision === 'granted';
  });
  readonly showBar = computed(
    () => this.browser && this.ready() && !isValid(this.choice()),
  );

  constructor() {
    if (!this.browser) return;
    this.choice.set(read());
    void this.i18n.enter('consent').finally(() => this.ready.set(true));
    if (this.choice()?.pending) void this.send(this.choice() as StoredChoice);
    this.start(this.router.navigated);
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.count();
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CONSENT_KEY) return;
      this.choice.set(parse(event.newValue));
      this.start(false);
    });
    effect(() => {
      const account = this.session.current();
      if (!account) {
        this.reconciled = null;
        return;
      }
      if (account.id === this.reconciled) return;
      this.reconciled = account.id;
      untracked(() => void this.reconcile(account.id));
    });
  }

  accept(): Promise<void> {
    return this.choose('granted');
  }

  refuse(): Promise<void> {
    return this.choose('refused');
  }

  // The cookie settings' save: a switch left as it was stores nothing.
  async save(on: boolean): Promise<void> {
    if (on === this.granted()) return;
    await this.choose(on ? 'granted' : 'withdrawn');
  }

  private async choose(decision: Decision) {
    const account = this.session.current()?.id ?? null;
    const choice: StoredChoice = {
      accountId: account,
      at: new Date().toISOString(),
      browserConsentId: this.choice()?.browserConsentId ?? crypto.randomUUID(),
      decision,
      language: this.i18n.language(),
      pending: true,
      textVersion: ANALYTICS_CONSENT_VERSION,
    };
    this.keep(choice);
    this.start(true);
    await this.send(choice);
  }

  // Loads the script under a valid "granted", counting this page when asked.
  private start(countNow: boolean) {
    if (!this.granted() || !this.domain) return;
    this.analytics.load(this.domain);
    if (countNow) this.count();
  }

  private count() {
    if (!this.granted() || !this.domain) return;
    this.analytics.pageview(
      routeTemplate(this.router.routerState.snapshot.root),
    );
  }

  private keep(choice: StoredChoice | null) {
    this.choice.set(choice);
    write(choice);
  }

  // One try; a refusal other than the limit drops the record.
  private async send(choice: StoredChoice) {
    try {
      if (choice.accountId && this.session.current()?.id === choice.accountId)
        await this.api.consentsControllerRecordMine({ body: body(choice) });
      else await this.api.consentsControllerRecord({ body: body(choice) });
      this.settle(choice, false);
    } catch (error) {
      this.settle(choice, retryable(error));
    }
  }

  private settle(choice: StoredChoice, pending: boolean) {
    const now = this.choice();
    if (now?.at !== choice.at || now.decision !== choice.decision) return;
    this.keep({ ...now, pending });
  }

  // The newer of the browser's choice and the account's applies; the
  // browser's goes on the account only when it was made there or by a
  // visitor not yet bound to one.
  private async reconcile(accountId: string) {
    let latest: AnalyticsConsentDto | null;
    try {
      latest = (await this.api.consentsControllerMine()).analytics;
    } catch {
      return;
    }
    const browser = this.choice();
    const own = this.madeBy(browser, accountId);
    if (own && (!latest || Date.parse(own.at) > Date.parse(latest.at))) {
      const bound = { ...own, accountId, pending: true };
      this.keep(bound);
      this.start(false);
      await this.send(bound);
      return;
    }
    if (!latest) {
      // A choice made under another account never applies here.
      if (browser) this.keep(null);
      return;
    }
    this.keep({
      ...latest,
      accountId,
      browserConsentId: browser?.browserConsentId ?? crypto.randomUUID(),
      pending: false,
    });
    this.start(false);
  }

  // The browser's choice when this account or a visitor made it.
  private madeBy(choice: StoredChoice | null, accountId: string) {
    return choice?.accountId === null || choice?.accountId === accountId
      ? choice
      : null;
  }
}
