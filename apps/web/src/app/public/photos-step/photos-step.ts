import {
  CdkDrag,
  type CdkDragDrop,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  Injector,
  inject,
  input,
  model,
  output,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { FILE_RULES } from '@motor-fix/contracts/files';
import type { ListingCheck } from '@motor-fix/contracts/listing-check';
import { PHOTOS_MAX } from '@motor-fix/contracts/listing-photos';
import { ListingDraftsService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { downscale, FileUploader } from '@motor-fix/media';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { defer, map, type Observable } from 'rxjs';

import { type QueuedPhoto, UploadQueue } from './upload-queue/upload-queue';
import { measure } from '../../telemetry/browser/measure/measure';
import { FieldWatch, NO_PROBLEMS } from '../field-watch';

const RULE = FILE_RULES.garage_photo;
const TYPES: readonly string[] = RULE.types;
// A photo just confirmed shows the local file; one restored before its
// copies exist is read again after this long.
const PROCESSING_POLL_MS = 5000;
// Two minutes of reads: a photo still processing by then has failed for
// good, and each read would queue its job again.
const PROCESSING_READS_MAX = 24;
// Sends lost to a dropped connection, per photo and drain, waiting 1, 2, 4
// and 8 s between them; the owner's "Reîncearcă" starts again.
const ATTEMPTS_MAX = 5;
const BACKOFF_MS = 1000;

type Status = 'waiting' | 'uploading' | 'failed' | 'processing' | 'ready';
interface Tile {
  id: number;
  status: Status;
  key?: string;
  file?: File;
  name?: string;
  src?: string;
  progress?: number;
  // The photo's entry in the browser queue, until its confirm lands.
  queueId?: string;
}

type Drain = 'load' | 'online' | 'pick' | 'retry';
type Step = 'next' | 'stop';
type Params = { id: string; 'x-listing-token': string };
type Outcome =
  | { kind: 'landed'; key: string }
  | { kind: 'refused'; full: boolean }
  | { kind: 'gone' | 'dropped' | 'failed' | 'missing' | 'submitted' };

// Step 5 of listing a garage, above the hours: the photos, sent straight to
// storage and confirmed on the draft, the first the cover. It keeps the
// draft's keys in their order and leaves saving them to the page, which
// judges them: a listing without a photo says so once one is removed, or
// when sending is asked for.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:online)': 'online()' },
  imports: [CdkDrag, CdkDropList, HlmButton, TranslatePipe],
  selector: 'mf-photos-step',
  styleUrl: './photos-step.css',
  templateUrl: './photos-step.html',
})
export class PhotosStep {
  readonly draftId = input<string>();
  readonly token = input<string>();
  readonly kind = input<string>();
  readonly files = model<string[]>([]);
  // The page's judgement of this step, and whether sending was asked for.
  readonly problems = input<ListingCheck>(NO_PROBLEMS);
  readonly showAll = input(false);
  // Whether the photos show an error, for the step list's dot.
  readonly shown = output<boolean>();

  private readonly api = inject(ListingDraftsService);
  private readonly uploader = inject(FileUploader);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly queue = inject(UploadQueue);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly tiles = signal<Tile[]>([]);
  protected readonly refused = signal(false);
  protected readonly full = signal(false);
  protected readonly over = signal(false);
  protected readonly announcement = signal<{
    key: 'place' | 'uploaded';
    params: Record<string, number>;
  } | null>(null);
  protected readonly types = TYPES.join(',');
  protected readonly mobile = computed(() => this.kind() === 'mobile');
  protected readonly ready = computed(() => !!this.draftId() && !!this.token());
  // Set by a refused address, cleared by the next upload that lands.
  private readonly failedLately = signal(false);
  protected readonly later = computed(
    () =>
      this.failedLately() &&
      this.tiles().some((tile) => tile.status === 'failed'),
  );
  // Photos still held in this browser, not yet on the draft.
  protected readonly waiting = computed(
    () =>
      this.tiles().filter(
        (tile) =>
          tile.queueId &&
          (tile.status === 'waiting' || tile.status === 'uploading'),
      ).length,
  );

  private readonly watch = new FieldWatch();
  protected readonly message = computed(() =>
    this.watch.message(this.problems(), 'files', {
      all: this.showAll(),
      filled: false,
    }),
  );
  protected readonly failing = computed(() => {
    const message = this.message();
    return !!message && !message.warning;
  });

