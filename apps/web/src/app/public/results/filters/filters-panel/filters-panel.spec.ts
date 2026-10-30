import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK } from '@motor-fix/overlays';

import { FiltersPanel } from './filters-panel';
import type { FilterKey, Filters } from '../filters';

const filters = signal<Filters>({ open_now: false, open_saturday: false });
const toggle = jest.fn<void, [FilterKey]>();

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { filters, toggle },
          focusStart: jest.fn(),
          markUnchanged: jest.fn(),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(FiltersPanel);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const switchOf = (host: HTMLElement, key: FilterKey) =>
  host.querySelector<HTMLElement>(`#mf-filter-${key}`);

beforeEach(() => {
  filters.set({ open_now: false, open_saturday: false });
  toggle.mockReset();
});

// @traces 1398-FR-002
describe('the filters panel', () => {
  it('holds two switches, open now then open on Saturday, each named by its label', async () => {
    const host: HTMLElement = (await render()).nativeElement;
    const labels = Array.from(host.querySelectorAll('label'));

    expect(host.querySelectorAll('hlm-switch')).toHaveLength(2);
    expect(labels.map((label) => label.textContent?.trim())).toEqual([
      'Deschis acum',
      'Deschis sâmbăta',
    ]);
    expect(labels.map((label) => label.getAttribute('for'))).toEqual([
      'mf-filter-open_now',
      'mf-filter-open_saturday',
    ]);
    expect(switchOf(host, 'open_now')?.getAttribute('role')).toBe('switch');
    expect(switchOf(host, 'open_saturday')?.getAttribute('role')).toBe(
      'switch',
    );
  });

  it('names the switches in English', async () => {
    const host: HTMLElement = (await render('en')).nativeElement;

    expect(
      Array.from(host.querySelectorAll('label')).map((l) =>
        l.textContent?.trim(),
      ),
    ).toEqual(['Open now', 'Open on Saturday']);
  });

  it('shows each switch as the bar has it, and follows the bar', async () => {
    filters.set({ open_now: true, open_saturday: false });
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    expect(switchOf(host, 'open_now')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(switchOf(host, 'open_saturday')?.getAttribute('aria-checked')).toBe(
      'false',
    );

    filters.set({ open_now: true, open_saturday: true });
    fixture.detectChanges();

    expect(switchOf(host, 'open_saturday')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('toggles a filter at once, with no apply button', async () => {
    const host: HTMLElement = (await render()).nativeElement;

    switchOf(host, 'open_saturday')?.click();

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith('open_saturday');
    expect(host.querySelectorAll('button:not([role="switch"])')).toHaveLength(
      0,
    );
  });
});
