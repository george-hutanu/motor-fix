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
  element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

// No support address configured: the page reads it and shows none.
const support = {
  provide: SupportService,
  useValue: { supportContactControllerContact: async () => ({ email: null }) },
};

beforeEach(() =>
  TestBed.configureTestingModule({ providers: [provideRouter([]), support] }),
);

describe('MaintenancePage under odd conditions', () => {
  it('shows no raw translation key in either language', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;
    expect(text(element)).not.toContain('shell.maintenance');

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(text(element)).not.toContain('shell.maintenance');
  });

  it('returns to Romanian after English without keeping any English text', async () => {
    const fixture = await render();
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    fixture.detectChanges();

    await i18n.use('ro');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(text(element)).toContain(
      'MotorFix este în mentenanță. Revenim în curând.',
    );
    expect(text(element)).not.toContain('down for maintenance');
    expect(text(element.querySelector('a') as HTMLElement)).toBe(
      'Administrator? Intră în cont',
    );
  });

  it('has exactly one main landmark with one heading', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelectorAll('main')).toHaveLength(1);
    expect(element.querySelectorAll('h1')).toHaveLength(1);
  });

  it('links to the admin sign-in with no language prefix and no query', async () => {
    const element = (await render()).nativeElement as HTMLElement;
    await TestBed.inject(I18n).use('en');

    const href = element.querySelector('a')?.getAttribute('href');

    expect(href).toBe('/admin');
  });

  it('offers no sign-up link, form or text field', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelector('form, input, textarea, select')).toBeNull();
    expect(
      [...element.querySelectorAll('a, button')].filter((el) =>
        /sign.?up|creeaz|înregistr/i.test(el.textContent ?? ''),
      ),
    ).toHaveLength(0);
  });

  it('answers 503 for each of two renders on the server, with the same wait', async () => {
    for (let i = 0; i < 2; i++) {
      TestBed.resetTestingModule();
      const init: ResponseInit = { status: 200 };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          support,
          { provide: RESPONSE_INIT, useValue: init },
        ],
      });

      await render();

      expect(init.status).toBe(503);
      expect(new Headers(init.headers).get('retry-after')).toBe('300');
    }
  });

  it('renders in the browser with no server response to change', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(text(element)).toContain('MotorFix este în mentenanță');
  });
});
