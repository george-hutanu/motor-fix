import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ContactPage } from './contact-page';
import { PUBLIC_PATHS } from '../../../addresses';
import { routes } from '../../../app.routes';

// @traces 280-FR-001 280-FR-011

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render(
  contact: () => Promise<{ email: string | null }>,
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SupportService,
        useValue: {
          supportContactControllerContact: jest.fn(contact),
          supportMessagesControllerCreate: jest.fn(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(ContactPage);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

describe('the contact page', () => {
  it('has its heading, an introduction, the address as a mailto link and the form', async () => {
    const page = await render(async () => ({ email: 'help@example.test' }));

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Contact');
    expect(page.querySelector('.intro')?.textContent?.trim()).not.toBe('');
    const link = page.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(link?.getAttribute('href')).toBe('mailto:help@example.test');
    expect(link?.textContent?.trim()).toBe('help@example.test');
    expect(page.querySelector('mf-contact-form')).not.toBeNull();
  });

  it('shows no address, and nothing in its place, when none is configured', async () => {
    const page = await render(async () => ({ email: null }));

    expect(page.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(page.querySelector('.address')).toBeNull();
    expect(page.querySelector('mf-contact-form')).not.toBeNull();
  });

  it('shows no address when the address cannot be read', async () => {
    const page = await render(async () => {
      throw new Error('offline');
    });

    expect(page.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(page.querySelector('mf-contact-form')).not.toBeNull();
  });

  it('speaks English', async () => {
    const page = await render(async () => ({ email: null }), 'en');

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Contact');
    expect(page.textContent).toContain('Send message');
  });

  it('is a public address in both languages', () => {
    expect(PUBLIC_PATHS).toContain('contact');
    const language = routes.find((route) => route.path === ':lang');
    expect(language?.children?.some((route) => route.path === 'contact')).toBe(
      true,
    );
  });
});

describe('the contact page on a wide screen', () => {
  // The footer's and the other public pages' content column: the page's own
  // left edge lines up with the footer's wordmark.
  it('sits in the same centred 1280 px column as the footer', () => {
    const css = readFileSync(join(__dirname, 'contact-page.css'), 'utf8');
    const host = css.match(/:host\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(host).toMatch(/max-width:\s*1280px/);
    expect(host).toMatch(/margin-inline:\s*auto/);
    expect(host).toMatch(/box-sizing:\s*border-box/);
  });
});
