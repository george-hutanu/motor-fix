import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ListingDraftData } from '@motor-fix/contracts';
import { EMAIL_PATTERN } from '@motor-fix/contracts/email';
import { ListingDraftsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';

import {
  BROWSER_SAVE_MS,
  type BrowserDraft,
  changed,
  confirmed,
  failed,
  fromServer,
  loadPlan,
  readDraft,
  SERVER_SAVE_MS,
  startAgain,
  writeDraft,
} from './draft';

type DraftView = 'form' | 'loading' | 'invalid' | 'sent';
type EmailError = 'emailInvalid' | 'emailNeeded';
type StepKey = keyof NonNullable<ListingDraftData['steps']>;
interface DraftNote {
  key: string;
  params?: Record<string, number>;
}

const TOKEN = 'x-listing-token';
// A refused call either ends the draft on this page or leaves a note.
const VIEW_FOR: Record<number, DraftView> = { 404: 'invalid', 409: 'sent' };
const NOTE_FOR: Record<number, string> = { 0: 'offline', 413: 'tooLarge' };
// The notes a save that went through makes untrue.
const CLEARED_ON_SAVE = new Set(['offline', 'notSaved']);

// The server's rule: trimmed, compared without letter case, 3 to 254 long.
const normal = (email: string) => email.trim().toLowerCase();
const valid = (email: string) =>
  email.length >= 3 && email.length <= 254 && EMAIL_PATTERN.test(email);
const waitNote = (seconds: number): DraftNote => ({
  key: 'linkAlready',
  params: { minutes: Math.ceil(seconds / 60) },
});

// A browser that blocks the site's data throws on the mere access.
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The listing draft behind the page: the browser copy a second after each
// change, the server copy once an e-mail is given, one save in flight and
// the latest change queued behind it.
@Injectable()
export class DraftKeeper {
  private readonly api = inject(ListingDraftsService);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  readonly draft = signal<BrowserDraft>({
    data: {},
    dirty: false,
    language: this.language(),
    savedAt: new Date().toISOString(),
    step: 1,
  });
  readonly view = signal<DraftView>('form');
  readonly note = signal<DraftNote | null>(null);
  readonly emailError = signal<EmailError | null>(null);

  private storage: Storage | null = null;
  private ready = false;
  private serverEmail: string | undefined;
  private nextEmail: string | undefined;
  private manual = false;
  private sending = false;
  private again = false;
  private browserTimer: ReturnType<typeof setTimeout> | undefined;
  private serverTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.browserTimer);
      clearTimeout(this.serverTimer);
      // The server renders the form too, and has no window.
      if (typeof window === 'undefined') return;
      window.removeEventListener('online', this.online);
      window.removeEventListener('offline', this.offline);
    });
  }

  // In the browser only. Resolves the step to open at, if not the first.
  async open(linkToken?: string): Promise<number | null> {
    window.addEventListener('online', this.online);
    window.addEventListener('offline', this.offline);
    this.storage = browserStorage();
    const { blocked, draft } = readDraft(this.storage);
    if (blocked) this.note.set({ key: 'storageBlocked' });
    const plan = loadPlan(draft, linkToken);
    let step: number | null = null;
    if (plan.kind === 'fetch')
      step = await this.fetch(plan.token, plan.keep, linkToken !== undefined);
    else if (plan.kind !== 'empty') {
      this.adopt(plan.draft);
      step = plan.draft.step;
      if (plan.kind === 'push') void this.save();
    }
    this.ready = true;
    return step;
  }

  type(email: string) {
    this.emailError.set(null);
    this.change({ email });
    this.later();
  }

  // One step's section, shaped by that step's story; every save carries the
  // whole data, so the section rides with the rest of the form.
  section(step: StepKey, value: object) {
    const data = this.draft().data as ListingDraftData;
    this.change({ data: { ...data, steps: { ...data.steps, [step]: value } } });
    this.later();
  }

  leaveEmail() {
    const email = this.checked(false);
    if (email === null) return;
    if (!this.draft().draftId) void this.create(email);
    else if (email !== this.serverEmail) {
      this.nextEmail = email;
      void this.save();
    }
  }

  stepTo(step: number) {
    if (!this.ready || step === this.draft().step) return;
    this.change({ step });
    void this.save();
  }

  // The button: the browser copy at once, then the server copy and the link.
  // Answers whether the field needs the focus.
  pressSave(): boolean {
    clearTimeout(this.browserTimer);
    this.write();
    const email = this.checked(true);
    if (email === null) return true;
    if (!this.draft().draftId) {
      void this.create(email);
      return false;
    }
    if (email !== this.serverEmail) this.nextEmail = email;
    this.manual = true;
    void this.save();
    return false;
  }

  // An empty form, no longer tied to the server copy the link lost.
  startAgain(): number {
    this.adopt(startAgain(this.draft()));
    this.write();
    this.note.set(null);
    this.view.set('form');
    return this.draft().step;
  }

  // The typed address as the server keeps it, or null after naming what is
  // wrong with it; an empty field is wrong only when the button asks.
  private checked(needed: boolean): string | null {
    const email = normal(this.draft().email ?? '');
    if (!email) {
      if (needed) this.emailError.set('emailNeeded');
      return null;
    }
    if (valid(email)) return email;
    this.emailError.set('emailInvalid');
    return null;
  }

  private async fetch(
    token: string,
    keep: BrowserDraft | null,
    link: boolean,
  ): Promise<number | null> {
    if (keep) this.adopt(keep);
    if (link) this.view.set('loading');
    try {
      const server = await this.api.listingDraftsControllerCurrent({
        [TOKEN]: token,
      });
      if (server.status === 'submitted') {
        this.view.set('sent');
        return null;
      }
      this.adopt(fromServer(server, token, new Date()));
      this.write();
      this.view.set('form');
      return server.step;
    } catch (error) {
      this.view.set('form');
      this.refused(error);
      return keep?.step ?? null;
    } finally {
      // The key in the address bar would reach whatever the page links to.
      if (link)
        void this.router.navigate([], {
          queryParams: { draft: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
          scroll: 'manual',
        });
    }
  }

  private async create(email: string) {
    if (this.sending) return;
    this.sending = true;
    const sent = this.draft();
    try {
      const saved = await this.api.listingDraftsControllerCreate({
        body: {
          data: sent.data,
          email,
          language: this.language(),
          step: sent.step,
        },
      });
      this.serverEmail = saved.email;
      this.confirm(sent, saved);
    } catch (error) {
      this.fail(error);
    } finally {
      this.sending = false;
      this.next();
    }
  }

  private async save() {
    const sent = this.draft();
    if (!sent.draftId || !sent.token) return;
    if (this.sending) {
      this.again = true;
      return;
    }
    clearTimeout(this.serverTimer);
    this.serverTimer = undefined;
    this.sending = true;
    const { manual, nextEmail: email } = this;
    this.manual = false;
    this.nextEmail = undefined;
    try {
      const saved = await this.api.listingDraftsControllerSave({
        body: {
          data: sent.data,
          language: this.language(),
          step: sent.step,
          ...(email && { email }),
        },
        id: sent.draftId,
        [TOKEN]: sent.token,
      });
      if (email) this.serverEmail = email;
      this.confirm(sent, saved);
      if (manual && !saved.linkSent) await this.sendLink();
    } catch (error) {
      this.nextEmail ??= email;
      this.fail(error);
    } finally {
      this.sending = false;
      this.next();
    }
  }

  private async sendLink() {
    this.note.set({ key: 'saved' });
    const { draftId, token } = this.draft();
    try {
      await this.api.listingDraftsControllerSendLink({
        id: draftId as string,
        [TOKEN]: token as string,
      });
    } catch (error) {
      const problem = toProblem(error);
      if (problem.status === 429 && problem.retryAfterSeconds)
        this.note.set(waitNote(problem.retryAfterSeconds));
      else this.refused(error);
    }
  }

  // Changes made while the save was on its way stay unconfirmed.
  private confirm(
    sent: BrowserDraft,
    saved: {
      id: string;
      linkSent?: boolean;
      retryAfterSeconds?: number;
      token?: string;
    },
  ) {
    const moved = this.draft().savedAt !== sent.savedAt;
    this.draft.update((draft) => ({
      ...confirmed(draft, saved),
      dirty: moved,
    }));
    this.write();
    this.again ||= moved;
    if (saved.linkSent) this.note.set({ key: 'linkSent' });
    else if (saved.retryAfterSeconds)
      this.note.set(waitNote(saved.retryAfterSeconds));
    else if (CLEARED_ON_SAVE.has(this.note()?.key ?? '')) this.note.set(null);
  }

  private fail(error: unknown) {
    this.draft.update(failed);
    this.write();
    this.refused(error);
  }

  private refused(error: unknown) {
    const { status } = toProblem(error);
    const view = VIEW_FOR[status];
    if (view) this.view.set(view);
    else this.note.set({ key: NOTE_FOR[status] ?? 'notSaved' });
  }

  private next() {
    if (!this.again) return;
    this.again = false;
    void this.save();
  }

  private adopt(draft: BrowserDraft) {
    this.draft.set(draft);
    this.serverEmail = draft.draftId ? draft.email : undefined;
  }

  // The server copy at most every five seconds of changes.
  private later() {
    if (this.draft().draftId && !this.serverTimer)
      this.serverTimer = setTimeout(() => {
        this.serverTimer = undefined;
        void this.save();
      }, SERVER_SAVE_MS);
  }

  private change(
    patch: Partial<Pick<BrowserDraft, 'data' | 'email' | 'step'>>,
  ) {
    this.draft.update((draft) => changed(draft, patch, new Date()));
    clearTimeout(this.browserTimer);
    this.browserTimer = setTimeout(() => this.write(), BROWSER_SAVE_MS);
  }

  private write() {
    writeDraft(this.storage, this.draft());
  }

  private language(): 'ro' | 'en' {
    return this.i18n.language() === 'en' ? 'en' : 'ro';
  }

  private readonly online = () => {
    if (this.draft().dirty) void this.save();
  };

  private readonly offline = () => this.note.set({ key: 'offline' });
}
