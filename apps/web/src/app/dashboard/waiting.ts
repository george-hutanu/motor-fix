import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  effect,
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { I18n } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { firstValueFrom } from 'rxjs';

import { Live } from './live';
import { Session } from './session';

// The workshop actions that may be made without signal and sent later.
export type WaitingKind = 'job.step' | 'job.stage' | 'job.eta';

export interface WaitingRequest {
  method: 'POST' | 'PATCH' | 'PUT';
  url: string;
  body: unknown;
}

interface Stored extends WaitingRequest {
  key: string;
  account: string;
  kind: WaitingKind;
  madeAt: number;
  seq: number;
}

export interface WaitingAction extends Stored {
  state: 'waiting' | 'sent';
}

const DATABASE = 'motor-fix';
const STORE = 'waiting';
const EXPIRES_AFTER = 24 * 3_600_000;
const RETRY_AFTER = 60_000;

// Answers that say nothing about the action itself: it is sent again later.
// A 401 that the app's renewal could not fix ends the session, and the
// sign-out drops the actions.
const kept = (status: number) =>
  status === 0 ||
  status === 401 ||
  status === 408 ||
  status === 429 ||
  status >= 500;

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Actions made in the workshop, kept on the device until the API has them:
// sent in the order they were made, one at a time, each with its own
// Idempotency-Key so a repeat is never applied twice.
@Injectable({ providedIn: 'root' })
export class Waiting {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  // IndexedDB keeps the actions across a reload; without it they last the tab.
  private readonly database = this.browser
    ? openDatabase()
    : Promise.resolve(null);
  private readonly memory = signal<ReadonlyMap<string, Stored>>(new Map());
  private readonly sending = signal<string | null>(null);
  private account: string | null = null;
  private flushing = false;
  private again = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  // The account's stored actions are read before a new one joins them.
  private loaded: Promise<void> = Promise.resolve();

  // The signed-in account's actions, oldest first.
  readonly actions = computed<readonly WaitingAction[]>(() =>
    [...this.memory().values()]
      .filter((a) => a.account === this.session.current()?.id)
      .sort((a, b) => a.madeAt - b.madeAt || a.seq - b.seq)
      .map((a) => ({
        ...a,
        state: a.key === this.sending() ? 'sent' : 'waiting',
      })),
  );

  constructor() {
    effect(() => {
      const id = this.session.current()?.id ?? null;
      untracked(() => {
        this.loaded = this.signedIn(id);
      });
    });
    effect(() => {
      if (this.live.state() === 'open') untracked(() => void this.flush());
    });
    if (!this.browser) return;
    const online = () => void this.flush();
    window.addEventListener('online', online);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      clearTimeout(this.retry);
    });
  }

  // Keeps the action and sends it as soon as it can; resolves to its key.
  async add(kind: WaitingKind, request: WaitingRequest): Promise<string> {
    await this.loaded;
    const account = this.session.current()?.id;
    if (!account) throw new Error('No account is signed in');
    const seq = Math.max(0, ...this.actions().map((a) => a.seq)) + 1;
    const action: Stored = {
      ...request,
      account,
      key: crypto.randomUUID(),
      kind,
      madeAt: Date.now(),
      seq,
    };
    this.keep(action);
    await this.write((store) => store.put(action));
    void this.flush();
    return action.key;
  }

  // For an action that may not wait: false, with a message, while offline.
  connected(): boolean {
    if (globalThis.navigator?.onLine !== false && !this.live.offline())
      return true;
    toast(this.i18n.t('shell.live.needsConnection'));
    return false;
  }

  private async signedIn(id: string | null) {
    const before = this.account;
    this.account = id;
    if (before && before !== id && id === null) await this.dropAll(before);
    if (!id) return;
    const stored = await this.readAll();
    const next = new Map(this.memory());
    for (const action of stored)
      if (action.account === id) next.set(action.key, action);
    this.memory.set(next);
    await this.flush();
  }

  // One flush at a time; an action that gets no answer stops it, so none
  // overtakes it, and it is tried again 60 s later or when the network is back.
  private async flush() {
    if (this.flushing) {
      this.again = true;
      return;
    }
    this.flushing = true;
    try {
      let stalled = false;
      do {
        this.again = false;
        stalled = await this.sendAll();
      } while (this.again && !stalled);
    } finally {
      this.flushing = false;
    }
  }

  private async sendAll(): Promise<boolean> {
    clearTimeout(this.retry);
    for (;;) {
      const next = this.actions()[0];
      if (!next || next.account !== this.account) return false;
      if (Date.now() - next.madeAt > EXPIRES_AFTER) {
        await this.drop(next.key);
        toast(this.i18n.t('shell.live.expired'));
        continue;
      }
      if (!(await this.send(next))) {
        this.retry = setTimeout(() => void this.flush(), RETRY_AFTER);
        return true;
      }
    }
  }

  // False when the action is kept to be sent again.
  private async send(action: Stored): Promise<boolean> {
    this.sending.set(action.key);
    try {
      await firstValueFrom(
        this.http.request(action.method, action.url, {
          body: action.body,
          headers: { 'Idempotency-Key': action.key },
        }),
      );
      await this.drop(action.key);
      return true;
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (kept(status)) return false;
      await this.drop(action.key);
      toast(toProblem(error).detail ?? this.refused(status));
      this.live.catchUp();
      return true;
    } finally {
      this.sending.set(null);
    }
  }

  private refused(status: number) {
    if (status === 409) return this.i18n.t('shell.live.refused.changed');
    if (status === 404) return this.i18n.t('shell.live.refused.gone');
    return this.i18n.t('shell.live.refused.other');
  }

  private keep(action: Stored) {
    this.memory.update((all) => new Map(all).set(action.key, action));
  }

  private async drop(key: string) {
    this.memory.update((all) => {
      const next = new Map(all);
      next.delete(key);
      return next;
    });
    await this.write((store) => store.delete(key));
  }

  private async dropAll(account: string) {
    const keys = [
      ...[...this.memory().values()],
      ...(await this.readAll()),
    ].flatMap((a) => (a.account === account ? [a.key] : []));
    for (const key of new Set(keys)) await this.drop(key);
  }

  private async readAll(): Promise<Stored[]> {
    const db = await this.database;
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const request = db
          .transaction(STORE, 'readonly')
          .objectStore(STORE)
          .getAll();
        request.onsuccess = () => resolve(request.result as Stored[]);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  // A write that fails leaves the action in memory for the life of the tab.
  private async write(change: (store: IDBObjectStore) => IDBRequest) {
    const db = await this.database;
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        change(tx.objectStore(STORE));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
