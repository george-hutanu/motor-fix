import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FILE_RULES } from '@motor-fix/contracts/files';
import {
  CERTIFICATE_WINDOW_DAYS,
  DOCUMENT_KINDS,
  DOCUMENT_PAGES_MAX,
  type DocumentKind,
  isCalendarDate,
  issuedWithinWindow,
} from '@motor-fix/contracts/legal-documents';
import {
  type DocumentCycleDto,
  GaragesService,
  type RenewedDocumentDto,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { FileUploader } from '@motor-fix/media';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';
import { defer, of, type Subscription } from 'rxjs';

const RULE = FILE_RULES.legal_document;
const TYPES: readonly string[] = RULE.types;

export interface DocumentsUploadData {
  garageId: string;
}

type Status = 'uploading' | 'failed' | 'ready' | 'refused';
interface Page {
  id: number;
  file: File;
  status: Status;
  key?: string;
  progress?: number;
}
type ByKind<T> = Record<DocumentKind, T>;
type Problem =
  | 'unavailable'
  | 'sendFailed'
  | 'bothRequired'
  | 'inReview'
  | 'issuedOnOld';

const SAID: Record<Problem | 'issuedOnFuture', string> = {
  bothRequired: 'garage.legal.upload.bothRequired',
  inReview: 'garage.legal.upload.inReview',
  issuedOnFuture: 'garage.legal.upload.issuedOnFuture',
  issuedOnOld: 'garage.legal.upload.issuedOnOld',
  sendFailed: 'garage.legal.upload.sendFailed',
  unavailable: 'garage.legal.upload.unavailable',
};

const KIND_SAID: ByKind<{ label: string; hint: string }> = {
  onrc_certificate: {
    hint: 'garage.legal.upload.kinds.onrc_certificate.hint',
    label: 'garage.legal.upload.kinds.onrc_certificate.label',
  },
  rar_authorisation: {
    hint: 'garage.legal.upload.kinds.rar_authorisation.hint',
    label: 'garage.legal.upload.kinds.rar_authorisation.label',
  },
};

const byKind = <T>(value: () => T) =>
  Object.fromEntries(
    DOCUMENT_KINDS.map((kind) => [kind, value()]),
  ) as ByKind<T>;

// The device's calendar date `days` before today, as YYYY-MM-DD.
function localDate(days = 0): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// A store that did not answer, or said it cannot take files now.
const unavailable = (error: unknown) => {
  const { code, status } = toProblem(error);
  return code === 'storage_unavailable' || status === 0 || status === 503;
};

// "Încarcă documentele": the yearly certificate and RAR authorisation, by the
// rules of the listing's step 6. Each page goes straight to the store; the
// documents are sent together with their issue dates, and a kind may go
// alone (the server says when the other is owed). A failed send keeps every
// page for the next press. Closes with the garage's cycle, or "cancelled".
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-documents-upload',
  styleUrl: './documents-upload.css',
  templateUrl: './documents-upload.html',
})
export class DocumentsUpload {
  protected readonly task = injectOverlayTask<
    DocumentsUploadData,
    DocumentCycleDto | 'cancelled'
  >();
  private readonly api = inject(GaragesService);
  private readonly uploader = inject(FileUploader);

  protected readonly kinds = DOCUMENT_KINDS;
  protected readonly said = SAID;
  protected readonly kindSaid = KIND_SAID;
  protected readonly types = TYPES.join(',');
  protected readonly today = localDate();
  protected readonly earliest = localDate(CERTIFICATE_WINDOW_DAYS);

  protected readonly pages = signal<ByKind<Page[]>>(byKind(() => []));
  protected readonly full = signal<ByKind<boolean>>(byKind(() => false));
  protected readonly dates = signal<ByKind<string>>(byKind(() => ''));
  protected readonly problem = signal<Problem | null>(null);
  protected readonly busy = signal(false);

  protected readonly dateProblem = computed(
    () =>
      Object.fromEntries(
        DOCUMENT_KINDS.map((kind) => [
          kind,
          this.judge(kind, this.dates()[kind]),
        ]),
      ) as ByKind<'issuedOnOld' | 'issuedOnFuture' | null>,
  );

  private readonly complete = computed(
    () =>
      Object.fromEntries(
        DOCUMENT_KINDS.map((kind) => {
          const taken = this.taken(kind);
          return [
            kind,
            taken.length > 0 &&
              taken.every((page) => page.status === 'ready') &&
              !!this.dates()[kind] &&
              !this.dateProblem()[kind],
          ];
        }),
      ) as ByKind<boolean>,
  );

  protected readonly sendable = computed(
    () =>
      !this.busy() &&
      DOCUMENT_KINDS.some((kind) => this.complete()[kind]) &&
      DOCUMENT_KINDS.every(
        (kind) => this.complete()[kind] || this.taken(kind).length === 0,
      ),
  );

