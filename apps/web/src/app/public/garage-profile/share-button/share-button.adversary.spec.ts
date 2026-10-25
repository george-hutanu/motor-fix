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

function offer(property: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, property, { configurable: true, value });
}

beforeEach(async () => {
  jest.mocked(toast).mockReset();
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

async function render({
  brand,
  language = 'ro',
  name = 'Service Auto',
  slug = 'service-auto',
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
  if (brand !== undefined) fixture.componentRef.setInput('brand', brand);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

async function press(host: HTMLElement) {
  host.querySelector('button')?.click();
  for (let turn = 0; turn < 6; turn++) {
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

// @traces 385-FR-002 385-FR-003 385-FR-004
describe('the share button with hostile browsers and inputs', () => {
  it('copies when the share menu throws at once instead of rejecting', async () => {
    offer('share', () => {
      throw new TypeError('not allowed');
    });
    const writeText = jest.fn(() => Promise.resolve());
    offer('clipboard', { writeText });
    const host = await render();

    await press(host);

    expect(writeText).toHaveBeenCalledWith(
      `${ORIGIN}/ro/garages/service-auto?src=share`,
    );
    expect(toast).toHaveBeenCalledWith('Link copiat');
  });

  it('shows the field when the clipboard throws at once instead of rejecting', async () => {
    offer('clipboard', {
      writeText: () => {
        throw new TypeError('blocked');
      },
    });
    const host = await render({ language: 'en' });

    await press(host);

    expect(host.querySelector('input')?.value).toBe(
      `${ORIGIN}/en/garages/service-auto?src=share`,
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('falls back to the copy when the menu rejects with a plain error', async () => {
    offer('share', () => Promise.reject(new Error('boom')));
    const writeText = jest.fn(() => Promise.resolve());
    offer('clipboard', { writeText });
    const host = await render();

    await press(host);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Link copiat');
  });

  it('does nothing when the menu rejects with a dismissal that is a plain error named AbortError', async () => {
    const dismissed = new Error('dismissed');
    dismissed.name = 'AbortError';
    offer('share', () => Promise.reject(dismissed));
    const writeText = jest.fn(() => Promise.resolve());
    offer('clipboard', { writeText });
    const host = await render();

    await press(host);

    expect(writeText).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBeNull();
  });

  it('leaves out an empty brand', async () => {
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const host = await render({ brand: '' });

    await press(host);

    expect(share).toHaveBeenCalledWith({
      title: 'Service Auto',
      url: `${ORIGIN}/ro/garages/service-auto?src=share`,
    });
  });

  it('keeps the brand and the marker as the only parameters and in that order', async () => {
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const host = await render({ brand: 'alfa-romeo' });

    await press(host);

    const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    expect([...new URL(url).searchParams.keys()]).toEqual(['brand', 'src']);
  });

  it('encodes a brand that would otherwise add a parameter', async () => {
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const host = await render({ brand: 'a&src=evil' });

    await press(host);

    const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    const params = new URL(url).searchParams;
    expect(params.getAll('src')).toEqual(['share']);
    expect(params.get('brand')).toBe('a&src=evil');
  });

  it('passes a name with quotes, accents and emoji to the menu untouched', async () => {
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const name = 'Ștefan & "Fiii" Auto 🚗 <b>';
    const host = await render({ name });

    await press(host);

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: name }),
    );
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe(
      `Distribuie ${name}`,
    );
  });

  it('uses the language the page is in at the moment of the press', async () => {
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const host = await render();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    await press(host);

    const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    expect(url).toBe(`${ORIGIN}/en/garages/service-auto?src=share`);
  });

  it('keeps one field when pressed again after the copy was refused', async () => {
    const writeText = jest.fn(() => Promise.reject(new Error('no')));
    offer('clipboard', { writeText });
    const host = await render();

    await press(host);
    await press(host);

    expect(host.querySelectorAll('input')).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('drops the field when only the brand in context changes', async () => {
    const host = await render();
    await press(host);
    expect(host.querySelector('input')).not.toBeNull();

    fixture.componentRef.setInput('brand', 'bmw');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('input')).toBeNull();
  });

  it('builds the address from the site origin even when it carries a trailing slash', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SITE_ORIGIN, useValue: `${ORIGIN}/` }],
    });
    await TestBed.inject(I18n).enter('public');
    const share = jest.fn(() => Promise.resolve());
    offer('share', share);
    const host = await render();

    await press(host);

    const { url } = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    expect(url).toBe(`${ORIGIN}/ro/garages/service-auto?src=share`);
  });
});
