import {
  CdkDrag,
  type CdkDragDrop,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { HttpErrorResponse } from '@angular/common/http';
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
  signal,
  untracked,
} from '@angular/core';
import { PHOTOS_MAX } from '@motor-fix/contracts/listing-photos';
import { ListingDraftsService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { FileUploader } from '@motor-fix/media';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { defer, type Subscription } from 'rxjs';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SIZE_MAX = 10 * 1024 * 1024;
// A photo just confirmed shows the local file; one restored before its
// copies exist is read again after this long.
const PROCESSING_POLL_MS = 5000;

type Status = 'waiting' | 'uploading' | 'failed' | 'processing' | 'ready';
interface Tile {
  id: number;
  status: Status;
  key?: string;
  file?: File;
  name?: string;
  src?: string;
  progress?: number;
}

// Step 5 of listing a garage, above the hours: the photos, sent straight to
// storage and confirmed on the draft, the first the cover. It keeps the
// draft's keys in their order and leaves saving them to the page.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:online)': 'resume()' },
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

  private readonly api = inject(ListingDraftsService);
  private readonly uploader = inject(FileUploader);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly tiles = signal<Tile[]>([]);
  protected readonly refused = signal(false);
  protected readonly full = signal(false);
  protected readonly announcement = signal<{ n: number; m: number } | null>(
    null,
  );
  protected readonly types = TYPES.join(',');
  protected readonly mobile = computed(() => this.kind() === 'mobile');
  protected readonly ready = computed(() => !!this.draftId() && !!this.token());
  protected readonly later = computed(() =>
    this.tiles().some((tile) => tile.status === 'failed'),
  );

  private nextId = 0;
  private readonly sending = new Map<number, Subscription>();
  private poll: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const keys = this.files();
      if (this.ready()) untracked(() => this.restore(keys));
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.poll);
      for (const sub of this.sending.values()) sub.unsubscribe();
      for (const tile of this.tiles()) this.release(tile);
    });
  }

  protected choose(event: Event) {
    const input = event.target as HTMLInputElement;
    this.take([...(input.files ?? [])]);
    input.value = '';
  }

  protected dropFiles(event: DragEvent) {
    event.preventDefault();
    this.take([...(event.dataTransfer?.files ?? [])]);
  }

  protected resume() {
    for (const tile of this.tiles()) {
      if (tile.status === 'waiting') this.send(tile.id);
    }
  }

  protected retry(id: number) {
    this.send(id);
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
    this.sending.get(id)?.unsubscribe();
    this.sending.delete(id);
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

  private take(chosen: File[]) {
    const fit = chosen.filter(
      (file) => TYPES.includes(file.type) && file.size <= SIZE_MAX,
    );
    const room = Math.max(0, PHOTOS_MAX - this.tiles().length);
    this.refused.set(fit.length < chosen.length);
    this.full.set(fit.length > room);
    const added = fit.slice(0, room).map(
      (file): Tile => ({
        file,
        id: this.nextId++,
        name: file.name,
        src: URL.createObjectURL(file),
        status: 'waiting',
      }),
    );
    this.tiles.update((tiles) => [...tiles, ...added]);
    if (navigator.onLine) for (const tile of added) this.send(tile.id);
  }

  private send(id: number) {
    const file = this.tiles().find((t) => t.id === id)?.file;
    const draftId = this.draftId();
    const token = this.token();
    if (!file || !draftId || !token) return;
    const params = { id: draftId, 'x-listing-token': token };
    this.patch(id, { progress: 0, status: 'uploading' });
    const sub = this.uploader
      .upload(
        file,
        () =>
          defer(() =>
            this.api.listingPhotosControllerUploadAddress({
              ...params,
              body: { contentType: file.type, size: file.size },
            }),
          ),
        (key) =>
          defer(() =>
            this.api.listingPhotosControllerConfirm({
              ...params,
              body: { key },
            }),
          ),
      )
      .subscribe({
        error: (error: unknown) => {
          this.sending.delete(id);
          const offline =
            error instanceof HttpErrorResponse && error.status === 0;
          this.patch(id, { status: offline ? 'waiting' : 'failed' });
        },
        next: (event) => {
          if ('progress' in event) {
            this.patch(id, { progress: event.progress });
            return;
          }
          this.sending.delete(id);
          this.patch(id, { key: event.done.key, status: 'ready' });
          this.setTiles(this.tiles());
        },
      });
    this.sending.set(id, sub);
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

  private async load() {
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
    if (this.tiles().some((t) => t.key && t.status === 'processing')) {
      this.poll = setTimeout(() => void this.load(), PROCESSING_POLL_MS);
    }
  }

  private reorder(from: number, to: number) {
    const tiles = [...this.tiles()];
    if (to < 0 || to >= tiles.length) return;
    moveItemInArray(tiles, from, to);
    this.setTiles(tiles);
    this.announcement.set({ m: tiles.length, n: to + 1 });
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

  private release(tile: Tile) {
    if (tile.src?.startsWith('blob:')) URL.revokeObjectURL(tile.src);
  }
}