  private nextId = 0;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private draining = false;
  private again: Drain | undefined;
  private wake: (() => void) | undefined;
  // Per tile: stops its upload; set while one is on its way.
  private readonly cancels = new Map<number, () => void>();
  // Tiles whose file reached the store and whose confirm is on its way.
  private readonly confirming = new Set<number>();
  // Removed while confirming: deleted once the confirm lands.
  private readonly leaving = new Set<number>();
  private readonly started = new Map<string, number>();
  // Per tile: the incoming key of a PUT that landed, so a retry only confirms.
  private readonly incoming = new Map<number, string>();
  private readonly counted = new Set<string>();

  constructor() {
    effect(() => this.shown.emit(this.failing()));
    effect(() => {
      const keys = this.files();
      if (this.ready()) untracked(() => this.restore(keys));
    });
    effect(() => {
      if (this.ready()) untracked(() => void this.drain('load'));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.poll);
      this.wake?.();
      // A photo cut off here stays queued, and goes on the next visit.
      for (const cancel of [...this.cancels.values()]) cancel();
      for (const tile of this.tiles()) this.release(tile);
    });
  }

  protected choose(event: Event) {
    const input = event.target as HTMLInputElement;
    void this.take([...(input.files ?? [])]);
    input.value = '';
  }

  protected dropFiles(event: DragEvent) {
    event.preventDefault();
    this.over.set(false);
    void this.take([...(event.dataTransfer?.files ?? [])]);
  }

  // Waiting and failed photos alike go again on a new pick, on "Reîncearcă"
  // and when the connection returns, which also ends a backoff wait.
  protected online() {
    this.wake?.();
    void this.drain('online');
  }

  protected retry() {
    void this.drain('retry');
  }

  protected move(index: number, by: -1 | 1, direction: 'earlier' | 'later') {
    this.reorder(index, index + by);
    const id = this.tiles()[index + by]?.id;
    afterNextRender(
      () => {
        const tile = this.host.nativeElement.querySelector(
          `li[data-tile="${id}"]`,
        );
        const buttons = [
          ...(tile?.querySelectorAll<HTMLButtonElement>('button[data-move]') ??
            []),
        ];
        (
          buttons.find((b) => b.dataset['move'] === direction && !b.disabled) ??
          buttons.find((b) => !b.disabled)
        )?.focus();
      },
      { injector: this.injector },
    );
  }

  protected drop(event: CdkDragDrop<Tile[]>) {
    this.reorder(event.previousIndex, event.currentIndex);
  }

  protected remove(id: number) {
    const tile = this.tiles().find((t) => t.id === id);
    if (!tile) return;
    this.watch.leave('files');
    if (tile.queueId && this.confirming.has(id)) {
      // The draft is about to hold it: let the confirm land, then delete.
      this.leaving.add(id);
      void this.queue.update(tile.queueId, { removed: true });
    } else if (tile.queueId) {
      this.cancels.get(id)?.();
      void this.queue.remove(tile.queueId);
    }
    this.release(tile);
    this.setTiles(this.tiles().filter((t) => t.id !== id));
    const draftId = this.draftId();
    const token = this.token();
    if (tile.key && draftId && token) {
      // A photo the server still holds stays on the draft, and comes back
      // on the next read; nothing more to tell the owner.
      this.api
        .listingPhotosControllerRemove({
          id: draftId,
          key: tile.key,
          'x-listing-token': token,
        })
        .catch(() => undefined);
    }
  }

  // Type first, then the size of the copy that is sent (FR-007).
  private async take(chosen: File[]) {
    const typed = chosen.filter((file) => TYPES.includes(file.type));
    // One at a time: each decoded photo holds its full pixels in memory.
    const sent: File[] = [];
    for (const file of typed) sent.push(await downscale(file));
    const fit = sent.filter(
      (file) => file.size > 0 && file.size <= RULE.maxBytes,
    );
    const room = Math.max(0, PHOTOS_MAX - this.tiles().length);
    this.refused.set(fit.length < chosen.length);
    this.full.set(fit.length > room);
    const draftId = this.draftId();
    const kept = fit.slice(0, room);
    if (!draftId || !kept.length) return;
    const entries = await this.queue.add(draftId, kept);
    if (this.destroyed) return;
    const added = entries.map((entry) => this.tileOf(entry));
    this.tiles.update((tiles) => [...tiles, ...added]);
    if (!navigator.onLine) for (const tile of added) this.wait(tile.id);
    void this.drain('pick');
  }

  private tileOf(entry: QueuedPhoto): Tile {
    return {
      file: entry.file,
      id: this.nextId++,
      name: entry.file.name,
      queueId: entry.id,
      src: URL.createObjectURL(entry.file),
      status: 'waiting',
    };
  }

  // One drain at a time per draft, across tabs too; a drain asked for while
  // one runs goes once it ends.
  private async drain(reason: Drain) {
    const draftId = this.draftId();
    if (!this.browser || !draftId || this.destroyed) return;
    if (this.draining) {
      this.again = reason;
      return;
    }
    this.draining = true;
    const run = async () => {
      try {
        let next: Drain | undefined = reason;
        while (next && !this.destroyed) {
          this.again = undefined;
          await this.drainOnce(next);
          next = this.again;
        }
      } finally {
        this.draining = false;
      }
    };
    try {
      const locks = navigator.locks;
      if (locks?.request) await locks.request(`mf-photos-${draftId}`, run);
      else await run();
    } catch {
      this.draining = false;
    }
  }

  // Reads the queue again, as another tab may have sent some of it, then
  // sends what waits, in the order picked.
  private async drainOnce(reason: Drain) {
    const draftId = this.draftId();
    const token = this.token();
    if (!draftId || !token) return;
    const params = { id: draftId, 'x-listing-token': token };
    const live = await this.tidy(draftId, reason, params);
    for (const entry of live) {
      if (this.destroyed || (await this.next(entry, params)) === 'stop') {
        return;
      }
    }
  }

  // The queue as it is now: its tiles shown, its removed entries forgotten.
  private async tidy(
    draftId: string,
    reason: Drain,
    params: Params,
  ): Promise<QueuedPhoto[]> {
    const entries = await this.queue.forDraft(draftId);
    if (this.destroyed) return [];
    const live = entries.filter((entry) => !entry.removed);
    this.show(live);
    if (!navigator.onLine) return live;
    if (live.length && (reason === 'load' || reason === 'online')) {
      this.measure('resumed');
    }
    for (const entry of entries.filter((e) => e.removed)) {
      await this.forget(entry, params);
    }
    return live;
  }

  // Sends one waiting entry, or leaves it waiting while offline.
  private async next(entry: QueuedPhoto, params: Params): Promise<Step> {
    const tile = this.tiles().find((t) => t.queueId === entry.id);
    if (!tile || (tile.status !== 'waiting' && tile.status !== 'failed')) {
      return 'next';
    }
    if (navigator.onLine) return this.send(tile.id, entry, params);
    this.wait(tile.id);
    return 'next';
  }

  // Tiles for entries this page has not shown (a reload, another tab), and
  // none for entries gone from the queue.
  private show(entries: QueuedPhoto[]) {
    const ids = new Set(entries.map((entry) => entry.id));
    const tiles = this.tiles();
    const kept = tiles.filter(
      (tile) =>
        !tile.queueId || ids.has(tile.queueId) || this.cancels.has(tile.id),
    );
    for (const tile of tiles) if (!kept.includes(tile)) this.release(tile);
    const shown = new Set(kept.map((tile) => tile.queueId));
    const added = entries
      .filter((entry) => !shown.has(entry.id))
      .map((entry) => this.tileOf(entry));
    if (added.length || kept.length !== tiles.length) {
      this.tiles.set([...kept, ...added]);
    }
  }

  // A photo removed while its confirm was on its way, on an earlier visit.
  private async forget(entry: QueuedPhoto, params: Params) {
    try {
      if (entry.key) {
        const { key } = await this.api.listingPhotosControllerConfirm({
          ...params,
          body: { key: entry.key },
        });
        await this.api.listingPhotosControllerRemove({ ...params, key });
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 0) return;
    }
    await this.queue.remove(entry.id);
  }

  private async send(
    id: number,
    entry: QueuedPhoto,
    params: Params,
  ): Promise<Step> {
    if (!this.started.has(entry.id)) this.started.set(entry.id, Date.now());
    if (entry.key) this.incoming.set(id, entry.key);
    for (let attempt = 1; ; attempt++) {
      const key = this.incoming.get(id);
      const outcome = await this.attempt(id, entry.file, key, params);
      const step = await this.judge(id, entry.id, outcome, attempt, params);
      if (step !== 'again') return step;
    }
  }

  // After one try: go again, move on to the next photo, or stop the drain.
  private async judge(
    id: number,
    queueId: string,
    outcome: Outcome,
    attempt: number,
    params: Params,
  ): Promise<Step | 'again'> {
    if (this.leaving.delete(id)) {
      this.incoming.delete(id);
      return this.left(queueId, outcome, params);
    }
    if (outcome.kind === 'missing') {
      // The store lost the file behind the key: send it again.
      this.incoming.delete(id);
      await this.queue.update(queueId, { key: undefined });
      return 'again';
    }
    if (outcome.kind === 'dropped') {
      return (await this.backoff(id, attempt)) ?? 'again';
    }
    this.incoming.delete(id);
    return this.after(id, queueId, outcome);
  }

  // Removed while its confirm was on its way: delete what landed.
  private async left(
    queueId: string,
    outcome: Outcome,
    params: Params,
  ): Promise<Step> {
    if (outcome.kind === 'landed') {
      this.api
        .listingPhotosControllerRemove({ ...params, key: outcome.key })
        .catch(() => undefined);
    }
    // A dropped confirm stays queued as removed, for the next drain.
    if (outcome.kind !== 'dropped') await this.queue.remove(queueId);
    return 'next';
  }

  // What a finished attempt leaves: the tile ready, gone or failed.
  private async after(
    id: number,
    queueId: string,
    outcome: Outcome,
  ): Promise<Step> {
    if (outcome.kind === 'landed') {
      await this.landed(id, queueId, outcome.key);
    } else if (outcome.kind === 'refused' || outcome.kind === 'submitted') {
      await this.queue.remove(queueId);
      if (outcome.kind === 'refused') this.refuse(id, outcome.full);
      else this.discard(id);
      this.measure('failed');
    } else if (outcome.kind === 'failed') {
      this.patch(id, { status: 'failed' });
      this.failedLately.set(true);
      this.measure('failed');
    }
    return 'next';
  }

  // A dropped connection: wait and go again (undefined), or give up after
  // the last try, or at once when the browser says it is offline.
  private async backoff(
    id: number,
    attempt: number,
  ): Promise<Step | undefined> {
    if (!navigator.onLine) {
      this.wait(id);
      return 'stop';
    }
    if (attempt >= ATTEMPTS_MAX) {
      this.patch(id, { status: 'failed' });
      this.measure('failed');
      return 'stop';
    }
    this.wait(id);
    await this.sleep(BACKOFF_MS * 2 ** (attempt - 1));
    if (this.destroyed) return 'stop';
    return this.tiles().some((t) => t.id === id) ? undefined : 'next';
  }

  // One try: a fresh address and PUT, or only the confirm when an earlier
  // PUT already landed under `key`.
  private attempt(
    id: number,
    file: File,
    key: string | undefined,
    params: Params,
  ): Promise<Outcome> {
    const confirm = (incoming: string) =>
      defer(() =>
        this.api.listingPhotosControllerConfirm({
          ...params,
          body: { key: incoming },
        }),
      );
    this.patch(id, { progress: 0, status: 'uploading' });
    const queueId = this.tiles().find((t) => t.id === id)?.queueId;
    const events: Observable<
      { progress: number } | { sent: string } | { done: { key: string } }
    > = key
      ? confirm(key).pipe(map((done) => ({ done })))
      : this.uploader.upload(
          file,
          (checksum) =>
            defer(() =>
              this.api.listingPhotosControllerUploadAddress({
                ...params,
                body: { checksum, contentType: file.type, size: file.size },
              }),
            ),
          confirm,
          { retries: 0 },
        );
    if (key) this.confirming.add(id);
    return new Promise<Outcome>((resolve) => {
      const sub = events.subscribe({
        error: (error: unknown) => resolve(this.outcomeOf(error, !!key)),
        next: (event) => {
          if ('done' in event) resolve({ key: event.done.key, kind: 'landed' });
          else this.progressed(id, queueId, event);
        },
      });
      this.cancels.set(id, () => {
        sub.unsubscribe();
        resolve({ kind: 'gone' });
      });
    }).finally(() => {
      this.cancels.delete(id);
      this.confirming.delete(id);
    });
  }

  private progressed(
    id: number,
    queueId: string | undefined,
    event: { progress: number } | { sent: string },
  ) {
    if ('progress' in event) {
      this.patch(id, { progress: event.progress });
      return;
    }
    // In the store: a reload from here on only confirms it.
    this.confirming.add(id);
    this.incoming.set(id, event.sent);
    if (queueId) void this.queue.update(queueId, { key: event.sent });
  }

  private outcomeOf(error: unknown, confirmOnly: boolean): Outcome {
    if (!(error instanceof HttpErrorResponse)) return { kind: 'failed' };
    const code = error.error?.code;
    if (error.status === 0) return { kind: 'dropped' };
    if (error.status === HttpStatusCode.UnprocessableEntity) {
      return { full: code === 'photos_full', kind: 'refused' };
    }
    if (error.status === HttpStatusCode.Conflict) {
      if (code === 'file_missing' && confirmOnly) return { kind: 'missing' };
      if (code === 'draft_submitted') return { kind: 'submitted' };
    }
    return { kind: 'failed' };
  }

  private async landed(id: number, queueId: string, key: string) {
    await this.queue.remove(queueId);
    const started = this.started.get(queueId) ?? Date.now();
    this.started.delete(queueId);
    this.patch(id, {
      key,
      progress: undefined,
      queueId: undefined,
      status: 'ready',
    });
    this.setTiles(this.tiles());
    const n = this.tiles().findIndex((t) => t.id === id) + 1;
    this.announcement.set({ key: 'uploaded', params: { n } });
    this.failedLately.set(false);
    this.measure('sent', { duration: Math.max(0, Date.now() - started) });
  }

  // Waiting for signal: counted once per photo.
  private wait(id: number) {
    this.patch(id, { status: 'waiting' });
    const queueId = this.tiles().find((t) => t.id === id)?.queueId;
    if (queueId && !this.counted.has(queueId)) {
      this.counted.add(queueId);
      this.measure('queued');
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    }).finally(() => {
      this.wake = undefined;
    });
  }

  private measure(
    outcome: 'queued' | 'resumed' | 'sent' | 'failed',
    values: Record<string, number> = {},
  ) {
    measure('upload', values, { outcome, purpose: 'garage_photo' });
  }

  // The keys came from the page: a reload, another device or the link.
  private restore(keys: string[]) {
    const held = this.tiles().filter((tile) => tile.key);
    if (held.map((tile) => tile.key).join() === keys.join()) return;
    const byKey = new Map(held.map((tile) => [tile.key, tile]));
    const kept = keys.map(
      (key): Tile =>
        byKey.get(key) ?? { id: this.nextId++, key, status: 'processing' },
    );
    for (const tile of held)
      if (!keys.includes(tile.key ?? '')) this.release(tile);
    this.tiles.set([...kept, ...this.tiles().filter((tile) => !tile.key)]);
    void this.load();
  }

  private async load(reads = 1) {
    clearTimeout(this.poll);
    const draftId = this.draftId();
    const token = this.token();
    if (!draftId || !token) return;
    if (!this.tiles().some((t) => t.key && t.status === 'processing')) return;
    try {
      const { photos } = await this.api.listingPhotosControllerList({
        id: draftId,
        'x-listing-token': token,
      });
      const shown = new Map(photos.map((photo) => [photo.key, photo]));
      this.tiles.update((tiles) =>
        tiles.map((tile) => {
          const photo = tile.key ? shown.get(tile.key) : undefined;
          return tile.status === 'processing' && photo?.thumbnailUrl
            ? { ...tile, src: photo.thumbnailUrl, status: 'ready' }
            : tile;
        }),
      );
    } catch {
      // Read again below, as for a photo still being processed.
    }
    if (
      reads < PROCESSING_READS_MAX &&
      this.tiles().some((t) => t.key && t.status === 'processing')
    ) {
      this.poll = setTimeout(
        () => void this.load(reads + 1),
        PROCESSING_POLL_MS,
      );
    }
  }

  private reorder(from: number, to: number) {
    const tiles = [...this.tiles()];
    if (to < 0 || to >= tiles.length) return;
    moveItemInArray(tiles, from, to);
    this.setTiles(tiles);
    this.announcement.set({
      key: 'place',
      params: { m: tiles.length, n: to + 1 },
    });
  }

  private setTiles(tiles: Tile[]) {
    this.tiles.set(tiles);
    const keys = tiles.flatMap((tile) => (tile.key ? [tile.key] : []));
    if (keys.join() !== this.files().join()) this.files.set(keys);
  }

  private patch(id: number, change: Partial<Tile>) {
    this.tiles.update((tiles) =>
      tiles.map((tile) => (tile.id === id ? { ...tile, ...change } : tile)),
    );
  }

  // The server will never take this file: drop it rather than send it again.
  private refuse(id: number, full: boolean) {
    this.discard(id);
    if (full) this.full.set(true);
    else this.refused.set(true);
  }

  private discard(id: number) {
    const tile = this.tiles().find((t) => t.id === id);
    if (tile) this.release(tile);
    this.tiles.update((tiles) => tiles.filter((t) => t.id !== id));
  }

  private release(tile: Tile) {
    if (tile.src?.startsWith('blob:')) URL.revokeObjectURL(tile.src);
  }
}
