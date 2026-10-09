import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import type { ListingDraftData } from '@motor-fix/contracts';
import {
  CERTIFICATE_WINDOW_DAYS,
  DECLARED_NAME_MAX,
  DECLARED_NAME_MIN,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DraftDocuments,
  issuedWithinWindow,
} from '@motor-fix/contracts/legal-documents';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput } from '@motor-fix/ui-cockpit';

import { DocumentArea } from './document-area/document-area';
import { nameError } from '../step6';

type Declaration = Pick<ListingDraftData, 'declaredAt' | 'declaredByName'>;

// The device's calendar date `days` before today, as YYYY-MM-DD.
function localDate(days = 0): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// Step 6's documents, under the CUI and RAR fields: one area per kind, the
// certificate's issue date once it has a page, then the declaration. It keeps
// the draft's `documents` and declaration and leaves saving them to the page.
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
  readonly declaration = model<Declaration>({});

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

  // The tick's time is the server's; the one set here only says it is on.
  protected readonly ticked = computed(() =>
    Boolean(this.declaration().declaredAt),
  );
  protected readonly nameMax = DECLARED_NAME_MAX;
  // What was typed, until the draft holds it: a name too short is not kept.
  private readonly typedName = signal<string | null>(null);
  private readonly nameLeft = signal(false);
  protected readonly name = computed(
    () => this.typedName() ?? this.declaration().declaredByName ?? '',
  );
  protected readonly nameError = computed(() =>
    nameError(this.name(), this.ticked(), this.nameLeft()),
  );

  protected tick(on: boolean) {
    const { declaredAt: _, ...rest } = this.declaration();
    this.declaration.set(
      on ? { ...rest, declaredAt: new Date().toISOString() } : rest,
    );
  }

  protected typeName(value: string) {
    this.typedName.set(value);
    const name = value.trim();
    const { declaredByName: _, ...rest } = this.declaration();
    const whole =
      name.length >= DECLARED_NAME_MIN && name.length <= DECLARED_NAME_MAX;
    this.declaration.set(whole ? { ...rest, declaredByName: name } : rest);
  }

  protected leaveName() {
    this.nameLeft.set(true);
  }

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
