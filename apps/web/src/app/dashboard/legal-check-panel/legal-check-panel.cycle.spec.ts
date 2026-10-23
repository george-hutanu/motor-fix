import { TestBed } from '@angular/core/testing';
import type {
  DocumentCycleDto,
  LegalCheckDto,
  LegalCheckRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { LegalCheckPanel } from './legal-check-panel';

const NOTE = 'Pagina a doua nu se citește';

const STATE: Record<DocumentCycleDto['row'], LegalCheckRowDto['state']> = {
  due: 'warning',
  in_review: 'warning',
  overdue: 'failed',
  refused: 'failed',
  valid: 'ok',
};

const cycle = (
  row: DocumentCycleDto['row'],
  over: Partial<DocumentCycleDto> = {},
): DocumentCycleDto => ({
  canUpload: row !== 'in_review',
  dueOn: '2027-01-15',
  graceUntil: row === 'overdue' ? '2027-01-29' : null,
  inReview: row === 'in_review',
  refusal:
    row === 'refused'
      ? {
          decidedAt: '2026-12-20T10:00:00.000Z',
          kind: 'rar_authorisation',
          note: NOTE,
          reason: 'documents',
        }
      : null,
  row,
  state: row === 'overdue' ? 'overdue' : 'due',
  ...over,
});

const answer = (documents: DocumentCycleDto | null): LegalCheckDto => ({
  companyName: 'ATELIER DINAMO SRL',
  documents,
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [],
  rows: (['company', 'caen', 'rar', 'documents'] as const).map((kind) => ({
    checkedOn: '2026-10-01',
    detail: null,
    kind,
    missing: [],
    state: kind === 'documents' && documents ? STATE[documents.row] : 'ok',
  })),
  status: 'approved',
});

async function render(data: LegalCheckDto, language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(LegalCheckPanel);
  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const documentsRow = (el: HTMLElement) =>
  el.querySelector('[data-legal-row="documents"]') as HTMLElement;
// The row's words, its button aside.
const said = (el: HTMLElement) => {
  const row = documentsRow(el).cloneNode(true) as HTMLElement;
  row.querySelector('[data-documents-upload]')?.remove();
  return text(row);
};
const uploadButton = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-documents-upload]');

afterEach(() => TestBed.resetTestingModule());

// @traces 068-FR-005
// @traces 068-FR-017
describe('the Documente row by the yearly cycle', () => {
  it.each([
    [
      'valid',
      'green',
      'Documente certificat constatator și autorizație RAR · de reîncărcat o dată pe an, până în ian. 2027 verificate pe 1 oct. 2026 în regulă',
    ],
    [
      'due',
      'amber',
      'Documente certificat constatator și autorizație RAR · de reîncărcat o dată pe an, până în ian. 2027 verificate pe 1 oct. 2026 atenție',
    ],
    [
      'in_review',
      'amber',
      'Documente certificat constatator și autorizație RAR · în verificare verificate pe 1 oct. 2026 atenție',
    ],
    [
      'overdue',
      'red',
      'Documente certificat constatator și autorizație RAR · restante din 16 ian. 2027, profilul iese de pe hartă pe 30 ian. 2027 verificate pe 1 oct. 2026 problemă',
    ],
    [
      'refused',
      'red',
      `Documente certificat constatator și autorizație RAR · refuzat: ${NOTE} verificate pe 1 oct. 2026 problemă`,
    ],
  ] as const)(
    'reads a %s cycle in words, with the %s lamp',
    async (row, lamp, words) => {
      const element = (await render(answer(cycle(row)))).nativeElement;

      expect(said(element)).toBe(words);
      expect(documentsRow(element).getAttribute('data-lamp')).toBe(lamp);
    },
  );

  it.each([
    [
      'valid',
      'Documents company certificate and RAR authorisation · upload again once a year, by Jan 2027 checked on 1 Oct 2026 in order',
    ],
    [
      'in_review',
      'Documents company certificate and RAR authorisation · under review checked on 1 Oct 2026 attention',
    ],
    [
      'overdue',
      'Documents company certificate and RAR authorisation · overdue since 16 Jan 2027, the profile leaves the map on 30 Jan 2027 checked on 1 Oct 2026 problem',
    ],
    [
      'refused',
      `Documents company certificate and RAR authorisation · refused: ${NOTE} checked on 1 Oct 2026 problem`,
    ],
  ] as const)('reads a %s cycle in English', async (row, words) => {
    const element = (await render(answer(cycle(row)), 'en')).nativeElement;

    expect(said(element)).toBe(words);
  });
});

// @traces 068-FR-005
describe('the button on the Documente row', () => {
  it.each(['valid', 'due', 'overdue', 'refused'] as const)(
    'offers "Încarcă documentele" on a %s cycle and asks for the dialog',
    async (row) => {
      const fixture = await render(answer(cycle(row)));
      const asked = jest.fn();
      fixture.componentInstance.upload.subscribe(asked);
      const button = uploadButton(fixture.nativeElement);

      expect(text(button)).toBe('Încarcă documentele');
      expect(documentsRow(fixture.nativeElement).contains(button)).toBe(true);
      button?.click();
      expect(asked).toHaveBeenCalledTimes(1);
    },
  );

  it('is gone while a document is under review, and for a garage without a cycle', async () => {
    const element = (await render(answer(cycle('in_review')))).nativeElement;

    expect(text(documentsRow(element))).toContain('în verificare');
    expect(uploadButton(element)).toBeNull();
    TestBed.resetTestingModule();
    const without = (await render(answer(null))).nativeElement;
    expect(text(documentsRow(without))).toBe(
      'Documente certificat constatator și autorizație RAR verificate pe 1 oct. 2026 în regulă',
    );
    expect(uploadButton(without)).toBeNull();
  });

  it('reads "Upload the documents" in English', async () => {
    const element = (await render(answer(cycle('due')), 'en')).nativeElement;

    expect(text(uploadButton(element))).toBe('Upload the documents');
  });
});
