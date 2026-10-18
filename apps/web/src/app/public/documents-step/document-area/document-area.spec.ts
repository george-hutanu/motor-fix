import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { DocumentArea } from './document-area';
import { sendMeasurementsTo } from '../../../telemetry/browser/measure/measure';

const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const TOKEN = 'k'.repeat(43);
const BASE = `/api/v1/listing-drafts/${DRAFT}/documents/onrc_certificate`;
const STORE = 'https://store.test/motorfix';
const KEY = `legal_document/${DRAFT}/00000000-0000-4000-8000-000000000001`;

async function open() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(DocumentArea);
  fixture.componentRef.setInput('kind', 'onrc_certificate');
  fixture.componentRef.setInput('draftId', DRAFT);
  fixture.componentRef.setInput('token', TOKEN);
  const http = TestBed.inject(HttpTestingController);
  const area = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { area, fixture, http, settle };
}

type Opened = Awaited<ReturnType<typeof open>>;

async function choose({ area, settle }: Opened, files: File[]) {
  const input = area.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  await settle();
}

const page = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'certificat.pdf', {
    type: 'application/pdf',
  });

const asked = (http: HttpTestingController): TestRequest =>
  http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/upload-url`);

let measured: [string, Record<string, number>, Record<string, string>][];

beforeEach(() => {
  measured = [];
  sendMeasurementsTo((...args) => measured.push(args));
});

afterEach(() => sendMeasurementsTo(undefined));

describe('a document page sent to the store', () => {
  // @traces 1191-FR-006
  it('asks with the checksum, PUTs with the address headers and confirms the page', async () => {
    const opened = await open();

    await choose(opened, [page()]);
    const ask = asked(opened.http);
    expect(ask.request.body).toEqual({
      checksum: expect.stringMatching(/^[A-Za-z0-9+/]{6}==$/),
      contentType: 'application/pdf',
      size: 4,
    });
    ask.flush({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-crc32': ask.request.body.checksum,
      },
      key: `incoming/${KEY}`,
      url: STORE,
    });
    await opened.settle();
    const put = opened.http.expectOne(STORE);
    expect(put.request.method).toBe('PUT');
    expect(put.request.headers.get('x-amz-checksum-crc32')).toBe(
      ask.request.body.checksum,
    );
    expect(put.request.headers.get('Content-Type')).toBe('application/pdf');
    put.flush(null, { status: 200, statusText: 'OK' });
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'POST' && r.url === BASE)
      .flush({ kind: 'onrc_certificate', pages: [KEY] });
    await opened.settle();

    expect(opened.fixture.componentInstance.pages()).toEqual([KEY]);
  });

  // @traces 1191-FR-011
  it('measures a sent page with its duration and a refused address as failed, naming nothing personal', async () => {
    const opened = await open();

    await choose(opened, [page()]);
    asked(opened.http).flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();
    (opened.area.querySelector('button.retry') as HTMLButtonElement).click();
    await opened.settle();
    asked(opened.http).flush({
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      headers: {},
      key: `incoming/${KEY}`,
      url: STORE,
    });
    await opened.settle();
    opened.http.expectOne(STORE).flush(null, { status: 200, statusText: 'OK' });
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'POST' && r.url === BASE)
      .flush({ kind: 'onrc_certificate', pages: [KEY] });
    await opened.settle();

    expect(measured.map(([type, , context]) => [type, context])).toEqual([
      ['upload', { outcome: 'failed', purpose: 'legal_document' }],
      ['upload', { outcome: 'sent', purpose: 'legal_document' }],
    ]);
    expect(measured[0]?.[1]).toEqual({});
    expect(Object.keys(measured[1]?.[1] ?? {})).toEqual(['duration']);
    expect(measured[1]?.[1]['duration']).toBeGreaterThanOrEqual(0);
    const said = JSON.stringify(measured);
    expect(said).not.toContain(DRAFT);
    expect(said).not.toContain('certificat');
    expect(said).not.toContain('incoming/');
  });
});
