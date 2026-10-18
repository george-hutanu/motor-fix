import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';

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
      const last = (await this.read(draftId)).at(-1)?.position ?? -1;
      const added = files.map((file, i) => {
        const position = last + 1 + i;
        return { draftId, file, id: `${draftId}/${position}`, position };
      });
      for (const entry of added) await this.write(entry, db);
      return added;
    });
  }

  forDraft(draftId: string): Promise<QueuedPhoto[]> {
    return this.serial(() => this.read(draftId));
  }

  update(id: string, change: Change): Promise<void> {
    return this.serial(async () => {
      const draftId = id.slice(0, id.lastIndexOf('/'));
      const entry = (await this.read(draftId)).find((e) => e.id === id);
      if (entry) await this.write({ ...entry, ...change }, await this.database);
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
    return [
      ...stored.map(fromStored),
      ...[...this.memory.values()].filter((e) => e.draftId === draftId),
    ].sort((a, b) => a.position - b.position);
  }

  // Without a browser store, synchronously into memory.
  private async write(
    entry: QueuedPhoto,
    db: IDBDatabase | null,
  ): Promise<void> {
    try {
      if (db) {
        const { file, ...rest } = entry;
        const bytes = await file.arrayBuffer();
        await answer(
          this.store(db, 'readwrite').put({
            ...rest,
            bytes,
            name: file.name,
            type: file.type,
          } satisfies Stored),
        );
        this.memory.delete(entry.id);
        return;
      }
    } catch {
      // Quota or a closed store: keep it for the page instead.
    }
    this.memory.set(entry.id, entry);
  }

  private store(db: IDBDatabase, mode: IDBTransactionMode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }
}
