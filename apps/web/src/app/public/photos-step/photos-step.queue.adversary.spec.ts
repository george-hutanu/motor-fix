// @traces 1191-FR-001
// @traces 1191-FR-002
// @traces 1191-FR-008
// @traces 1191-FR-011
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { PhotosStep } from './photos-step';
import { UploadQueue } from './upload-queue/upload-queue';
import { sendMeasurementsTo } from '../../telemetry/browser/measure/measure';

const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const OTHER = '0f0e0d0c-0b0a-4908-8706-050403020100';
const TOKEN = 'k'.repeat(43);
const BASE = `/api/v1/listing-drafts/${DRAFT}/photos`;
const STORE = 'https://store.test/motorfix';
const keyOf = (n: number) =>
  `garage_photo/${DRAFT}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });

async function open(
  language: 'ro' | 'en' = 'ro',
  queued: { draftId: string; files: File[]; patch?: object }[] = [],
) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const queue = TestBed.inject(UploadQueue);
  for (const { draftId, files, patch } of queued) {
    const added = await queue.add(draftId, files);
    if (patch) for (const e of added) await queue.update(e.id, patch);
  }
  const fixture = TestBed.createComponent(PhotosStep);
  fixture.componentRef.setInput('draftId', DRAFT);
  fixture.componentRef.setInput('token', TOKEN);
  fixture.componentRef.setInput('kind', 'company');
  fixture.componentRef.setInput('files', []);
  const http = TestBed.inject(HttpTestingController);
  const step = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      for (let m = 0; m < 10; m++) await Promise.resolve();
    }
    fixture.detectChanges();
  };
  await settle();
  return { fixture, http, queue, settle, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const chip = (step: HTMLElement) =>
  step.querySelector<HTMLElement>('.queued[role="status"]');
const tiles = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLElement>('li.photo'),
];
const photo = (name: string, type = 'image/jpeg') =>
  new File([new Uint8Array(8)], name, { type });
const asked = (http: HttpTestingController) =>
  http.match((r) => r.method === 'POST' && r.url === `${BASE}/upload-url`);
const confirmOf = (http: HttpTestingController) =>
  http.expectOne((r) => r.method === 'POST' && r.url === BASE);

async function choose({ settle, step }: Opened, files: File[]) {
  const input = step.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await settle();
}

async function toTheStore(opened: Opened, req: TestRequest, n: number) {
  req.flush({
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    headers: { 'x-amz-checksum-crc32': 'AAAAAA==' },
    key: `incoming/${keyOf(n)}`,
    url: STORE,
  });
  await opened.settle();
  opened.http.expectOne(STORE).flush(null, { status: 200, statusText: 'OK' });
  await opened.settle();
}

beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:local';
  URL.revokeObjectURL ??= () => undefined;
});

afterEach(() => setOnline(true));

describe('the chip of photos waiting for signal, at the edges', () => {
  it.each([
    [2, '2 fotografii așteaptă semnal'],
    [5, '5 fotografii așteaptă semnal'],
    [10, '10 fotografii așteaptă semnal'],
    [15, '15 fotografii așteaptă semnal'],
    [18, '18 fotografii așteaptă semnal'],
    [3, '3 fotografii așteaptă semnal'],
    [19, '19 fotografii așteaptă semnal'],
    [20, '20 de fotografii așteaptă semnal'],
  ])('reads %i in Romanian as %j', async (count, said) => {
    setOnline(false);
    const opened = await open();

    await choose(
      opened,
      Array.from({ length: count }, (_, i) => photo(`p${i}.jpg`)),
    );

    expect(text(chip(opened.step))).toBe(said);
  });

  it('reads 20 in English as plural and 0 as nothing', async () => {
    setOnline(false);
    const opened = await open('en');
    expect(text(chip(opened.step))).toBe('');

    await choose(
      opened,
      Array.from({ length: 20 }, (_, i) => photo(`p${i}.jpg`)),
    );

    expect(text(chip(opened.step))).toBe('20 photos waiting for signal');
  });

  it('is a polite status region and stays one when it is empty', async () => {
    const opened = await open();

    const region = chip(opened.step);
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(text(region)).toBe('');
  });

  it('does not count a refused file picked next to a good one', async () => {
    setOnline(false);
    const opened = await open();

    await choose(opened, [
      photo('ok.jpg'),
      photo('anim.gif', 'image/gif'),
      photo('doc.pdf', 'application/pdf'),
    ]);

    expect(text(chip(opened.step))).toBe('O fotografie așteaptă semnal');
    expect(
      (await opened.queue.forDraft(DRAFT)).map((e) => e.file.name),
    ).toEqual(['ok.jpg']);
  });

  it('keeps no more than 20 photos in the browser queue across several picks', async () => {
    setOnline(false);
    const opened = await open();

    await choose(
      opened,
      Array.from({ length: 15 }, (_, i) => photo(`a${i}.jpg`)),
    );
    await choose(
      opened,
      Array.from({ length: 10 }, (_, i) => photo(`b${i}.jpg`)),
    );

    expect(await opened.queue.forDraft(DRAFT)).toHaveLength(20);
    expect(tiles(opened.step)).toHaveLength(20);
    expect(text(chip(opened.step))).toBe('20 de fotografii așteaptă semnal');
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
  });
});

describe('what a drain does and does not touch', () => {
  it('sends nothing of another draft that sits in the same browser queue', async () => {
    const opened = await open('ro', [
      { draftId: OTHER, files: [photo('strain.jpg')] },
    ]);

    expect(asked(opened.http)).toEqual([]);
    expect(tiles(opened.step)).toEqual([]);
    expect(await opened.queue.forDraft(OTHER)).toHaveLength(1);
  });

  it('asks one address at a time however often the connection returns', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    setOnline(true);

    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('online'));
    await opened.settle();

    expect(asked(opened.http)).toHaveLength(1);
  });

  it('asks nothing when the connection returns after the step was destroyed', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('a.jpg')]);
    opened.fixture.destroy();
    setOnline(true);

    window.dispatchEvent(new Event('online'));
    await opened.settle();

    expect(asked(opened.http)).toEqual([]);
  });

  it('sends a restored photo whose removal was marked in flight as a confirm then a delete, never as a tile', async () => {
    const opened = await open('ro', [
      {
        draftId: DRAFT,
        files: [photo('gone.jpg')],
        patch: { key: `incoming/${keyOf(0)}`, removed: true },
      },
    ]);

    expect(tiles(opened.step)).toEqual([]);
    expect(asked(opened.http)).toEqual([]);
    confirmOf(opened.http).flush({
      key: keyOf(0),
      position: 0,
      processed: false,
    });
    await opened.settle();

    const deleted = opened.http.expectOne((r) => r.method === 'DELETE');
    expect(deleted.request.url).toBe(`${BASE}/${encodeURIComponent(keyOf(0))}`);
    deleted.flush(null, { status: 204, statusText: 'No Content' });
    await opened.settle();
    expect(tiles(opened.step)).toEqual([]);
    expect(opened.fixture.componentInstance.files()).toEqual([]);
    expect(await opened.queue.forDraft(DRAFT)).toEqual([]);
  });

  it('deletes nothing when a photo removed in flight is then refused at confirm', async () => {
    const opened = await open();
    await choose(opened, [photo('a.jpg')]);
    await toTheStore(opened, asked(opened.http)[0]!, 0);
    const confirm = confirmOf(opened.http);
    tiles(opened.step)[0]!
      .querySelector<HTMLButtonElement>('.tools button:last-child')!
      .click();
    await opened.settle();

    confirm.flush(
      { code: 'file_type_mismatch' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await opened.settle();

    opened.http.expectNone((r) => r.method === 'DELETE');
    expect(tiles(opened.step)).toEqual([]);
    expect(opened.fixture.componentInstance.files()).toEqual([]);
    expect(await opened.queue.forDraft(DRAFT)).toEqual([]);
  });
});

describe('what the upload measurements carry', () => {
  let measured: [string, Record<string, number>, Record<string, string>][];

  beforeEach(() => {
    measured = [];
    sendMeasurementsTo((...args) => measured.push(args));
  });
  afterEach(() => sendMeasurementsTo(undefined));

  it('carries only the purpose and the outcome, never a name, a draft id or a key', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('Popescu-Ion-atelier.jpg')]);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await opened.settle();
    await toTheStore(opened, asked(opened.http)[0]!, 0);
    confirmOf(opened.http).flush({
      key: keyOf(0),
      position: 0,
      processed: false,
    });
    await opened.settle();

    expect(measured.map(([type]) => type)).toEqual(
      measured.map(() => 'upload'),
    );
    expect(measured.map(([, , c]) => c['outcome'])).toEqual([
      'queued',
      'resumed',
      'sent',
    ]);
    for (const [, values, context] of measured) {
      expect(Object.keys(context).sort()).toEqual(['outcome', 'purpose']);
      expect(context['purpose']).toBe('garage_photo');
      expect(JSON.stringify([values, context])).not.toMatch(
        /Popescu|atelier|7c1f5d9e|garage_photo\/|incoming/,
      );
    }
    const durations = measured.map(([, values]) => 'duration' in values);
    expect(durations).toEqual([false, false, true]);
  });
});
