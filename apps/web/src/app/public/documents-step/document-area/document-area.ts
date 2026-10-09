import {
  CdkDrag,
  type CdkDragDrop,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
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
import { FILE_RULES } from '@motor-fix/contracts/files';
import {
  DOCUMENT_PAGES_MAX,
  type DocumentKind,
} from '@motor-fix/contracts/legal-documents';
import { ListingDraftsService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { FileUploader } from '@motor-fix/media';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { defer, map, type Subscription } from 'rxjs';

const RULE = FILE_RULES.legal_document;
const TYPES: readonly string[] = RULE.types;

type Status = 'waiting' | 'uploading' | 'failed' | 'ready';
interface Page {
  id: number;
  status: Status;
  key?: string;
  file?: File;
  name?: string;
  progress?: number;
}

// One document of step 6: its pages sent straight to storage and confirmed
// on the draft, in the owner's order. It keeps the confirmed keys and leaves
// saving them to the page; whatever is projected sits under the pages.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:online)': 'resume()' },
  imports: [CdkDrag, CdkDropList, HlmButton, TranslatePipe],
  selector: 'mf-document-area',
  styleUrl: './document-area.css',
  templateUrl: './document-area.html',
})
export class DocumentArea {
  readonly kind = input.required<DocumentKind>();
  readonly mobile = input(false);
  readonly draftId = input<string>();
  readonly token = input<string>();
  readonly pages = model<string[]>([]);

  private readonly api = inject(ListingDraftsService);
  private readonly uploader = inject(FileUploader);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly shown = signal<Page[]>([]);
  protected readonly refused = signal(false);
  protected readonly full = signal(false);
  protected readonly over = signal(false);
  protected readonly announcement = signal<{
    key: 'place' | 'uploaded';
    params: Record<string, number>;
  } | null>(null);
  protected readonly types = TYPES.join(',');

  private nextId = 0;
  private readonly sending = new Map<number, Subscription>();

  constructor() {
    effect(() => {
      const keys = this.pages();
      untracked(() => this.restore(keys));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const sub of this.sending.values()) sub.unsubscribe();
    });
  }

  protected ready() {
    return !!this.draftId() && !!this.token();
  }

  protected choose(event: Event) {
    const picker = event.target as HTMLInputElement;
    this.take([...(picker.files ?? [])]);
    picker.value = '';
  }

  protected dropFiles(event: DragEvent) {
    event.preventDefault();
    this.over.set(false);
    this.take([...(event.dataTransfer?.files ?? [])]);
  }

  // Waiting and failed pages alike go again on a new pick and online, in
  // the order they were chosen.
  protected resume() {
    for (const page of this.shown()) {
      if (page.status === 'waiting' || page.status === 'failed') {
        this.send(page.id);
      }
    }
  }

  protected retry(id: number) {
    this.send(id);
  }

  protected move(index: number, by: -1 | 1, direction: 'earlier' | 'later') {
    this.reorder(index, index + by);
    const id = this.shown()[index + by]?.id;
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector(
          `li[data-page="${id}"]`,
        );
        const buttons = [
          ...(row?.querySelectorAll<HTMLButtonElement>('button[data-move]') ??
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

  protected drop(event: CdkDragDrop<Page[]>) {
    this.reorder(event.previousIndex, event.currentIndex);
  }

  protected remove(id: number) {
    const page = this.shown().find((p) => p.id === id);
    if (!page) return;
    this.sending.get(id)?.unsubscribe();
    this.sending.delete(id);
    this.setShown(this.shown().filter((p) => p.id !== id));
    const draftId = this.draftId();
    const token = this.token();
    if (page.key && draftId && token) {
      // A page the server still holds comes back on the next read.
      this.api
        .listingDocumentsControllerRemove({
          id: draftId,
          key: page.key,
          kind: this.kind(),
          'x-listing-token': token,
        })
        .catch(() => undefined);
    }
  }

  private take(chosen: File[]) {
    const fit = chosen.filter(
      (file) =>
        TYPES.includes(file.type) &&
        file.size > 0 &&
        file.size <= RULE.maxBytes,
    );
    const room = Math.max(0, DOCUMENT_PAGES_MAX - this.shown().length);
    this.refused.set(fit.length < chosen.length);
    this.full.set(fit.length > room);
    const added = fit.slice(0, room).map(
      (file): Page => ({
        file,
        id: this.nextId++,
        name: file.name,
        status: 'waiting',
      }),
    );
    this.shown.update((shown) => [...shown, ...added]);
    if (navigator.onLine) this.resume();
  }

  private send(id: number) {
    const file = this.shown().find((p) => p.id === id)?.file;
    const draftId = this.draftId();
    const token = this.token();
    if (!file || !draftId || !token) return;
    const params = {
      id: draftId,
      kind: this.kind(),
      'x-listing-token': token,
    };
    this.patch(id, { progress: 0, status: 'uploading' });
    const sub = this.uploader
      .upload(
        file,
        () =>
          defer(() =>
            this.api.listingDocumentsControllerUploadAddress({
              ...params,
              body: { contentType: file.type, size: file.size },
            }),
          ),
        (key) =>
          defer(() =>
            this.api.listingDocumentsControllerConfirm({
              ...params,
              body: { key },
            }),
          ).pipe(map((document) => document.pages.at(-1))),
      )
      .subscribe({
        error: (error: unknown) => {
          this.sending.delete(id);
          if (
            error instanceof HttpErrorResponse &&
            error.status === HttpStatusCode.UnprocessableEntity
          ) {
            this.refuse(id, error.error?.code === 'document_full');
            return;
          }
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
          this.patch(id, { key: event.done, status: 'ready' });
          this.setShown(this.shown());
          const n = this.shown().findIndex((p) => p.id === id) + 1;
          this.announcement.set({ key: 'uploaded', params: { n } });
        },
      });
    this.sending.set(id, sub);
  }

  // The keys came from the page: a reload, another device or the link.
  private restore(keys: string[]) {
    const held = this.shown().filter((page) => page.key);
    if (held.map((page) => page.key).join() === keys.join()) return;
    const byKey = new Map(held.map((page) => [page.key, page]));
    const kept = keys.map(
      (key): Page =>
        byKey.get(key) ?? { id: this.nextId++, key, status: 'ready' },
    );
    this.shown.set([...kept, ...this.shown().filter((page) => !page.key)]);
  }

  private reorder(from: number, to: number) {
    const shown = [...this.shown()];
    if (to < 0 || to >= shown.length) return;
    moveItemInArray(shown, from, to);
    this.setShown(shown);
    this.announcement.set({
      key: 'place',
      params: { m: shown.length, n: to + 1 },
    });
  }

  private setShown(shown: Page[]) {
    this.shown.set(shown);
    const keys = shown.flatMap((page) => (page.key ? [page.key] : []));
    if (keys.join() !== this.pages().join()) this.pages.set(keys);
  }

  private patch(id: number, change: Partial<Page>) {
    this.shown.update((shown) =>
      shown.map((page) => (page.id === id ? { ...page, ...change } : page)),
    );
  }

  // The server will never take this file: drop it rather than send it again.
  private refuse(id: number, full: boolean) {
    this.shown.update((shown) => shown.filter((p) => p.id !== id));
    if (full) this.full.set(true);
    else this.refused.set(true);
  }
}
