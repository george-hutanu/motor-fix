import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { MaintenancePage } from './maintenance-page';

async function render() {
  const fixture = TestBed.createComponent(MaintenancePage);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const text = (element: HTMLElement) =>
  element.textContent?.replace(/\s+/g, ' ').trim();

// @traces 280-FR-020

let address: () => Promise<{ email: string | null }>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

describe('MaintenancePage', () => {
  beforeEach(() => {
    address = async () => ({ email: null });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SupportService,
          useValue: { supportContactControllerContact: () => address() },
        },
      ],
    });
  });

  it('shows the support address as a mailto link when one is configured', async () => {
    address = async () => ({ email: 'help@example.test' });
    const fixture = await render();
    await settle();
    const element = fixture.nativeElement as HTMLElement;

    const link = element.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(link?.getAttribute('href')).toBe('mailto:help@example.test');
    expect(text(link as HTMLElement)).toBe('help@example.test');
    expect(text(element)).toContain('Ai o întrebare? Scrie‑ne la');
    expect(text(element.querySelector('a:last-of-type') as HTMLElement)).toBe(
      'Administrator? Intră în cont',
    );
  });

  it('says it in English too', async () => {
    address = async () => ({ email: 'help@example.test' });
    const fixture = await render();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(fixture.nativeElement)).toContain('A question? Write to us at');
  });

  it('shows no address, and no line for it, when none is configured or it cannot be read', async () => {
    address = async () => {
      throw new Error('offline');
    };
    const fixture = await render();
    await settle();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(element.querySelector('.address')).toBeNull();
  });

  it('says in Romanian that MotorFix is down for maintenance', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(text(element.querySelector('main h1') as HTMLElement)).toBe(
      'Mentenanță',
    );
    expect(text(element)).toContain(
      'MotorFix este în mentenanță. Revenim în curând.',
    );
    expect(text(element)).toContain('MotorFix');
  });

  it('says it in English once English is chosen', async () => {
    const fixture = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(text(element.querySelector('main h1') as HTMLElement)).toBe(
      'Maintenance',
    );
    expect(text(element)).toContain(
      "MotorFix is down for maintenance. We'll be back soon.",
    );
    expect(text(element.querySelector('a') as HTMLElement)).toBe(
      'Admin? Sign in',
    );
  });

  it('offers the language switch', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelector('mf-language-switch')).not.toBeNull();
  });

  it('links quietly to the admin sign-in and to nothing else', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    const links = [...element.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin']);
    expect(text(links[0] as HTMLElement)).toBe('Administrator? Intră în cont');
  });

  it('has no control but the language switch and the admin link', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    const buttons = [...element.querySelectorAll('button')];
    expect(buttons.every((b) => b.closest('mf-language-switch') !== null)).toBe(
      true,
    );
    expect(element.querySelector('form, input')).toBeNull();
  });

  it('answers 503 with a time to come back when rendered on the server', async () => {
    const init: ResponseInit = {
      headers: new Headers({ 'Content-Type': 'text/html;charset=UTF-8' }),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: RESPONSE_INIT, useValue: init }],
    });

    await render();

    expect(init.status).toBe(503);
    const headers = new Headers(init.headers);
    expect(headers.get('retry-after')).toBe('300');
    // The render's own type stays, so the page is still served as HTML.
    expect(headers.get('content-type')).toBe('text/html;charset=UTF-8');
  });
});