  private nextId = 0;
  private readonly sending = new Map<number, Subscription>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const sub of this.sending.values()) sub.unsubscribe();
    });
  }

  protected numbered(kind: DocumentKind) {
    let n = 0;
    return this.pages()[kind].map((page) => ({
      n: page.status === 'refused' ? 0 : ++n,
      page,
    }));
  }

  protected choose(kind: DocumentKind, event: Event) {
    const picker = event.target as HTMLInputElement;
    const chosen = [...(picker.files ?? [])];
    picker.value = '';
    const fits = (file: File) =>
      TYPES.includes(file.type) && file.size > 0 && file.size <= RULE.maxBytes;
    const room = Math.max(0, DOCUMENT_PAGES_MAX - this.taken(kind).length);
    const fit = chosen.filter(fits);
    this.full.update((full) => ({ ...full, [kind]: fit.length > room }));
    const kept = new Set(fit.slice(0, room));
    const added = chosen
      .filter((file) => kept.has(file) || !fits(file))
      .map(
        (file): Page => ({
          file,
          id: this.nextId++,
          status: kept.has(file) ? 'uploading' : 'refused',
        }),
      );
    this.pages.update((pages) => ({
      ...pages,
      [kind]: [...pages[kind], ...added],
    }));
    for (const page of added) {
      if (page.status === 'uploading') this.send(kind, page.id);
    }
  }

  protected retry(kind: DocumentKind, id: number) {
    this.send(kind, id);
  }

  protected remove(kind: DocumentKind, id: number) {
    this.sending.get(id)?.unsubscribe();
    this.sending.delete(id);
    this.pages.update((pages) => ({
      ...pages,
      [kind]: pages[kind].filter((page) => page.id !== id),
    }));
  }

  protected typeDate(kind: DocumentKind, value: string) {
    this.dates.update((dates) => ({ ...dates, [kind]: value }));
    if (this.problem() === 'issuedOnOld') this.problem.set(null);
  }

  protected async submit(event: Event) {
    event.preventDefault();
    if (!this.sendable()) return;
    this.busy.set(true);
    this.problem.set(null);
    const documents: RenewedDocumentDto[] = DOCUMENT_KINDS.filter(
      (kind) => this.complete()[kind],
    ).map((kind) => ({
      issuedOn: this.dates()[kind],
      kind,
      pages: this.taken(kind).flatMap((page) => (page.key ? [page.key] : [])),
    }));
    try {
      const cycle = await this.api.ownerDocumentsControllerSubmit({
        body: { documents },
        garageId: this.task.data.garageId,
      });
      this.task.markUnchanged();
      this.task.close(cycle);
    } catch (error) {
      this.problem.set(this.refusal(error));
    } finally {
      this.busy.set(false);
    }
  }

  // The pages the browser took for the kind, refused ones aside.
  private taken(kind: DocumentKind): Page[] {
    return this.pages()[kind].filter((page) => page.status !== 'refused');
  }

  private judge(
    kind: DocumentKind,
    value: string,
  ): 'issuedOnOld' | 'issuedOnFuture' | null {
    if (!value) return null;
    if (kind === 'onrc_certificate') {
      return issuedWithinWindow(value, this.today) ? null : 'issuedOnOld';
    }
    return isCalendarDate(value) && value <= this.today
      ? null
      : 'issuedOnFuture';
  }

  private refusal(error: unknown): Problem {
    if (unavailable(error)) return 'unavailable';
    switch (toProblem(error).code) {
      case 'both_documents_required':
        return 'bothRequired';
      case 'document_in_review':
        return 'inReview';
      case 'certificate_too_old':
        return 'issuedOnOld';
      default:
        return 'sendFailed';
    }
  }

  private send(kind: DocumentKind, id: number) {
    const file = this.pages()[kind].find((page) => page.id === id)?.file;
    if (!file) return;
    if (this.problem() === 'unavailable') this.problem.set(null);
    this.patch(kind, id, { progress: 0, status: 'uploading' });
    const sub = this.uploader
      .upload(
        file,
        (checksum) =>
          defer(() =>
            this.api.ownerDocumentsControllerUploadUrl({
              body: { checksum, contentType: file.type, size: file.size },
              garageId: this.task.data.garageId,
            }),
          ),
        // The pages are confirmed together, when the documents are sent.
        (key) => of(key),
      )
      .subscribe({
        error: (error: unknown) => {
          this.sending.delete(id);
          const { status } = toProblem(error);
          if (status === 413 || status === 415 || status === 422) {
            this.patch(kind, id, { status: 'refused' });
            return;
          }
          if (unavailable(error)) this.problem.set('unavailable');
          this.patch(kind, id, { status: 'failed' });
        },
        next: (event) => {
          if ('progress' in event) {
            this.patch(kind, id, { progress: event.progress });
          } else if ('done' in event) {
            this.sending.delete(id);
            this.patch(kind, id, { key: event.done, status: 'ready' });
          }
        },
      });
    this.sending.set(id, sub);
  }

  private patch(kind: DocumentKind, id: number, change: Partial<Page>) {
    this.pages.update((pages) => ({
      ...pages,
      [kind]: pages[kind].map((page) =>
        page.id === id ? { ...page, ...change } : page,
      ),
    }));
  }
}
