import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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

describe('step 5, hostile drops', () => {
  it('accepts a file of exactly 10 MB and refuses an empty one', async () => {
    const opened = await open();

    await choose(opened, [
      photo('exact.jpg', 'image/jpeg', 10 * 1024 * 1024),
      photo('gol.jpg', 'image/jpeg', 0),
    ]);

    const asked = askedForAddress(opened.http);
    expect(asked.map((r) => (r.request.body as { size: number }).size)).toEqual(
      [10 * 1024 * 1024],
    );
    expect(text(opened.step)).toContain(
      'Doar fotografii JPG, PNG sau WEBP, de cel mult 10 MB',
    );
  });

  it('refuses a file with a photo name but no type', async () => {
    const opened = await open();

    await choose(opened, [photo('atelier.jpg', '')]);

    expect(askedForAddress(opened.http)).toEqual([]);
    expect(text(opened.step)).toContain(
      'Doar fotografii JPG, PNG sau WEBP, de cel mult 10 MB',
    );
  });

  it('refuses an upper-case or parameterised type it cannot name', async () => {
    const opened = await open();

    await choose(opened, [
      photo('a.svg', 'image/svg+xml'),
      photo('b.gif', 'image/gif'),
    ]);

    expect(askedForAddress(opened.http)).toEqual([]);
  });

  it('asks for nothing when the drop holds no files', async () => {
    const opened = await open();

    await choose(opened, []);

    expect(askedForAddress(opened.http)).toEqual([]);
    expect(tiles(opened.step)).toEqual([]);
  });

  it('takes a drop of 18 held and 4 dropped as exactly two, in drop order', async () => {
    const held = Array.from({ length: 18 }, (_, i) => keyOf(i));
    const opened = await open({ files: held });
    await restored(opened, 18);

    await choose(opened, [
      photo('a.jpg'),
      photo('b.jpg'),
      photo('c.jpg'),
      photo('d.jpg'),
    ]);

    expect(askedForAddress(opened.http)).toHaveLength(2);
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
  });

  it('takes no file at all when 20 are already held', async () => {
    const held = Array.from({ length: 20 }, (_, i) => keyOf(i));
    const opened = await open({ files: held });
    await restored(opened, 20);

    await choose(opened, [photo('a.jpg')]);

    expect(askedForAddress(opened.http)).toEqual([]);
    expect(text(opened.step)).toContain('Cel mult 20 de fotografii');
  });

  it('keeps a file name with markup as text', async () => {
    const opened = await open();

    await choose(opened, [photo('<img src=x onerror=alert(1)>.jpg')]);

    expect(opened.step.querySelector('img[src="x"]')).toBeNull();
  });

  it('does not move the first photo earlier nor the last later even when clicked', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1)] });
    await restored(opened, 2);

    button(tiles(opened.step)[0], /Mută înainte/)?.click();
    button(tiles(opened.step)[1], /Mută înapoi/)?.click();
    await opened.settle();

    expect(opened.fixture.componentInstance.files()).toEqual([
      keyOf(0),
      keyOf(1),
    ]);
  });

  it('removing the only photo leaves an empty step that still takes files', async () => {
    const opened = await open({ files: [keyOf(0)] });
    await restored(opened, 1);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();
    opened.http.expectOne((r) => r.method === 'DELETE');

    expect(opened.fixture.componentInstance.files()).toEqual([]);
    expect(picker(opened.step).disabled).toBe(false);
  });

  it('keeps a photo out of the draft when its delete fails', async () => {
    const opened = await open({ files: [keyOf(0), keyOf(1)] });
    await restored(opened, 2);

    button(tiles(opened.step)[0], /Șterge/).click();
    await opened.settle();
    opened.http
      .expectOne((r) => r.method === 'DELETE')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await opened.settle();

    expect(opened.fixture.componentInstance.files()).toEqual([keyOf(1)]);
  });
});
