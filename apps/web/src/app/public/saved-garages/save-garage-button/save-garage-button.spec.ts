import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SaveGarageButton } from './save-garage-button';
import { Session } from '../../../dashboard/session';
import { SavedGarages } from '../saved-garages';

type Role = MeDto['role'];

let ids: ReturnType<typeof signal<ReadonlySet<string>>>;
let unavailable: ReturnType<typeof signal<ReadonlySet<string>>>;
let tap: jest.Mock;

async function render(
  options: {
    role?: Role | null;
    hint?: Role | null;
    saved?: boolean;
    unavailable?: boolean;
    look?: 'labelled' | 'icon';
    language?: 'ro' | 'en';
  } = {},
) {
  ids = signal(new Set(options.saved ? ['g1'] : []));
  unavailable = signal(new Set(options.unavailable ? ['g1'] : []));
  tap = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: SavedGarages, useValue: { ids, tap, unavailable } },
      {
        provide: Session,
        useValue: {
          current: signal(options.role ? { role: options.role } : null),
          renew: jest.fn(async () => true),
          roleHint: signal(options.hint ?? null),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(SaveGarageButton);
  fixture.componentRef.setInput('garageId', 'g1');
  if (options.look) fixture.componentRef.setInput('look', options.look);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const button = (host: HTMLElement) =>
  host.querySelector('button') as HTMLButtonElement | null;

afterEach(() => TestBed.resetTestingModule());

// @traces 290-FR-009 290-FR-012
describe('the labelled save button', () => {
  it('reads Salvează, not pressed, when the garage is not saved', async () => {
    const { host } = await render({ role: 'driver' });

    expect(button(host)?.textContent?.trim()).toBe('Salvează');
    expect(button(host)?.getAttribute('aria-pressed')).toBe('false');
    expect(button(host)?.type).toBe('button');
  });

  it('reads Salvat, pressed, when the garage is saved', async () => {
    const { host } = await render({ role: 'driver', saved: true });

    expect(button(host)?.textContent?.trim()).toBe('Salvat');
    expect(button(host)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('reads Save and Saved in English', async () => {
    const { host } = await render({ language: 'en', role: 'driver' });
    expect(button(host)?.textContent?.trim()).toBe('Save');

    TestBed.resetTestingModule();
    const saved = await render({ language: 'en', role: 'driver', saved: true });
    expect(button(saved.host)?.textContent?.trim()).toBe('Saved');
  });

  it('shows Indisponibil in its place when the garage cannot be saved', async () => {
    const { host } = await render({ role: 'driver', unavailable: true });

    expect(button(host)).toBeNull();
    expect(host.textContent?.trim()).toBe('Indisponibil');
  });

  it('hands a tap to the store', async () => {
    const { host } = await render({ role: 'driver' });

    button(host)?.click();

    expect(tap).toHaveBeenCalledWith('g1');
  });
});

// @traces 290-FR-010
describe('the icon-only save button', () => {
  it('names itself Salvează or Salvat and shows no text', async () => {
    const { host } = await render({ look: 'icon', role: 'driver' });
    expect(button(host)?.getAttribute('aria-label')).toBe('Salvează');
    expect(button(host)?.textContent?.trim()).toBe('');

    TestBed.resetTestingModule();
    const saved = await render({ look: 'icon', role: 'driver', saved: true });
    expect(button(saved.host)?.getAttribute('aria-label')).toBe('Salvat');
    expect(button(saved.host)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a tap from reaching a link around it', async () => {
    const { host } = await render({ look: 'icon', role: 'driver' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    button(host)?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(tap).toHaveBeenCalledWith('g1');
  });
});

// @traces 290-FR-009 290-FR-010 290-FR-014
describe('who sees the button', () => {
  it.each([
    ['a visitor', null, null],
    ['a driver', 'driver', null],
    ['a browser last seen as a driver', null, 'driver'],
  ] as const)('shows it to %s', async (_title, role, hint) => {
    const { host } = await render({ hint, role });

    expect(button(host)).not.toBeNull();
  });

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'hides it in the %s role and its hint',
    async (role) => {
      const signedIn = await render({ role });
      expect(button(signedIn.host)).toBeNull();

      TestBed.resetTestingModule();
      const hinted = await render({ hint: role });
      expect(button(hinted.host)).toBeNull();
    },
  );
});
