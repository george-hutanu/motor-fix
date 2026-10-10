import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CdkDropList } from '@angular/cdk/drag-drop';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { DraftDocuments, ListingDraftData } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { DocumentsStep } from './documents-step';

const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const TOKEN = 'k'.repeat(43);
const API = `/api/v1/listing-drafts/${DRAFT}/documents`;
const CERTIFICATE = `${API}/onrc_certificate`;
const AUTHORISATION = `${API}/rar_authorisation`;
const STORE = 'https://store.test/motorfix';
const keyOf = (n: number) =>
  `legal_document/${DRAFT}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The device's calendar date, `days` before today, as YYYY-MM-DD.
const daysAgo = (days: number) => {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

type Declaration = Pick<ListingDraftData, 'declaredAt' | 'declaredByName'>;

interface Options {
  draftId?: string;
  declaration?: Declaration;
  documents?: DraftDocuments;
  kind?: string;
  language?: 'ro' | 'en';
}

async function open({
  draftId = DRAFT,
  declaration = {},
  documents = {},
  kind = 'company',
  language = 'ro',
}: Options = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(DocumentsStep);
  fixture.componentRef.setInput('draftId', draftId);
  fixture.componentRef.setInput('token', draftId ? TOKEN : undefined);
  fixture.componentRef.setInput('kind', kind);
  fixture.componentRef.setInput('documents', documents);
  fixture.componentRef.setInput('declaration', declaration);
  const http = TestBed.inject(HttpTestingController);
  const step = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { fixture, http, i18n, settle, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const area = (step: HTMLElement, kind: string) =>
  step.querySelector<HTMLElement>(`.area[data-kind="${kind}"]`) as HTMLElement;
const certificate = (step: HTMLElement) => area(step, 'onrc_certificate');
const authorisation = (step: HTMLElement) => area(step, 'rar_authorisation');
const picker = (section: HTMLElement) =>
  section.querySelector<HTMLInputElement>(
    'input[type="file"]',
  ) as HTMLInputElement;
const pages = (section: HTMLElement) => [
  ...section.querySelectorAll<HTMLElement>('li.page'),
];
const button = (scope: HTMLElement | undefined, name: RegExp) =>
  [...(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => name.test(text(b)) || name.test(b.getAttribute('aria-label') ?? ''),
  ) as HTMLButtonElement;
const announced = (section: HTMLElement) =>
  text(section.querySelector('.announce[aria-live="polite"]'));
const dateField = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>('input[type="date"]');
const documentsOf = ({ fixture }: Opened) =>
  fixture.componentInstance.documents();

const file = (name: string, type = 'application/pdf', size = 2048) => {
  const made = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

async function choose(opened: Opened, section: HTMLElement, files: File[]) {
  const input = picker(section);
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  await opened.settle();
}

const askedForAddress = (http: HttpTestingController, base: string) =>
  http.match(
    (req) => req.method === 'POST' && req.url === `${base}/upload-url`,
  );

// Ask, send to the store and confirm, as the uploader does for one file;
// the server answers the document with the new page last.
async function upload(
  opened: Opened,
  req: TestRequest,
  base: string,
  held: string[],
  n: number,
) {
  req.flush({
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    fields: { key: `incoming/${keyOf(n)}` },
    key: `incoming/${keyOf(n)}`,
    url: STORE,
  });
  await opened.settle();
  opened.http
    .expectOne(STORE)
    .flush(null, { status: 204, statusText: 'No Content' });
  await opened.settle();
  const confirm = opened.http.expectOne(
    (r) => r.method === 'POST' && r.url === base,
  );
  expect(confirm.request.body).toEqual({ key: `incoming/${keyOf(n)}` });
  confirm.flush({
    kind: base.endsWith('onrc_certificate')
      ? 'onrc_certificate'
      : 'rar_authorisation',
    pages: [...held, keyOf(n)],
  });
  await opened.settle();
}

beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:local';
  URL.revokeObjectURL ??= () => undefined;
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
});

// @traces 206-FR-001
describe('step 6, the documents', () => {
  it('asks for the certificate, then the authorisation, each with its hint and a picker for PDF, JPG and PNG', async () => {
    const { step } = await open();

    const both = [...step.querySelectorAll('.area[data-kind]')];
    expect(both.map((s) => s.getAttribute('data-kind'))).toEqual([
      'onrc_certificate',
      'rar_authorisation',
    ]);
    expect(text(step)).toContain('Documente');
    expect(text(certificate(step))).toContain('Certificat constatator ONRC');
    expect(text(certificate(step))).toContain(
      'Emis în ultimele 30 de zile, cu adresa atelierului',
    );
    expect(text(authorisation(step))).toContain('Autorizația tehnică RAR');
    expect(text(authorisation(step))).toContain(
      'Toate paginile, scanate sau fotografiate lizibil',
    );
    for (const section of [certificate(step), authorisation(step)]) {
      expect(text(section)).toContain('Trage aici fișierul');
      expect(button(section, /^Alege fișiere$/)).toBeTruthy();
      expect(picker(section).accept).toBe(
        'application/pdf,image/jpeg,image/png',
      );
      expect(picker(section).multiple).toBe(true);
      expect(pages(section)).toEqual([]);
    }
  });

  it('asks a mobile mechanic for the registered seat, and follows the kind as it changes', async () => {
    const opened = await open({ kind: 'mobile' });

    expect(text(certificate(opened.step))).toContain(
      'Emis în ultimele 30 de zile, cu sediul social',
    );

    opened.fixture.componentRef.setInput('kind', 'pfa');
    await opened.settle();

    expect(text(certificate(opened.step))).toContain(
      'Emis în ultimele 30 de zile, cu adresa atelierului',
    );
  });

  // @traces 206-FR-015
  it('says it all in English and keeps the pages and the date when the language changes', async () => {
    const issuedOn = daysAgo(3);
    const opened = await open({
      documents: { onrc_certificate: { issuedOn, pages: [keyOf(0)] } },
    });

    await opened.i18n.use('en');
    await opened.settle();

    expect(text(opened.step)).toContain('Documents');
    expect(text(certificate(opened.step))).toContain(
      'ONRC company certificate',
    );
    expect(text(certificate(opened.step))).toContain(
      'Issued in the last 30 days, showing the workshop address',
    );
    expect(text(authorisation(opened.step))).toContain(
      'RAR technical authorisation',
    );
    expect(text(authorisation(opened.step))).toContain(
      'All pages, as a readable scan or photo',
    );
    expect(text(certificate(opened.step))).toContain('Drop the file here');
    expect(text(pages(certificate(opened.step))[0])).toContain('Page 1');
    expect(dateField(opened.step)?.value).toBe(issuedOn);
    expect(documentsOf(opened)).toEqual({
      onrc_certificate: { issuedOn, pages: [keyOf(0)] },
    });
  });

  // @traces 206-FR-008
  it('tells a visitor with no e-mail yet to add one, and takes no files', async () => {
    const { http, step } = await open({ draftId: '' });

    for (const section of [certificate(step), authorisation(step)]) {
      expect(text(section)).toContain(
        'Adaugă un e‑mail la pasul 1 ca să încarci documente',
      );
      expect(picker(section).disabled).toBe(true);
    }
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    certificate(step).querySelector('.drop')?.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    http.expectNone(() => true);
  });
});

// @traces 206-FR-002
// @traces 206-FR-003
describe('uploading the pages', () => {
  it('refuses a file of another type or over 10 MB before asking, and uploads the rest', async () => {
    const opened = await open();

    await choose(opened, certificate(opened.step), [
      file('contract.docx', 'application/msword'),
      file('poza.heic', 'image/heic'),
      file('mare.pdf', 'application/pdf', 10 * 1024 * 1024 + 1),
      file('certificat.pdf'),
    ]);

    expect(text(certificate(opened.step))).toContain(
      'Doar PDF, JPG sau PNG, de cel mult 10 MB',
    );
    const asked = askedForAddress(opened.http, CERTIFICATE);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.request.body).toEqual({
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(asked[0]?.request.headers.get('x-listing-token')).toBe(TOKEN);
    expect(askedForAddress(opened.http, AUTHORISATION)).toHaveLength(0);
  });

  it('takes no more than 10 files per document, counting those held and those on their way', async () => {
    const held = Array.from({ length: 8 }, (_, i) => keyOf(i));
    const opened = await open({
      documents: { rar_authorisation: { pages: held } },
    });

    await choose(opened, authorisation(opened.step), [
      file('a.jpg', 'image/jpeg'),
      file('b.png', 'image/png'),
      file('c.jpg', 'image/jpeg'),
    ]);

    expect(askedForAddress(opened.http, AUTHORISATION)).toHaveLength(2);
    expect(text(authorisation(opened.step))).toContain(
      'Cel mult 10 fișiere pe document',
    );
    expect(text(certificate(opened.step))).not.toContain(
      'Cel mult 10 fișiere pe document',
    );
  });

  it('shows the progress, then the page as "Pagina 1" with its file name, and keeps its key on the draft', async () => {
    const opened = await open();

    await choose(opened, certificate(opened.step), [file('certificat.pdf')]);
    const [asked] = askedForAddress(opened.http, CERTIFICATE);
    (asked as TestRequest).flush({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      fields: { key: `incoming/${keyOf(0)}` },
      key: `incoming/${keyOf(0)}`,
      url: STORE,
    });
    await opened.settle();
    expect(
      pages(certificate(opened.step))[0]?.querySelector('progress'),
    ).toBeTruthy();
    opened.http
      .expectOne(STORE)
      .flush(null, { status: 204, statusText: 'No Content' });
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'POST' && r.url === CERTIFICATE)
      .flush({ kind: 'onrc_certificate', pages: [keyOf(0)] });
    await opened.settle();

    const [page] = pages(certificate(opened.step));
    expect(text(page)).toContain('Pagina 1');
    expect(text(page)).toContain('certificat.pdf');
    expect(page?.querySelector('progress')).toBeNull();
    expect(documentsOf(opened)).toEqual({
      onrc_certificate: { pages: [keyOf(0)] },
    });
    expect(announced(certificate(opened.step))).toContain(
      'Pagina 1 este încărcată',
    );
  });

  it('says the upload failed and retries on demand', async () => {
    const opened = await open();

    await choose(opened, authorisation(opened.step), [
      file('pagina.jpg', 'image/jpeg'),
    ]);
    askedForAddress(opened.http, AUTHORISATION)[0]?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();

    const [page] = pages(authorisation(opened.step));
    expect(text(page)).toContain(
      'Nu am putut încărca fișierul. Încearcă din nou.',
    );
    button(page, /^Reîncearcă$/).click();
    await opened.settle();
    const [again] = askedForAddress(opened.http, AUTHORISATION);
    await upload(opened, again as TestRequest, AUTHORISATION, [], 0);

    expect(text(authorisation(opened.step))).not.toContain(
      'Nu am putut încărca fișierul',
    );
    expect(documentsOf(opened)).toEqual({
      rar_authorisation: { pages: [keyOf(0)] },
    });
  });

  it('drops a page the server refuses at confirm, says why, and never sends it again', async () => {
    const opened = await open();

    await choose(opened, certificate(opened.step), [file('fals.pdf')]);
    askedForAddress(opened.http, CERTIFICATE)[0]?.flush({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      fields: {},
      key: `incoming/${keyOf(0)}`,
      url: STORE,
    });
    await opened.settle();
    opened.http
      .expectOne(STORE)
      .flush(null, { status: 204, statusText: 'No Content' });
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'POST' && r.url === CERTIFICATE)
      .flush(
        { code: 'file_type_mismatch' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await opened.settle();

    expect(pages(certificate(opened.step))).toEqual([]);
    expect(text(certificate(opened.step))).toContain(
      'Doar PDF, JPG sau PNG, de cel mult 10 MB',
    );
    window.dispatchEvent(new Event('online'));
    await opened.settle();
    expect(askedForAddress(opened.http, CERTIFICATE)).toHaveLength(0);
  });

  it('says 10 is the most when the document filled up from elsewhere', async () => {
    const opened = await open();

    await choose(opened, certificate(opened.step), [file('certificat.pdf')]);
    askedForAddress(opened.http, CERTIFICATE)[0]?.flush(
      { code: 'document_full' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await opened.settle();

    expect(pages(certificate(opened.step))).toEqual([]);
    expect(text(certificate(opened.step))).toContain(
      'Cel mult 10 fișiere pe document',
    );
  });

  // @traces 206-FR-008
  it('keeps files chosen offline waiting, then uploads them in order when the connection returns', async () => {
    const opened = await open();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await choose(opened, authorisation(opened.step), [
      file('unu.jpg', 'image/jpeg'),
      file('doi.jpg', 'image/jpeg'),
    ]);

    expect(askedForAddress(opened.http, AUTHORISATION)).toHaveLength(0);
    expect(pages(authorisation(opened.step))).toHaveLength(2);
    expect(text(authorisation(opened.step))).toContain(
      'Se încarcă când revine conexiunea',
    );

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));
    await opened.settle();

    const [first, second] = askedForAddress(opened.http, AUTHORISATION);
    expect(first?.request.body.size).toBe(2048);
    await upload(opened, first as TestRequest, AUTHORISATION, [], 0);
    await upload(opened, second as TestRequest, AUTHORISATION, [keyOf(0)], 1);
    expect(documentsOf(opened)).toEqual({
      rar_authorisation: { pages: [keyOf(0), keyOf(1)] },
    });
  });

  // @traces 206-FR-015
  it('tells by words, not only colour, that files are being dragged over it', async () => {
    const { settle, step } = await open();
    const zone = certificate(step).querySelector('.drop') as HTMLElement;

    zone.dispatchEvent(new Event('dragenter'));
    await settle();
    expect(text(certificate(step))).toContain('Lasă fișierele aici');
    expect(zone.classList).toContain('over');

    zone.dispatchEvent(new Event('dragleave'));
    await settle();
    expect(text(certificate(step))).not.toContain('Lasă fișierele aici');
  });
});

// @traces 206-FR-008
describe('ordering and removing the pages', () => {
  const three = {
    rar_authorisation: { pages: [keyOf(0), keyOf(1), keyOf(2)] },
  };

  it('labels the saved pages "Pagina <n>" in order', async () => {
    const opened = await open({ documents: three });

    expect(pages(authorisation(opened.step)).map((p) => text(p))).toEqual([
      expect.stringContaining('Pagina 1'),
      expect.stringContaining('Pagina 2'),
      expect.stringContaining('Pagina 3'),
    ]);
    expect(
      pages(authorisation(opened.step)).map((p) => p.dataset['key']),
    ).toEqual([keyOf(0), keyOf(1), keyOf(2)]);
  });

  it('disables moving earlier at the start and later at the end', async () => {
    const opened = await open({ documents: three });
    const shown = pages(authorisation(opened.step));

    expect(button(shown[0], /Mută înainte/).disabled).toBe(true);
    expect(button(shown[0], /Mută înapoi/).disabled).toBe(false);
    expect(button(shown[2], /Mută înainte/).disabled).toBe(false);
    expect(button(shown[2], /Mută înapoi/).disabled).toBe(true);
  });

  it('moves a page by keyboard, keeps the focus on it and announces its place', async () => {
    const opened = await open({ documents: three });

    const later = button(pages(authorisation(opened.step))[0], /Mută înapoi/);
    later.focus();
    later.click();
    await opened.settle();

    expect(documentsOf(opened)).toEqual({
      rar_authorisation: { pages: [keyOf(1), keyOf(0), keyOf(2)] },
    });
    expect(
      pages(authorisation(opened.step))[1]?.contains(document.activeElement),
    ).toBe(true);
    expect(announced(authorisation(opened.step))).toContain('Pagina 2 din 3');
  });

  it('moves a page dropped by pointer or touch to its new place', async () => {
    const opened = await open({ documents: three });

    const list = opened.fixture.debugElement
      .query(By.css('.area[data-kind="rar_authorisation"] ol'))
      .injector.get(CdkDropList);
    list.dropped.emit({ currentIndex: 0, previousIndex: 2 } as never);
    await opened.settle();

    expect(documentsOf(opened)).toEqual({
      rar_authorisation: { pages: [keyOf(2), keyOf(0), keyOf(1)] },
    });
  });

  it('removes a page at once, closes the gap and deletes it', async () => {
    const opened = await open({ documents: three });

    const remove = button(pages(authorisation(opened.step))[0], /Șterge/);
    expect(remove.getAttribute('aria-label')).toContain('1');
    remove.click();
    await opened.settle();

    expect(documentsOf(opened)).toEqual({
      rar_authorisation: { pages: [keyOf(1), keyOf(2)] },
    });
    expect(text(pages(authorisation(opened.step))[0])).toContain('Pagina 1');
    const deleted = opened.http.expectOne(
      (r) => r.method === 'DELETE' && r.url.startsWith(`${AUTHORISATION}/`),
    );
    expect(deleted.request.url).toBe(
      `${AUTHORISATION}/${encodeURIComponent(keyOf(0))}`,
    );
    expect(deleted.request.headers.get('x-listing-token')).toBe(TOKEN);
  });

  it('drops the document and its issue date with its last page', async () => {
    const opened = await open({
      documents: {
        onrc_certificate: { issuedOn: daysAgo(1), pages: [keyOf(0)] },
      },
    });

    button(pages(certificate(opened.step))[0], /Șterge/).click();
    await opened.settle();

    expect(documentsOf(opened)).toEqual({});
    expect(dateField(opened.step)).toBeNull();
  });

  it('cancels an upload still on its way when its page is removed', async () => {
    const opened = await open();

    await choose(opened, certificate(opened.step), [file('certificat.pdf')]);
    askedForAddress(opened.http, CERTIFICATE)[0]?.flush({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      fields: {},
      key: `incoming/${keyOf(0)}`,
      url: STORE,
    });
    await opened.settle();
    const sending = opened.http.expectOne(STORE);

    button(pages(certificate(opened.step))[0], /Șterge/).click();
    await opened.settle();

    expect(sending.cancelled).toBe(true);
    expect(pages(certificate(opened.step))).toEqual([]);
    opened.http.expectNone((r) => r.method === 'POST' && r.url === CERTIFICATE);
  });
});

// @traces 206-FR-007
// @traces 206-FR-017
describe('the certificate issue date', () => {
  const held = { onrc_certificate: { pages: [keyOf(0)] } };
  const type = async (opened: Opened, value: string) => {
    const field = dateField(opened.step) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await opened.settle();
  };
  const leave = async (opened: Opened) => {
    dateField(opened.step)?.dispatchEvent(new Event('blur'));
    await opened.settle();
  };

  it('is asked only once the certificate has a page, within the last 30 days', async () => {
    const empty = await open();
    expect(dateField(empty.step)).toBeNull();
    TestBed.resetTestingModule();

    const opened = await open({ documents: held });
    const field = dateField(opened.step) as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(text(opened.step)).toContain('Data emiterii certificatului');
    expect(field.min).toBe(daysAgo(30));
    expect(field.max).toBe(daysAgo(0));
    expect(certificate(opened.step).contains(field)).toBe(true);
  });

  it('keeps a date of today or 30 days ago', async () => {
    const opened = await open({ documents: held });

    await type(opened, daysAgo(30));
    await leave(opened);
    expect(documentsOf(opened).onrc_certificate?.issuedOn).toBe(daysAgo(30));

    await type(opened, daysAgo(0));
    await leave(opened);
    expect(documentsOf(opened).onrc_certificate?.issuedOn).toBe(daysAgo(0));
    expect(text(opened.step)).not.toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
  });

  it('refuses a date 31 days ago or tomorrow without keeping it, and says so once the field is left', async () => {
    const opened = await open({ documents: held });

    await type(opened, daysAgo(31));
    expect(documentsOf(opened).onrc_certificate?.issuedOn).toBeUndefined();
    expect(text(opened.step)).not.toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
    await leave(opened);
    expect(text(opened.step)).toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
    expect(dateField(opened.step)?.getAttribute('aria-invalid')).toBe('true');

    await type(opened, daysAgo(-1));
    await leave(opened);
    expect(documentsOf(opened).onrc_certificate).toEqual({
      pages: [keyOf(0)],
    });
    expect(text(opened.step)).toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
  });

  it('says a restored date has aged past the window, and keeps it as saved', async () => {
    const opened = await open({
      documents: {
        onrc_certificate: { issuedOn: daysAgo(40), pages: [keyOf(0)] },
      },
    });

    expect(dateField(opened.step)?.value).toBe(daysAgo(40));
    expect(text(opened.step)).toContain(
      'Certificatul trebuie să fie emis în ultimele 30 de zile',
    );
    expect(documentsOf(opened).onrc_certificate?.issuedOn).toBe(daysAgo(40));
  });
});

describe('the declaration', () => {
  const box = (step: HTMLElement) =>
    step.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
  const nameField = (step: HTMLElement) =>
    step.querySelector<HTMLInputElement>(
      '#listing-declared-name',
    ) as HTMLInputElement;
  const nameErrorText = (step: HTMLElement) =>
    text(step.querySelector('#listing-declared-name-error'));
  const declarationOf = ({ fixture }: Opened) =>
    fixture.componentInstance.declaration();

  async function tick(opened: Opened) {
    box(opened.step).click();
    await opened.settle();
  }

  async function typeName(opened: Opened, value: string) {
    const input = nameField(opened.step);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await opened.settle();
  }

  async function leaveName(opened: Opened) {
    nameField(opened.step).dispatchEvent(new Event('blur'));
    await opened.settle();
  }

  // @traces 206-FR-009
  it.each([
    [
      'ro' as const,
      'Declar că datele sunt reale și că reprezint legal acest service.',
      'Numele și prenumele tău',
    ],
    [
      'en' as const,
      'I declare the details are true and that I legally represent this garage.',
      'Your full name',
    ],
  ])(
    'in %s, asks under the documents for the tick and the full name',
    async (language, sentence, label) => {
      const { step } = await open({ language });

      const tickBox = box(step);
      expect(tickBox.checked).toBe(false);
      expect(text(tickBox.closest('label'))).toBe(sentence);
      expect(
        authorisation(step).compareDocumentPosition(tickBox) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        text(step.querySelector('label[for="listing-declared-name"]')),
      ).toBe(label);
      expect(nameField(step).maxLength).toBe(80);
      expect(nameField(step).getAttribute('autocomplete')).toBe('name');
    },
  );

  // @traces 206-FR-009
  it('marks the declaration when ticked and clears it when unticked', async () => {
    const opened = await open();

    await tick(opened);
    expect(declarationOf(opened).declaredAt).toEqual(expect.any(String));

    await tick(opened);
    expect(declarationOf(opened)).toEqual({});
  });

  // @traces 206-FR-009
  it('keeps the name trimmed once it has 2 to 80 characters, and none shorter, showing what was typed', async () => {
    const opened = await open();

    await typeName(opened, '  Ion Popescu ');
    expect(declarationOf(opened)).toEqual({ declaredByName: 'Ion Popescu' });
    expect(nameField(opened.step).value).toBe('  Ion Popescu ');

    await typeName(opened, ' I ');
    expect(declarationOf(opened)).toEqual({});
    expect(nameField(opened.step).value).toBe(' I ');
  });

  // @traces 206-FR-009
  it('asks for the full name of a tick only once the field is left, and clears it when the name is whole', async () => {
    const opened = await open();
    await tick(opened);
    await typeName(opened, 'I');
    expect(nameErrorText(opened.step)).toBe('');
    expect(nameField(opened.step).getAttribute('aria-invalid')).toBeNull();

    await leaveName(opened);
    expect(nameErrorText(opened.step)).toBe('Scrie numele tău complet');
    expect(nameField(opened.step).getAttribute('aria-invalid')).toBe('true');
    expect(nameField(opened.step).getAttribute('aria-describedby')).toBe(
      'listing-declared-name-error',
    );
    expect(
      opened.step
        .querySelector('#listing-declared-name-error')
        ?.closest('[aria-live="polite"]'),
    ).not.toBeNull();

    await typeName(opened, 'Ion');
    expect(nameErrorText(opened.step)).toBe('');
  });

  // @traces 206-FR-009
  it('opens a kept declaration ticked, with its name and its time', async () => {
    const declaration = {
      declaredAt: '2026-10-09T08:00:00.000Z',
      declaredByName: 'Ion Popescu',
    };
    const opened = await open({ declaration });

    expect(box(opened.step).checked).toBe(true);
    expect(nameField(opened.step).value).toBe('Ion Popescu');
    await typeName(opened, 'Ion Popescu-Ionescu');
    expect(declarationOf(opened)).toEqual({
      declaredAt: '2026-10-09T08:00:00.000Z',
      declaredByName: 'Ion Popescu-Ionescu',
    });
  });

  // @traces 206-FR-015
  it('gives the tick a target of the full tap height', async () => {
    const { step } = await open();

    expect(box(step).closest('label')?.classList).toContain('choice');
    // The sweep measures the checkbox itself: its box is drawn smaller inside.
    const css = readFileSync(join(__dirname, 'documents-step.css'), 'utf8');
    expect(css).toMatch(/\.choice input \{[^}]*\swidth:\s*var\(--mf-tap\)/);
    expect(css).toMatch(/\.choice input \{[^}]*\sheight:\s*var\(--mf-tap\)/);
  });
});
