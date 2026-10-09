import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import {
  CERTIFICATE_WINDOW_DAYS,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DraftDocuments,
  issuedWithinWindow,
} from '@motor-fix/contracts/legal-documents';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput } from '@motor-fix/ui-cockpit';

import { DocumentArea } from './document-area/document-area';

// The device's calendar date `days` before today, as YYYY-MM-DD.
function localDate(days = 0): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// Step 6's documents, under the CUI and RAR fields: one area per kind, and
// the certificate's issue date once it has a page. It keeps the draft's
// `documents` and leaves saving them to the page.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DocumentArea, HlmInput, TranslatePipe],
  selector: 'mf-documents-step',
  styleUrl: './documents-step.css',
  templateUrl: './documents-step.html',
})
export class DocumentsStep {
  readonly draftId = input<string>();
  readonly token = input<string>();
  readonly kind = input<string>();
  readonly documents = model<DraftDocuments>({});

  protected readonly kinds = DOCUMENT_KINDS;
  protected readonly mobile = computed(() => this.kind() === 'mobile');
  protected readonly earliest = localDate(CERTIFICATE_WINDOW_DAYS);
  protected readonly today = localDate();

  // What the field shows when it differs from the draft: a refused date is
  // never kept, but stays in the field to be corrected.
  private readonly typed = signal<string | null>(null);
  private readonly left = signal(false);
  private readonly stored = computed(
    () => this.documents().onrc_certificate?.issuedOn ?? '',
  );
  protected readonly issuedOn = computed(() => this.typed() ?? this.stored());
  protected readonly dateError = computed(() => {
    const value = this.issuedOn();
    if (!value || issuedWithinWindow(value, localDate())) return false;
    return this.left() || value === this.stored();
  });

  protected pagesOf(kind: DocumentKind): string[] {
    return this.documents()[kind]?.pages ?? [];
  }

  // A document with no page left goes, and its issue date with it.
  protected setPages(kind: DocumentKind, pages: string[]) {
    const { [kind]: current, ...others } = this.documents();
    if (!pages.length) {
      if (kind === 'onrc_certificate') this.forgetDate();
      this.documents.set(others);
      return;
    }
    this.documents.set({ ...others, [kind]: { ...current, pages } });
  }

  protected typeDate(value: string) {
    const kept = value && issuedWithinWindow(value, localDate()) ? value : '';
    this.typed.set(value === kept ? null : value);
    const { onrc_certificate: certificate, ...others } = this.documents();
    if (!certificate || (certificate.issuedOn ?? '') === kept) return;
    const { issuedOn: _, ...pages } = certificate;
    this.documents.set({
      ...others,
      onrc_certificate: kept ? { ...pages, issuedOn: kept } : pages,
    });
  }

  protected leaveDate() {
    this.left.set(true);
  }

  private forgetDate() {
    this.typed.set(null);
    this.left.set(false);
  }
}
