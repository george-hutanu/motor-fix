import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { ShareButton } from './share-button';
import { SITE_ORIGIN } from '../../../addresses';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const ORIGIN = 'https://motorfix.ro';

let fixture: ComponentFixture<ShareButton>;
let share: jest.Mock | undefined;
let writeText: jest.Mock | undefined;

function offer(property: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, property, {
    configurable: true,
    value,
  });
}

beforeEach(async () => {
  jest.mocked(toast).mockReset();
  share = undefined;
  writeText = undefined;
  offer('share', undefined);
  offer('clipboard', undefined);
  TestBed.configureTestingModule({
    providers: [{ provide: SITE_ORIGIN, useValue: ORIGIN }],
  });
  await TestBed.inject(I18n).enter('public');
});

afterAll(() => {
  offer('share', undefined);
  offer('clipboard', undefined);
});

function withShare(answer: Promise<void> = Promise.resolve()) {
  share = jest.fn(() => answer);
  offer('share', share);
}

function withClipboard(answer: Promise<void> = Promise.resolve()) {
  writeText = jest.fn(() => answer);
  offer('clipboard', { writeText });
}

async function render({
  brand,
  language = 'ro',
  name = 'Service Auto Militari',
  slug = 'service-auto-militari',
}: {
  brand?: string;
  language?: 'ro' | 'en';
  name?: string;
  slug?: string;
} = {}) {
  await TestBed.inject(I18n).use(language);
  fixture = TestBed.createComponent(ShareButton);
  fixture.componentRef.setInput('name', name);
  fixture.componentRef.setInput('slug', slug);
  if (brand) fixture.componentRef.setInput('brand', brand);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

async function press(host: HTMLElement) {
  host.querySelector('button')?.click();
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 385-FR-001 385-FR-005
describe('the share button', () => {
  it('says Share with a visible label and names the garage for a screen reader, in Romanian', async () => {
    const host = await render();

    const button = host.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect(said(button)).toBe('Distribuie');
    expect(button?.getAttribute('aria-label')).toBe(
      'Distribuie Service Auto Militari',
    );
    expect(button?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('says the same in English', async () => {
    const host = await render({ language: 'en' });

    const button = host.querySelector('button');
    expect(said(button)).toBe('Share');
    expect(button?.getAttribute('aria-label')).toBe(
      'Share Service Auto Militari',
    );
  });

  it('shows no address field before it is pressed', async () => {
    const host = await render();

    expect(host.querySelector('input')).toBeNull();
  });
});

// @traces 385-FR-002 385-FR-003
describe('sharing through the share menu', () => {
  it.each([
    ['ro', undefined, `${ORIGIN}/ro/garages/service-auto-militari?src=share`],
    [
      'ro',
      'bmw',
      `${ORIGIN}/ro/garages/service-auto-militari?brand=bmw&src=share`,
    ],
    ['en', undefined, `${ORIGIN}/en/garages/service-auto-militari?src=share`],
    [
      'en',
      'dacia',
      `${ORIGIN}/en/garages/service-auto-militari?brand=dacia&src=share`,
    ],
  ] as const)(
    'opens the menu with the name and the canonical address (%s, brand %s)',
    async (language, brand, url) => {
      withShare();
      withClipboard();
      const host = await render({ brand, language });

      await press(host);

      expect(share).toHaveBeenCalledWith({
        title: 'Service Auto Militari',
        url,
      });
      expect(writeText).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it("builds the address from the site's own origin the server named, never the browser's", async () => {
    TestBed.resetTestingModule();
    await TestBed.inject(I18n).enter('public');
    const tag = document.createElement('meta');
    tag.name = 'mf-site';
    tag.content = ORIGIN;
    document.head.append(tag);
    withShare();
    const host = await render().finally(() => tag.remove());

    await press(host);

    const { url } = (share as jest.Mock).mock.calls[0][0] as { url: string };
    expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(url).not.toContain(location.origin);
  });

  it('does nothing when the menu is dismissed', async () => {
    withShare(Promise.reject(new DOMException('dismissed', 'AbortError')));
    withClipboard();
    const host = await render();

    await press(host);

    expect(writeText).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBeNull();
  });

  it('copies the address when the menu fails for another reason', async () => {
    withShare(Promise.reject(new DOMException('no', 'NotAllowedError')));
    withClipboard();
    const host = await render();

    await press(host);

    expect(writeText).toHaveBeenCalledWith(
      `${ORIGIN}/ro/garages/service-auto-militari?src=share`,
    );
    expect(toast).toHaveBeenCalledWith('Link copiat');
  });
});

// @traces 385-FR-004 385-FR-005
describe('sharing without a share menu', () => {
  it('copies the address and says so, in Romanian', async () => {
    withClipboard();
    const host = await render({ brand: 'bmw' });

    await press(host);

    expect(writeText).toHaveBeenCalledWith(
      `${ORIGIN}/ro/garages/service-auto-militari?brand=bmw&src=share`,
    );
    expect(toast).toHaveBeenCalledWith('Link copiat');
    expect(host.querySelector('input')).toBeNull();
  });

  it('says so in English', async () => {
    withClipboard();
    const host = await render({ language: 'en' });

    await press(host);

    expect(toast).toHaveBeenCalledWith('Link copied');
  });

  it('shows the address selected in a read-only field when the copy is refused', async () => {
    withClipboard(Promise.reject(new DOMException('no', 'NotAllowedError')));
    const host = await render();

    await press(host);

    const field = host.querySelector('input');
    expect(field?.readOnly).toBe(true);
    expect(field?.value).toBe(
      `${ORIGIN}/ro/garages/service-auto-militari?src=share`,
    );
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(field?.value.length);
    const label = host.querySelector(`label[for="${field?.id}"]`);
    expect(said(label)).toBe('Copiază linkul de mai jos');
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the field when the browser has no clipboard at all', async () => {
    const host = await render({ language: 'en' });

    await press(host);

    const field = host.querySelector('input');
    expect(field?.value).toBe(
      `${ORIGIN}/en/garages/service-auto-militari?src=share`,
    );
    expect(said(host.querySelector(`label[for="${field?.id}"]`))).toBe(
      'Copy the link below',
    );
  });

  it('drops the field when the garage changes', async () => {
    const host = await render();
    await press(host);
    expect(host.querySelector('input')).not.toBeNull();

    fixture.componentRef.setInput('slug', 'alt-service');
    fixture.componentRef.setInput('name', 'Alt Service');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('input')).toBeNull();
  });
});
