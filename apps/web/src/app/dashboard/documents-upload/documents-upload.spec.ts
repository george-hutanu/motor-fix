import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DocumentCycleDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { DocumentsUpload, type DocumentsUploadData } from './documents-upload';

const BASE = '/api/v1/garages/garage-1/legal-documents';
const STORE = 'https://store.test/motorfix';

const CYCLE: DocumentCycleDto = {
  canUpload: false,
  dueOn: '2027-01-15',
  graceUntil: null,
  inReview: true,
  refusal: null,
  row: 'in_review',
  state: 'due',
};

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let http: HttpTestingController;
let result: Promise<OverlayResult<DocumentCycleDto>>;
let keys = 0;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  keys = 0;
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('garage');
  http = TestBed.inject(HttpTestingController);
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    DocumentCycleDto,
    DocumentsUploadData
  >(DocumentsUpload, {
    data: { garageId: 'garage-1' },
    shape: 'dialog',
    title: 'garage.legal.upload.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const area = (kind: string) =>
  panel().querySelector(`[data-kind="${kind}"]`) as HTMLElement;
const pages = (kind: string) => [
  ...area(kind).querySelectorAll<HTMLElement>('li[data-page]'),
];
const send = () =>
  panel().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  ) as HTMLButtonElement;
const alerts = () =>
  [...panel().querySelectorAll('[role="alert"]')].map((a) => text(a));

const pdf = (name = 'pagina.pdf') =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: 'application/pdf',
  });

async function choose(kind: string, files: File[]) {
  const input = area(kind).querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  await settle();
}

async function date(kind: string, value: string) {
  const input = area(kind).querySelector(
    'input[type="date"]',
  ) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur'));
  await settle();
}

