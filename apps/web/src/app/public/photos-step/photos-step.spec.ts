import { CdkDropList } from '@angular/cdk/drag-drop';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { I18n } from '@motor-fix/i18n';

import { PhotosStep } from './photos-step';

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
}

async function open({
  draftId = DRAFT,
  files = [],
  kind = 'company',
  language = 'ro',
}: Options = {}) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
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
    }
  };
  await settle();
  return { fixture, http, i18n, settle, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

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
  text(step.querySelector('[aria-live="polite"]'));

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
    fields: { key: `incoming/${keyOf(n)}` },
    key: `incoming/${keyOf(n)}`,
    url: STORE,
  });
  await opened.settle();
}

// Ask, send to the store and confirm, as the uploader does for one file.
async function upload(opened: Opened, req: TestRequest, n: number) {
  await answerAddress(opened, req, n);
  opened.http
    .expectOne(STORE)
    .flush(null, { status: 204, statusText: 'No Content' });
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
    expect(picker(step).accept).toBe('image/jpeg,image/png,image/webp');
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

  it('refuses a file of another type or over 10 MB before asking, and uploads the rest', async () => {
    const opened = await open();

    await choose(opened, [
      photo('plan.pdf', 'application/pdf'),
      photo('iarna.heic', 'image/heic'),
      photo('mare.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
      photo('atelier.jpg'),
    ]);

    expect(text(opened.step)).toContain(
      'Doar fotografii JPG, PNG sau WEBP, de cel mult 10 MB',
    );
    const asked = askedForAddress(opened.http);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.request.body).toEqual({
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

    expect(askedForAddress(opened.http)).toHaveLength(3);
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

    const [first, second] = askedForAddress(opened.http);
    await upload(opened, second as TestRequest, 1);
    await upload(opened, first as TestRequest, 0);
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

    expect(askedForAddress(opened.http)).toHaveLength(2);
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
