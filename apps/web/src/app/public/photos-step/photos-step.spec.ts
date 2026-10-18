import { CdkDropList } from '@angular/cdk/drag-drop';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { checkListing } from '@motor-fix/contracts/listing-check';
import { I18n } from '@motor-fix/i18n';

import { PhotosStep } from './photos-step';
import { UploadQueue } from './upload-queue/upload-queue';
import { sendMeasurementsTo } from '../../telemetry/browser/measure/measure';
import { forStep } from '../field-watch';

const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const TOKEN = 'k'.repeat(43);
const BASE = `/api/v1/listing-drafts/${DRAFT}/photos`;
const STORE = 'https://store.test/motorfix';
const keyOf = (n: number) =>
  `garage_photo/${DRAFT}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Options {
  draftId?: string;
  files?: string[];
  kind?: string;
  language?: 'ro' | 'en';
  // Photos left in the browser queue by an earlier visit to this draft.
  queued?: File[];
}

async function open({
  draftId = DRAFT,
  files = [],
  kind = 'company',
  language = 'ro',
  queued = [],
}: Options = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  if (queued.length) await TestBed.inject(UploadQueue).add(draftId, queued);
  return mount({ draftId, files, kind }, i18n);
}

// The step as the page shows it; a second mount on the same TestBed is the
// draft opened again on the same browser, its queue still there.
async function mount(
  {
    draftId,
    files,
    kind,
  }: Required<Pick<Options, 'draftId' | 'files' | 'kind'>>,
  i18n: I18n,
) {
  const fixture = TestBed.createComponent(PhotosStep);
  fixture.componentRef.setInput('draftId', draftId);
  fixture.componentRef.setInput('token', draftId ? TOKEN : undefined);
  fixture.componentRef.setInput('kind', kind);
  fixture.componentRef.setInput('files', files);
  const http = TestBed.inject(HttpTestingController);
  const step = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      // The queue, the shrinking (one photo after another) and the checksum
      // answer through a chain of promises.
      for (let m = 0; m < 100; m++) await Promise.resolve();
    }
    fixture.detectChanges();
  };
  await settle();
  const reopen = async () => {
    fixture.destroy();
    return mount({ draftId, files, kind }, i18n);
  };
  return { fixture, http, i18n, reopen, settle, step };
}

type Opened = Awaited<ReturnType<typeof mount>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const picker = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>(
    'input[type="file"]',
  ) as HTMLInputElement;
const tiles = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLElement>('li.photo'),
];
const button = (tile: HTMLElement | undefined, name: RegExp) =>
  [...(tile?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => name.test(text(b)) || name.test(b.getAttribute('aria-label') ?? ''),
  ) as HTMLButtonElement;
const announced = (step: HTMLElement) =>
  text(step.querySelector('.announce[aria-live="polite"]'));

const photo = (name: string, type = 'image/jpeg', size = 2048) => {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

async function choose({ settle, step }: Opened, files: File[]) {
  const input = picker(step);
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  await settle();
}

const askedForAddress = (http: HttpTestingController) =>
  http.match(
    (req) => req.method === 'POST' && req.url === `${BASE}/upload-url`,
  );

async function answerAddress(opened: Opened, req: TestRequest, n: number) {
  req.flush({
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    headers: { 'x-amz-checksum-crc32': 'AAAAAA==' },
    key: `incoming/${keyOf(n)}`,
    url: STORE,
  });
  await opened.settle();
}

// Ask, send to the store and confirm, as the uploader does for one file.
async function upload(opened: Opened, req: TestRequest, n: number) {
  await answerAddress(opened, req, n);
  opened.http.expectOne(STORE).flush(null, { status: 200, statusText: 'OK' });
  await opened.settle();
  opened.http
    .expectOne((r) => r.method === 'POST' && r.url === BASE)
    .flush({ key: keyOf(n), position: n, processed: false });
  await opened.settle();
}

async function restored(opened: Opened, count: number) {
  opened.http
    .expectOne((r) => r.method === 'GET' && r.url === BASE)
    .flush({
      photos: Array.from({ length: count }, (_, i) => ({
        height: 900,
        key: keyOf(i),
        position: i,
        processed: true,
        thumbnailUrl: `${STORE}/${keyOf(i)}.thumb?X-Amz-Expires=300`,
        width: 1200,
      })),
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

describe('step 5, the photos', () => {
  it('asks for photos of the workshop with a picker for several images', async () => {
    const { step } = await open();

    expect(text(step)).toContain(
      'Trage aici fotografii cu atelierul, elevatoarele și echipa',
    );
    expect(text(step)).toContain('Alege fotografii');
    expect(picker(step).accept).toBe(
      'image/jpeg,image/png,image/webp,image/heic,image/heif',
    );
    expect(picker(step).multiple).toBe(true);
    expect(tiles(step)).toEqual([]);
  });

  it('asks a mobile mechanic for the van and its kit, and follows the kind as it changes', async () => {
    const opened = await open({ files: [keyOf(0)], kind: 'mobile' });
    await restored(opened, 1);

    expect(text(opened.step)).toContain(
      'Trage aici fotografii cu duba sau trusa mobilă și sculele principale',
    );

    opened.fixture.componentRef.setInput('kind', 'pfa');
    await opened.settle();

    expect(text(opened.step)).toContain(
      'Trage aici fotografii cu atelierul, elevatoarele și echipa',
    );
    expect(tiles(opened.step)).toHaveLength(1);
  });

  it('says it all in English and keeps the photos when the language changes', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1)] });
    await restored(opened, 2);

    await opened.i18n.use('en');
    await opened.settle();

    expect(text(opened.step)).toContain(
      'Drop photos of the workshop, the lifts and the team here',
    );
    expect(text(opened.step)).toContain('Choose photos');
    expect(text(tiles(opened.step)[0])).toContain('Cover');
    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(0),
      keyOf(1),
    ]);
  });

  it('tells a visitor with no e-mail yet to add one, and takes no files', async () => {
    const { http, step } = await open({ draftId: '' });

    expect(text(step)).toContain(
      'Adaugă un e‑mail la pasul 1 ca să încarci fotografii',
    );
    expect(picker(step).disabled).toBe(true);
    http.expectNone(() => true);
  });

  it('keeps a photo dropped with no e-mail yet from opening in the browser', async () => {
    const { http, step } = await open({ draftId: '' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });

    step.querySelector('.drop')?.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    http.expectNone(() => true);
  });

  it('refuses a file of another type or over 10 MB before asking, and uploads the rest', async () => {
    const opened = await open();

    await choose(opened, [
      photo('plan.pdf', 'application/pdf'),
      photo('iarna.gif', 'image/gif'),
      photo('mare.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
      photo('atelier.jpg'),
    ]);

    expect(text(opened.step)).toContain(
      'Doar fotografii JPG, PNG, WEBP sau HEIC, de cel mult 10 MB',
    );
    const asked = askedForAddress(opened.http);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.request.body).toEqual({
      checksum: expect.stringMatching(/^[A-Za-z0-9+/]{6}==$/),
      contentType: 'image/jpeg',
      size: 2048,
    });
    expect(asked[0]?.request.headers.get('x-listing-token')).toBe(TOKEN);
  });

  it('takes no more than 20 photos, counting those held and those on their way', async () => {
    const held = Array.from({ length: 17 }, (_, i) => keyOf(i));
    const opened = await open({ files: held });
    await restored(opened, 17);

    await choose(opened, [photo('a.jpg'), photo('b.jpg')]);
    await choose(opened, [photo('c.jpg'), photo('d.jpg')]);

    expect(tiles(opened.step)).toHaveLength(20);
    expect(askedForAddress(opened.http)).toHaveLength(1);
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
  });

  it('uploads a photo straight to the store, confirms it and keeps its key', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    const [asked] = askedForAddress(opened.http);
    await upload(opened, asked as TestRequest, 0);

    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(0)]);
    expect(tiles(opened.step)).toHaveLength(1);
    expect(text(tiles(opened.step)[0])).toContain('Copertă');
  });

  it('says the photos will upload later when no address is issued, and retries on demand', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    askedForAddress(opened.http)[0]?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();

    expect(text(opened.step)).toContain('Fotografiile se încarcă mai târziu');
    const retry = button(tiles(opened.step)[0], /^Reîncearcă/);
    retry.click();
    await opened.settle();
    const [again] = askedForAddress(opened.http);
    await upload(opened, again as TestRequest, 0);

    expect(text(opened.step)).not.toContain(
      'Fotografiile se încarcă mai târziu',
    );
    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(0)]);
  });

  it('drops a photo the server refuses at confirm, says why, and never sends it again', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    const [asked] = askedForAddress(opened.http);
    await answerAddress(opened, asked as TestRequest, 0);
    opened.http.expectOne(STORE).flush(null, { status: 200, statusText: 'OK' });
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'POST' && r.url === BASE)
      .flush(
        { code: 'file_type_mismatch' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await opened.settle();

    expect(tiles(opened.step)).toEqual([]);
    expect(text(opened.step)).toContain(
      'Doar fotografii JPG, PNG, WEBP sau HEIC, de cel mult 10 MB',
    );
    expect(text(opened.step)).not.toContain(
      'Fotografiile se încarcă mai târziu',
    );
    await choose(opened, [photo('elevator.jpg')]);
    expect(askedForAddress(opened.http)).toHaveLength(1);
  });

  it('says 20 is the most when the draft filled up from elsewhere', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    askedForAddress(opened.http)[0]?.flush(
      { code: 'photos_full' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await opened.settle();

    expect(tiles(opened.step)).toEqual([]);
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
  });

  // @traces 1191-FR-001
  it('keeps photos chosen offline waiting, then uploads them and keeps the order they were chosen in', async () => {
    const opened = await open();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await choose(opened, [photo('unu.jpg'), photo('doi.jpg')]);

    expect(askedForAddress(opened.http)).toHaveLength(0);
    expect(tiles(opened.step)).toHaveLength(2);

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));
    await opened.settle();

    // One at a time, in the order picked: the second waits for the first.
    const [first, more] = askedForAddress(opened.http);
    expect(more).toBeUndefined();
    await upload(opened, first as TestRequest, 0);
    const [second] = askedForAddress(opened.http);
    await upload(opened, second as TestRequest, 1);
    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(0),
      keyOf(1),
    ]);
  });
});

describe('the step keeps trying and says what happens', () => {
  it('retries a photo that failed when more photos are chosen', async () => {
    const opened = await open();

    await choose(opened, [photo('unu.jpg')]);
    askedForAddress(opened.http)[0]?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();
    await choose(opened, [photo('doi.jpg')]);

    // One at a time: the failed photo goes first, then the new one.
    const [again, more] = askedForAddress(opened.http);
    expect(more).toBeUndefined();
    again?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();
    expect(askedForAddress(opened.http)).toHaveLength(1);
  });

  it('retries a photo that failed when the connection returns', async () => {
    const opened = await open();

    await choose(opened, [photo('unu.jpg')]);
    askedForAddress(opened.http)[0]?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();
    window.dispatchEvent(new Event('online'));
    await opened.settle();

    expect(askedForAddress(opened.http)).toHaveLength(1);
  });

  it('tells by words, not only colour, that photos are being dragged over it', async () => {
    const { settle, step } = await open();
    const area = step.querySelector('.drop') as HTMLElement;

    area.dispatchEvent(new Event('dragenter'));
    await settle();
    expect(text(step)).toContain('Lasă fotografiile aici');
    expect(area.classList).toContain('over');

    area.dispatchEvent(new Event('dragleave'));
    await settle();
    expect(text(step)).not.toContain('Lasă fotografiile aici');
  });

  it('announces a photo once it has uploaded', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    const [asked] = askedForAddress(opened.http);
    await upload(opened, asked as TestRequest, 0);

    expect(announced(opened.step)).toContain('Fotografia 1 este încărcată');
  });
});

describe('ordering and removing the photos', () => {
  it('shows the saved photos in order, the first marked as the cover in words', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1), keyOf(2)] });
    await restored(opened, 3);

    const shown = tiles(opened.step);
    expect(shown).toHaveLength(3);
    expect(text(shown[0])).toContain('Copertă');
    expect(text(shown[1])).not.toContain('Copertă');
    expect(shown[0]?.querySelector('img')?.getAttribute('src')).toContain(
      `${keyOf(0)}.thumb`,
    );
  });

  it('disables moving earlier at the start and later at the end', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1)] });
    await restored(opened, 2);
    const [first, last] = tiles(opened.step);

    expect(button(first, /Mută înainte/).disabled).toBe(true);
    expect(button(first, /Mută înapoi/).disabled).toBe(false);
    expect(button(last, /Mută înainte/).disabled).toBe(false);
    expect(button(last, /Mută înapoi/).disabled).toBe(true);
  });

  it('stops asking about a photo that never finishes processing', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    try {
      const opened = await open({ files: [keyOf(0)] });
      const pending = () =>
        opened.http.match((r) => r.method === 'GET' && r.url === BASE);
      let reads = 0;
      for (let lap = 0; lap < 40; lap++) {
        const [read] = pending();
        if (!read) break;
        reads++;
        read.flush({
          photos: [{ key: keyOf(0), position: 0, processed: false }],
        });
        await opened.settle();
        await jest.advanceTimersByTimeAsync(5000);
        await opened.settle();
      }

      expect(reads).toBeGreaterThan(1);
      expect(reads).toBeLessThan(40);
      expect(tiles(opened.step)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // @traces 248-FR-010
  it('moves a photo by keyboard, keeps the focus on it and announces its place', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1), keyOf(2)] });
    await restored(opened, 3);

    const later = button(tiles(opened.step)[0], /Mută înapoi/);
    later.focus();
    later.click();
    await opened.settle();

    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(1),
      keyOf(0),
      keyOf(2),
    ]);
    expect(tiles(opened.step)[1]?.contains(document.activeElement)).toBe(true);
    expect(announced(opened.step)).toContain('Fotografia 2 din 3');
    expect(text(tiles(opened.step)[0])).toContain('Copertă');
  });

  it('moves a photo dropped by pointer or touch to its new place', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1), keyOf(2)] });
    await restored(opened, 3);

    const list = opened.fixture.debugElement
      .query(By.directive(CdkDropList))
      .injector.get(CdkDropList);
    list.dropped.emit({ currentIndex: 0, previousIndex: 2 } as never);
    await opened.settle();

    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(2),
      keyOf(0),
      keyOf(1),
    ]);
  });

  it('removes a photo at once, deletes it and makes the next one the cover', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1)] });
    await restored(opened, 2);

    const remove = button(tiles(opened.step)[0], /Șterge/);
    expect(remove.getAttribute('aria-label')).toContain('1');
    remove.click();
    await opened.settle();

    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(1)]);
    expect(tiles(opened.step)).toHaveLength(1);
    expect(text(tiles(opened.step)[0])).toContain('Copertă');
    const deleted = opened.http.expectOne(
      (r) => r.method === 'DELETE' && r.url.startsWith(`${BASE}/`),
    );
    expect(deleted.request.url).toBe(`${BASE}/${encodeURIComponent(keyOf(0))}`);
    expect(deleted.request.headers.get('x-listing-token')).toBe(TOKEN);
  });

  it('cancels an upload still on its way when its photo is removed', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg')]);
    const [asked] = askedForAddress(opened.http);
    await answerAddress(opened, asked as TestRequest, 0);
    const sending = opened.http.expectOne(STORE);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();

    expect(sending.cancelled).toBe(true);
    expect(tiles(opened.step)).toEqual([]);
    expect(opened.fixture.componentInstance.files()).toEqual([]);
    opened.http.expectNone((r) => r.method === 'POST' && r.url === BASE);
  });
});

// The page's judgement of the photos, fed back each time the keys change.
function judged(opened: Opened) {
  const judge = (files: string[]) =>
    opened.fixture.componentRef.setInput(
      'problems',
      forStep(checkListing({ data: { files } }), 5),
    );
  judge(opened.fixture.componentInstance.files());
  opened.fixture.componentInstance.files.subscribe(judge);
  const shown: boolean[] = [];
  opened.fixture.componentInstance.shown.subscribe((v) => shown.push(v));
  return shown;
}
const photosError = (step: HTMLElement) =>
  step.querySelector('[data-field="files"]')?.getAttribute('aria-describedby');

describe('the page judges the photos', () => {
  // @traces 115-FR-002
  it('says a photo is needed only when sending is asked for', async () => {
    const opened = await open();
    const shown = judged(opened);
    await opened.settle();
    const region = opened.step.querySelector('#photos-error');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(text(region)).toBe('');
    expect(shown).not.toContain(true);

    opened.fixture.componentRef.setInput('showAll', true);
    await opened.settle();

    expect(text(opened.step.querySelector('#photos-error'))).toBe(
      'Adaugă cel puțin o fotografie',
    );
    expect(photosError(opened.step)).toBe('photos-error');
    expect(shown.at(-1)).toBe(true);
  });

  // @traces 115-FR-006
  it('says so once the last photo is removed, and stops when one is added', async () => {
    const opened = await open({ files: [keyOf(0)] });
    await restored(opened, 1);
    const shown = judged(opened);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();
    opened.http.expectOne((r) => r.method === 'DELETE');

    expect(text(opened.step.querySelector('#photos-error'))).toBe(
      'Adaugă cel puțin o fotografie',
    );
    expect(shown.at(-1)).toBe(true);

    await choose(opened, [photo('atelier.jpg')]);
    const [asked] = askedForAddress(opened.http);
    await upload(opened, asked as TestRequest, 1);

    expect(text(opened.step.querySelector('#photos-error'))).toBe('');
    expect(shown.at(-1)).toBe(false);
  });

  // @traces 115-FR-005
  it('renders a warning as a note, not an error', async () => {
    const opened = await open();
    const shown = judged(opened);
    opened.fixture.componentRef.setInput('problems', {
      errors: [],
      warnings: [{ code: 'required', field: 'files' }],
    });
    await opened.settle();

    const note = opened.step.querySelector('#photos-error');
    expect(note?.classList).toContain('warning');
    expect(note?.classList).not.toContain('error');
    expect(shown).not.toContain(true);
  });

  // @traces 115-FR-007
  it('marks the photo area, which takes the focus, with its path', async () => {
    const { step } = await open();

    const area = step.querySelector<HTMLElement>('[data-field="files"]');
    expect(area?.classList).toContain('drop');
    expect(area?.getAttribute('tabindex')).toBe('-1');
  });
});

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });
const dropped = (req: TestRequest) =>
  req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
const confirmOf = (http: HttpTestingController) =>
  http.expectOne((r) => r.method === 'POST' && r.url === BASE);
const chip = (step: HTMLElement) =>
  step.querySelector<HTMLElement>('.queued[role="status"]');
const queued = () => TestBed.inject(UploadQueue).forDraft(DRAFT);

describe('photos waiting for signal survive the page', () => {
  // @traces 1191-FR-001
  it('sends photos left in the browser queue when the draft opens again, and empties the queue', async () => {
    const opened = await open({
      queued: [photo('unu.jpg'), photo('doi.jpg')],
    });

    expect(tiles(opened.step).map((t) => t.dataset['name'])).toEqual([
      'unu.jpg',
      'doi.jpg',
    ]);
    const [first] = askedForAddress(opened.http);
    await upload(opened, first as TestRequest, 0);
    const [second] = askedForAddress(opened.http);
    await upload(opened, second as TestRequest, 1);

    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(0),
      keyOf(1),
    ]);
    expect(await queued()).toEqual([]);
  });

  // @traces 1191-FR-001
  it('keeps photos picked offline across a reload and sends them once the connection returns', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('unu.jpg'), photo('doi.jpg')]);

    const again = await opened.reopen();
    expect(tiles(again.step)).toHaveLength(2);
    expect(askedForAddress(again.http)).toHaveLength(0);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await again.settle();
    await upload(again, askedForAddress(again.http)[0] as TestRequest, 0);
    await upload(again, askedForAddress(again.http)[0] as TestRequest, 1);

    expect(again.fixture.componentInstance.files()).toEqual([
      keyOf(0),
      keyOf(1),
    ]);
    expect(await queued()).toEqual([]);
  });

  // @traces 1191-FR-001
  it('waits 1, 2, 4 and 8 s between sends lost to a dropped connection, then fails the photo until the owner retries', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    try {
      const opened = await open();
      await choose(opened, [photo('atelier.jpg')]);

      for (const wait of [1000, 2000, 4000, 8000]) {
        await answerAddress(opened, askedForAddress(opened.http)[0]!, 0);
        dropped(opened.http.expectOne(STORE));
        await opened.settle();
        expect(text(tiles(opened.step)[0])).toContain('Așteaptă conexiunea');

        await jest.advanceTimersByTimeAsync(wait - 1);
        await opened.settle();
        expect(askedForAddress(opened.http)).toHaveLength(0);
        await jest.advanceTimersByTimeAsync(1);
        await opened.settle();
      }
      await answerAddress(opened, askedForAddress(opened.http)[0]!, 0);
      dropped(opened.http.expectOne(STORE));
      await opened.settle();

      await jest.advanceTimersByTimeAsync(60_000);
      await opened.settle();
      expect(askedForAddress(opened.http)).toHaveLength(0);
      const retry = button(tiles(opened.step)[0], /^Reîncearcă/);
      expect(retry).toBeDefined();

      retry.click();
      await opened.settle();
      expect(askedForAddress(opened.http)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // @traces 1191-FR-001
  it('drains a draft under its own Web Lock and reads the queue again inside it', async () => {
    let grant: (() => Promise<unknown>) | undefined;
    const names: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (name: string, run: () => Promise<unknown>) => {
          names.push(name);
          grant = run;
          return new Promise(() => undefined);
        },
      },
    });
    try {
      setOnline(false);
      const opened = await open();
      await choose(opened, [photo('unu.jpg'), photo('doi.jpg')]);
      const [sentElsewhere] = await queued();
      setOnline(true);
      window.dispatchEvent(new Event('online'));
      await opened.settle();
      expect(names.at(-1)).toBe(`mf-photos-${DRAFT}`);

      // Another tab sent the first photo while this one waited for the lock.
      await TestBed.inject(UploadQueue).remove(sentElsewhere!.id);
      void grant?.();
      await opened.settle();

      expect(tiles(opened.step).map((t) => t.dataset['name'])).toEqual([
        'doi.jpg',
      ]);
      expect(askedForAddress(opened.http)).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  // @traces 1191-FR-001
  it('only confirms a photo whose upload already landed, and sends it again when the store lost it', async () => {
    const queue = () => TestBed.inject(UploadQueue);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const [entry] = await queue().add(DRAFT, [photo('unu.jpg')]);
    await queue().update(entry!.id, { key: `incoming/${keyOf(0)}` });
    const i18n = TestBed.inject(I18n);
    await i18n.enter('public');
    const opened = await mount(
      { draftId: DRAFT, files: [], kind: 'company' },
      i18n,
    );

    expect(askedForAddress(opened.http)).toHaveLength(0);
    const confirm = confirmOf(opened.http);
    expect(confirm.request.body).toEqual({ key: `incoming/${keyOf(0)}` });
    confirm.flush(
      { code: 'file_missing' },
      { status: 409, statusText: 'Conflict' },
    );
    await opened.settle();

    await upload(opened, askedForAddress(opened.http)[0] as TestRequest, 1);
    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(1)]);
    expect(await queued()).toEqual([]);
  });

  // @traces 1191-FR-001
  it('only confirms again a photo whose confirm answer was lost, never sending it twice', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    try {
      const opened = await open();
      await choose(opened, [photo('atelier.jpg')]);
      await answerAddress(opened, askedForAddress(opened.http)[0]!, 0);
      opened.http
        .expectOne(STORE)
        .flush(null, { status: 200, statusText: 'OK' });
      await opened.settle();
      dropped(confirmOf(opened.http));
      await opened.settle();

      await jest.advanceTimersByTimeAsync(1000);
      await opened.settle();

      expect(askedForAddress(opened.http)).toHaveLength(0);
      const again = confirmOf(opened.http);
      expect(again.request.body).toEqual({ key: `incoming/${keyOf(0)}` });
      again.flush({ key: keyOf(0), position: 0, processed: false });
      await opened.settle();
      expect(opened.fixture.componentInstance.files()).toEqual([keyOf(0)]);
      expect(await queued()).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  // @traces 1191-FR-001
  it('drops a restored photo the draft no longer takes: full, or already sent', async () => {
    const opened = await open({
      queued: [photo('unu.jpg'), photo('doi.jpg')],
    });

    askedForAddress(opened.http)[0]?.flush(
      { code: 'photos_full' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await opened.settle();
    askedForAddress(opened.http)[0]?.flush(
      { code: 'draft_submitted' },
      { status: 409, statusText: 'Conflict' },
    );
    await opened.settle();

    expect(tiles(opened.step)).toEqual([]);
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
    expect(await queued()).toEqual([]);
  });
});

describe('the chip that counts photos waiting for signal', () => {
  // @traces 1191-FR-002
  it('counts in Romanian, one, few and other, as a polite status', async () => {
    setOnline(false);
    const opened = await open();
    expect(text(chip(opened.step))).toBe('');

    await choose(opened, [photo('unu.jpg')]);
    expect(text(chip(opened.step))).toBe('O fotografie așteaptă semnal');
    expect(chip(opened.step)?.getAttribute('aria-live')).toBe('polite');

    await choose(opened, [photo('doi.jpg')]);
    expect(text(chip(opened.step))).toBe('2 fotografii așteaptă semnal');

    await choose(
      opened,
      Array.from({ length: 18 }, (_, i) => photo(`p${i}.jpg`)),
    );
    expect(text(chip(opened.step))).toBe('20 de fotografii așteaptă semnal');
    expect(text(tiles(opened.step)[0])).toContain('Așteaptă conexiunea');
  });

  // @traces 1191-FR-002
  it('counts in English, one and other', async () => {
    setOnline(false);
    const opened = await open({ language: 'en' });

    await choose(opened, [photo('one.jpg')]);
    expect(text(chip(opened.step))).toBe('1 photo waiting for signal');

    await choose(opened, [photo('two.jpg')]);
    expect(text(chip(opened.step))).toBe('2 photos waiting for signal');
  });

  // @traces 1191-FR-002
  it('counts photos restored from the queue, and is gone once none wait', async () => {
    setOnline(false);
    const opened = await open({
      queued: [photo('unu.jpg'), photo('doi.jpg')],
    });
    expect(text(chip(opened.step))).toBe('2 fotografii așteaptă semnal');

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await opened.settle();
    await upload(opened, askedForAddress(opened.http)[0] as TestRequest, 0);
    expect(text(chip(opened.step))).toBe('O fotografie așteaptă semnal');
    await upload(opened, askedForAddress(opened.http)[0] as TestRequest, 1);

    expect(text(chip(opened.step))).toBe('');
  });
});

describe('what the step takes', () => {
  // @traces 1191-FR-007
  it('takes a HEIC photo and refuses the rest in English with the HEIC text', async () => {
    const opened = await open({ language: 'en' });

    await choose(opened, [
      photo('iarna.gif', 'image/gif'),
      photo('telefon.heic', 'image/heic'),
    ]);

    expect(text(opened.step)).toContain(
      'Only JPG, PNG, WEBP or HEIC photos, up to 10 MB',
    );
    const [asked] = askedForAddress(opened.http);
    expect(asked?.request.body).toMatchObject({ contentType: 'image/heic' });
  });

  // @traces 1191-FR-007
  it('judges the size on the shrunk photo it sends, not the one picked', async () => {
    const g = globalThis as Record<string, unknown>;
    g['createImageBitmap'] = async () => ({
      close() {},
      height: 3000,
      width: 4000,
    });
    g['OffscreenCanvas'] = class {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        const blob = new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
        Object.defineProperty(blob, 'size', { value: 1_500_000 });
        return blob;
      }
    };
    try {
      const opened = await open();

      await choose(opened, [photo('mare.jpg', 'image/jpeg', 12_000_000)]);

      expect(text(opened.step)).not.toContain('Doar fotografii');
      const [asked] = askedForAddress(opened.http);
      expect(asked?.request.body).toMatchObject({ contentType: 'image/jpeg' });
      expect(
        (asked?.request.body as { size: number } | undefined)?.size,
      ).toBeLessThan(10 * 1024 * 1024);
    } finally {
      delete g['createImageBitmap'];
      delete g['OffscreenCanvas'];
    }
  });

  // A 12 MP photo decodes to about 48 MB: twenty at once would end the tab.
  it('shrinks the photos of one pick one after another, never two at once', async () => {
    const g = globalThis as Record<string, unknown>;
    let open_ = 0;
    let most = 0;
    let calls = 0;
    g['createImageBitmap'] = async () => {
      calls++;
      open_++;
      most = Math.max(most, open_);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        close() {
          open_--;
        },
        height: 3000,
        width: 4000,
      };
    };
    g['OffscreenCanvas'] = class {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        return new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
      }
    };
    try {
      const opened = await open();

      await choose(
        opened,
        ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => photo(n, 'image/jpeg', 6e6)),
      );
      for (let i = 0; i < 10 && calls < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await opened.settle();
      }

      expect(calls).toBe(3);
      expect(most).toBe(1);
    } finally {
      delete g['createImageBitmap'];
      delete g['OffscreenCanvas'];
    }
  });
});

describe('removing and failing behave', () => {
  // @traces 1191-FR-008
  it('deletes a photo removed while its confirm is on its way, once the confirm lands', async () => {
    const opened = await open();
    await choose(opened, [photo('atelier.jpg')]);
    await answerAddress(opened, askedForAddress(opened.http)[0]!, 0);
    opened.http.expectOne(STORE).flush(null, { status: 200, statusText: 'OK' });
    await opened.settle();
    const confirm = confirmOf(opened.http);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();
    expect(confirm.cancelled).toBe(false);
    expect(tiles(opened.step)).toEqual([]);

    confirm.flush({ key: keyOf(0), position: 0, processed: false });
    await opened.settle();

    const deleted = opened.http.expectOne((r) => r.method === 'DELETE');
    expect(deleted.request.url).toBe(`${BASE}/${encodeURIComponent(keyOf(0))}`);
    expect(opened.fixture.componentInstance.files()).toEqual([]);
    expect(tiles(opened.step)).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  // @traces 1191-FR-001
  it('forgets a waiting photo the owner removes, asking nothing of the API', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('atelier.jpg')]);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();

    expect(await queued()).toEqual([]);
    opened.http.expectNone(() => true);
  });

  // @traces 1191-FR-009
  it('clears the will-upload-later line on the next upload, while the older photo keeps its retry', async () => {
    const opened = await open();
    const unavailable = () =>
      askedForAddress(opened.http)[0]?.flush(
        { code: 'storage_unavailable' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await choose(opened, [photo('unu.jpg')]);
    unavailable();
    await opened.settle();
    expect(text(opened.step)).toContain('Fotografiile se încarcă mai târziu');

    await choose(opened, [photo('doi.jpg')]);
    unavailable();
    await opened.settle();
    await upload(opened, askedForAddress(opened.http)[0] as TestRequest, 1);

    expect(text(opened.step)).not.toContain(
      'Fotografiile se încarcă mai târziu',
    );
    expect(button(tiles(opened.step)[0], /^Reîncearcă/)).toBeDefined();
    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(1)]);
  });
});

describe('how uploads fare, measured', () => {
  let measured: [string, Record<string, number>, Record<string, string>][];

  beforeEach(() => {
    measured = [];
    sendMeasurementsTo((...args) => measured.push(args));
  });
  afterEach(() => sendMeasurementsTo(undefined));

  const outcomes = () => measured.map(([, , context]) => context['outcome']);

  // @traces 1191-FR-011
  it('measures queued, resumed, sent and failed with the purpose, and the duration only for a send', async () => {
    setOnline(false);
    const opened = await open();
    await choose(opened, [photo('unu.jpg'), photo('doi.jpg')]);
    expect(outcomes()).toEqual(['queued', 'queued']);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await opened.settle();
    await upload(opened, askedForAddress(opened.http)[0] as TestRequest, 0);
    askedForAddress(opened.http)[0]?.flush(
      { code: 'storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await opened.settle();

    expect(outcomes()).toEqual([
      'queued',
      'queued',
      'resumed',
      'sent',
      'failed',
    ]);
    for (const [type, values, context] of measured) {
      expect(type).toBe('upload');
      expect(Object.keys(context).sort()).toEqual(['outcome', 'purpose']);
      expect(context['purpose']).toBe('garage_photo');
      expect(Object.keys(values)).toEqual(
        context['outcome'] === 'sent' ? ['duration'] : [],
      );
    }
    const said = JSON.stringify(measured);
    expect(said).not.toContain(DRAFT);
    expect(said).not.toContain('unu.jpg');
    expect(said).not.toContain('garage_photo/');
  });
});