const asked = (): TestRequest =>
  http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/upload-url`);

// Answers the next page's address, then its PUT; returns the key.
async function store(): Promise<string> {
  const key = `incoming/legal_document/garage-1/page-${++keys}`;
  asked().flush({
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    headers: { 'Content-Type': 'application/pdf' },
    key,
    url: `${STORE}/${keys}`,
  });
  await settle();
  http
    .expectOne(`${STORE}/${keys}`)
    .flush(null, { status: 200, statusText: 'OK' });
  await settle();
  return key;
}

// The device's calendar date `days` before today, as YYYY-MM-DD.
function localDate(days = 0): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

async function bothReady() {
  await choose('onrc_certificate', [pdf('certificat.pdf')]);
  const certificate = await store();
  await choose('rar_authorisation', [pdf('rar.pdf')]);
  const rar = await store();
  await date('onrc_certificate', localDate(3));
  await date('rar_authorisation', '2025-06-01');
  return { certificate, rar };
}

const submitted = () =>
  http.expectOne((r) => r.method === 'POST' && r.url === BASE);

afterEach(() => {
  http.verify();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 068-FR-006
// @traces 068-FR-017
describe('the yearly documents dialog', () => {
  it('has one picker per kind, its limits and the note, in Romanian', async () => {
    await open();

    expect(text(area('onrc_certificate'))).toContain(
      'Certificat constatator ONRC',
    );
    expect(text(area('onrc_certificate'))).toContain(
      'Emis în ultimele 30 de zile, cu punctul de lucru al atelierului',
    );
    expect(text(area('rar_authorisation'))).toContain(
      'Autorizația tehnică RAR',
    );
    for (const kind of ['onrc_certificate', 'rar_authorisation']) {
      const picker = area(kind).querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(picker.accept).toBe('application/pdf,image/jpeg,image/png');
      expect(picker.multiple).toBe(true);
      expect(text(area(kind))).toContain(
        'PDF, JPG sau PNG, cel mult 10 MB fiecare, până la 10 pagini',
      );
      expect(area(kind).querySelector('input[type="date"]')).not.toBeNull();
    }
    expect(text(panel())).toContain(
      'Documentele le vede doar echipa MotorFix.',
    );
    expect(send().disabled).toBe(true);
  });

  it('reads the same in English', async () => {
    await open('en');

    expect(text(area('onrc_certificate'))).toContain(
      'ONRC company certificate',
    );
    expect(text(area('rar_authorisation'))).toContain(
      'RAR technical authorisation',
    );
    expect(text(area('rar_authorisation'))).toContain(
      'PDF, JPG or PNG, up to 10 MB each, at most 10 pages',
    );
    expect(text(panel())).toContain(
      'Only the MotorFix team sees the documents.',
    );
    expect(text(send())).toBe('Send the documents');
  });

  it('sends each page to the store and both documents with their issue dates', async () => {
    await open();

    const { certificate, rar } = await bothReady();
    expect(pages('onrc_certificate').map(text)).toEqual([
      'Pagina 1 certificat.pdf încărcată Scoate',
    ]);
    expect(send().disabled).toBe(false);
    send().click();
    await settle();
    const request = submitted();
    expect(request.request.body).toEqual({
      documents: [
        {
          issuedOn: localDate(3),
          kind: 'onrc_certificate',
          pages: [certificate],
        },
        { issuedOn: '2025-06-01', kind: 'rar_authorisation', pages: [rar] },
      ],
    });
    request.flush(CYCLE, { status: 201, statusText: 'Created' });
    await settle();

    await expect(result).resolves.toEqual(CYCLE);
  });

  it('asks the address with the page’s type and size', async () => {
    await open();

    await choose('rar_authorisation', [pdf()]);
    const ask = asked();
    expect(ask.request.body).toEqual({
      checksum: expect.stringMatching(/^[A-Za-z0-9+/]{6}==$/),
      contentType: 'application/pdf',
      size: 4,
    });
    ask.flush({ code: 'storage_unavailable' }, { status: 503, statusText: '' });
    await settle();
  });

  it('shows a page of another type or over 10 MB with its message and sends nothing for it', async () => {
    await open();
    const big = pdf('mare.pdf');
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    const gif = new File([new Uint8Array([1])], 'poza.gif', {
      type: 'image/gif',
    });

    await choose('onrc_certificate', [gif, big]);

    expect(pages('onrc_certificate').map(text)).toEqual([
      'poza.gif Nu e acceptat: doar PDF, JPG sau PNG, cel mult 10 MB Scoate',
      'mare.pdf Nu e acceptat: doar PDF, JPG sau PNG, cel mult 10 MB Scoate',
    ]);
    expect(send().disabled).toBe(true);
  });

  it('keeps out a page the store refuses, with its message', async () => {
    await open();

    await choose('onrc_certificate', [pdf('ciudat.pdf')]);
    asked().flush(
      { code: 'file_type_not_allowed' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settle();

    expect(pages('onrc_certificate').map(text)).toEqual([
      'ciudat.pdf Nu e acceptat: doar PDF, JPG sau PNG, cel mult 10 MB Scoate',
    ]);
    await date('onrc_certificate', localDate(1));
    expect(send().disabled).toBe(true);
  });

  it('takes at most 10 pages per document', async () => {
    await open();

    await choose(
      'rar_authorisation',
      Array.from({ length: 11 }, (_, i) => pdf(`p${i + 1}.pdf`)),
    );

    expect(pages('rar_authorisation')).toHaveLength(10);
    expect(text(area('rar_authorisation'))).toContain(
      'Cel mult 10 pagini pe document',
    );
    const asks = http.match((r) => r.url === `${BASE}/upload-url`);
    expect(asks).toHaveLength(10);
    for (const ask of asks) {
      ask.flush(
        { code: 'storage_unavailable' },
        { status: 503, statusText: '' },
      );
    }
    await settle();
  });

  it('refuses a certificate issued more than 30 days ago, and sends nothing', async () => {
    await open();

    await bothReady();
    await date('onrc_certificate', localDate(31));

    expect(text(area('onrc_certificate'))).toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
    expect(send().disabled).toBe(true);
  });

  it('reads "Upload is not available right now" with the store down, and sends the page again', async () => {
    await open('en');

    await choose('onrc_certificate', [pdf()]);
    asked().flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle();
    expect(alerts()).toContain('Upload is not available right now');

    (
      area('onrc_certificate').querySelector('[data-retry]') as HTMLElement
    ).click();
    await settle();
    await store();

    expect(pages('onrc_certificate').map(text)).toEqual([
      'Page 1 pagina.pdf uploaded Remove',
    ]);
    expect(alerts()).toEqual([]);
  });

  it('reads "Încărcarea nu e disponibilă acum" in Romanian', async () => {
    await open();

    await choose('onrc_certificate', [pdf()]);
    http
      .expectOne((r) => r.url === `${BASE}/upload-url`)
      .flush({ code: 'storage_unavailable' }, { status: 503, statusText: '' });
    await settle();

    expect(alerts()).toContain('Încărcarea nu e disponibilă acum');
  });

  it('keeps the pages across a failed send and sends them again', async () => {
    await open();

    const { certificate, rar } = await bothReady();
    send().click();
    await settle();
    submitted().flush(
      { code: 'internal' },
      { status: 500, statusText: 'Server Error' },
    );
    await settle();

    expect(alerts()).toContain(
      'Nu am putut trimite documentele. Încearcă din nou.',
    );
    expect(pages('onrc_certificate')).toHaveLength(1);
    expect(pages('rar_authorisation')).toHaveLength(1);
    send().click();
    await settle();
    const again = submitted();
    expect(
      again.request.body.documents.map((d: { pages: string[] }) => d.pages),
    ).toEqual([[certificate], [rar]]);
    again.flush(CYCLE, { status: 201, statusText: 'Created' });
    await settle();

    await expect(result).resolves.toEqual(CYCLE);
  });

  it('sends one kind alone and tells "Încarcă ambele documente" when the other is owed', async () => {
    await open();

    await choose('rar_authorisation', [pdf()]);
    await store();
    await date('rar_authorisation', '2025-06-01');
    expect(send().disabled).toBe(false);
    send().click();
    await settle();
    submitted().flush(
      { code: 'both_documents_required' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settle();

    expect(alerts()).toContain('Încarcă ambele documente');
    expect(pages('rar_authorisation')).toHaveLength(1);
  });
});
