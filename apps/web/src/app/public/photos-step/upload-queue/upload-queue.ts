import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { PHOTOS_MAX } from '@motor-fix/contracts/listing-photos';

const DATABASE = 'mf-uploads';
const STORE = 'photos';

// A photo waiting to reach its draft from this browser.
export interface QueuedPhoto {
  // `<draftId>/<position>`
  id: string;
  draftId: string;
  // Pick order within the draft; drained ascending.
  position: number;
  file: File;
  // The incoming key once its upload landed: only the confirm is left.
  key?: string;
  // Removed by the owner while its confirm was on its way.
  removed?: boolean;
}

type Change = Partial<Pick<QueuedPhoto, 'key' | 'removed'>>;

// IndexedDB holds bytes, not a File: Safari has lost Blobs stored there.
interface Stored extends Omit<QueuedPhoto, 'file'> {
  bytes: ArrayBuffer;
  name: string;
  type: string;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore(STORE, { keyPath: 'id' })
          .createIndex('draftId', 'draftId');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const answer = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Settles once the transaction commits: a quota failure aborts it at commit,
// after its requests already succeeded.
const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new DOMException('aborted', 'AbortError'));
  });

const at = (draftId: string, file: File, position: number): QueuedPhoto => ({
  draftId,
  file,
  id: `${draftId}/${position}`,
  position,
});

const fromStored = ({ bytes, name, type, ...rest }: Stored): QueuedPhoto => ({
  ...rest,
  file: new File([bytes], name, { type }),
});

// Photos picked on the listing photos step, kept until their confirm
// succeeds. IndexedDB keeps them across a reload; a browser that refuses it
// keeps them in memory for as long as the page is open.
@Injectable({ providedIn: 'root' })
export class UploadQueue {
  private readonly database = isPlatformBrowser(inject(PLATFORM_ID))
    ? openDatabase()
    : Promise.resolve(null);
  private readonly memory = new Map<string, QueuedPhoto>();
  private last: Promise<unknown> = Promise.resolve();

  add(draftId: string, files: File[]): Promise<QueuedPhoto[]> {
    return this.serial(async () => {
      const db = await this.database;
      let position = ((await this.read(draftId)).at(-1)?.position ?? -1) + 1;
      const added: QueuedPhoto[] = [];
      // Another tab of the draft may have taken a position: try the next,
      // and give the rest of the pick up once a draft's worth were taken.
      let taken = 0;
      for (const file of files) {
        let entry = at(draftId, file, position);
        while (!(await this.write(entry, db, true))) {
          if (++taken >= PHOTOS_MAX) return added;
          entry = at(draftId, file, ++position);
        }
        added.push(entry);
        position++;
      }
      return added;
    });
  }

  forDraft(draftId: string): Promise<QueuedPhoto[]> {
    return this.serial(() => this.read(draftId));
  }

  update(id: string, change: Change): Promise<void> {
    return this.serial(async () => {
      const db = await this.database;
      const entry = await this.one(id, db);
      if (entry) await this.write({ ...entry, ...change }, db);
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      this.memory.delete(id);
      const db = await this.database;
      try {
        if (db) await answer(this.store(db, 'readwrite').delete(id));
      } catch {
        // Gone with the store; nothing left to forget.
      }
    });
  }

  // One operation at a time, so positions only grow and a read sees every
  // write made before it.
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.last.then(op, op);
    this.last = next.catch(() => undefined);
    return next;
  }

  private async read(draftId: string): Promise<QueuedPhoto[]> {
    const db = await this.database;
    let stored: Stored[] = [];
    try {
      if (db) {
        stored = await answer(
          this.store(db, 'readonly').index('draftId').getAll(draftId),
        );
      }
    } catch {
      // Read what memory holds.
    }
    // A change the store refused lives in memory, over its stale row.
    return [
      ...stored.filter((s) => !this.memory.has(s.id)).map(fromStored),
      ...[...this.memory.values()].filter((e) => e.draftId === draftId),
    ].sort((a, b) => a.position - b.position);
  }

  private async one(
    id: string,
    db: IDBDatabase | null,
  ): Promise<QueuedPhoto | undefined> {
    const held = this.memory.get(id);
    if (held) return held;
    try {
      if (db) {
        const stored = await answer<Stored | undefined>(
          this.store(db, 'readonly').get(id),
        );
        if (stored) return fromStored(stored);
      }
    } catch {
      // Gone with the store.
    }
    return undefined;
  }

  // Without a browser store, synchronously into memory. A `fresh` entry
  // never overwrites one: false says its id is taken.
  private async write(
    entry: QueuedPhoto,
    db: IDBDatabase | null,
    fresh = false,
  ): Promise<boolean> {
    try {
      if (db) {
        const { file, ...rest } = entry;
        const bytes = await file.arrayBuffer();
        const value: Stored = {
          ...rest,
          bytes,
          name: file.name,
          type: file.type,
        };
        const tx = db.transaction(STORE, 'readwrite');
        const done = committed(tx);
        const store = tx.objectStore(STORE);
        const request = fresh ? store.add(value) : store.put(value);
        // A refused request aborts the transaction too: report its error.
        await Promise.all([answer(request), done]);
        this.memory.delete(entry.id);
        return true;
      }
    } catch (error) {
      if ((error as DOMException | null)?.name === 'ConstraintError') {
        return false;
      }
      // Quota or a closed store: keep it for the page instead.
    }
    if (fresh && this.memory.has(entry.id)) return false;
    this.memory.set(entry.id, entry);
    return true;
  }

  private store(db: IDBDatabase, mode: IDBTransactionMode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }
}
