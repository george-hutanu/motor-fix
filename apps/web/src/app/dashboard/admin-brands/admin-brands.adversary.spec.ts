import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { AdminBrands } from './admin-brands';

const brand = (
  name: string,
  extra: Partial<AdminBrandDto> = {},
): AdminBrandDto => ({
  cars: 0,
  garages: 0,
  id: `id-${name}`,
  name,
  slug: name.toLowerCase(),
  state: 'active',
  updatedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: null,
  ...extra,
});

const SEED = [
  brand('Dacia', { cars: 1240, garages: 18 }),
  brand('Lada', { state: 'retired' }),
  brand('Škoda', { cars: 40, garages: 12 }),
];

const conflict = (body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: { status: 409, ...body }, status: 409 });

let list: jest.Mock;
let update: jest.Mock;
let openDialog: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          adminBrandsControllerList: list,
          adminBrandsControllerUpdate: update,
        },
      },
      { provide: Overlays, useValue: { open: openDialog } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(AdminBrands);
  document.body.replaceChildren(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const rows = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('tbody tr'),
];
const names = (el: HTMLElement) =>
  rows(el).map((r) => r.querySelector('[data-name]')?.textContent?.trim());
const rowOf = (el: HTMLElement, name: string) =>
  rows(el).find(
    (r) => r.querySelector('[data-name]')?.textContent?.trim() === name,
  ) as HTMLElement;
const button = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined;
const search = (el: HTMLElement) =>
  el.querySelector('input[type="search"]') as HTMLInputElement;
const field = (el: HTMLElement) =>
  el.querySelector('tbody input') as HTMLInputElement;

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function startRename(el: HTMLElement, name: string, to: string) {
  button(el, `Redenumește ${name}`)?.click();
  await settle();
  type(field(el), to);
}

beforeEach(() => {
  list = jest.fn(async () => ({ items: SEED.map((b) => ({ ...b })) }));
  update = jest.fn(
    async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const before = SEED.find((b) => b.id === id) as AdminBrandDto;
      return {
        ...before,
        ...(typeof body['name'] === 'string' && { name: body['name'] }),
        ...(typeof body['active'] === 'boolean' && {
          state: body['active'] ? 'active' : 'retired',
        }),
        updatedAt: '2026-10-25T12:00:00.000Z',
      };
    },
  );
  openDialog = jest.fn(async () => 'cancelled');
});

afterEach(() => TestBed.resetTestingModule());

describe('the brand list under hostile input', () => {
  // @traces 1368-FR-002
  it.each([
    ['a decomposed accent', 'Škoda'],
    ['upper case with an accent', 'ŠKODA'],
    ['a zero-width character inside', 'sk​oda'],
    ['an ASCII fold', 'skoda'],
  ])('finds Škoda by %s', async (_, text) => {
    const el = await open();

    type(search(el), text);
    await settle();

    expect(names(el)).toEqual(['Škoda']);
  });

  // @traces 1368-FR-002
  it('shows every row again when the search is only spaces', async () => {
    const el = await open();

    type(search(el), '   ');
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
  });

  // @traces 1368-FR-002
  it('filters on a 500-character search without a read and shows the empty line', async () => {
    const el = await open();

    type(search(el), 'x'.repeat(500));
    await settle();

    expect(rows(el)).toHaveLength(0);
    expect(el.textContent).toContain('Nicio marcă nu se potrivește');
    expect(list).toHaveBeenCalledTimes(1);
  });

  // @traces 1368-FR-002
  it('treats regex characters in the search as plain text', async () => {
    const el = await open();

    type(search(el), '.*');
    await settle();

    expect(rows(el)).toHaveLength(0);
  });

  // @traces 1368-FR-001
  it('renders two thousand brands in the list order', async () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      brand(`Brand ${String(i).padStart(5, '0')}`),
    );
    list = jest.fn(async () => ({ items: many }));

    const el = await open();

    expect(rows(el)).toHaveLength(2000);
    expect(names(el)[0]).toBe('Brand 00000');
    expect(names(el)[1999]).toBe('Brand 01999');
  }, 60000);

  // @traces 1368-FR-001
  it('shows a name made of markup as text', async () => {
    list = jest.fn(async () => ({
      items: [brand('<img src=x onerror=alert(1)>')],
    }));

    const el = await open();

    expect(el.querySelector('tbody img')).toBeNull();
    expect(names(el)).toEqual(['<img src=x onerror=alert(1)>']);
  });

  // @traces 1368-FR-001
  it('shows a count of zero as 0 for both columns', async () => {
    const el = await open();

    const lada = rowOf(el, 'Lada');
    expect(lada.querySelector('[data-garages]')?.textContent?.trim()).toMatch(
      /(^|\D)0$/,
    );
    expect(lada.querySelector('[data-cars]')?.textContent?.trim()).toMatch(
      /(^|\D)0$/,
    );
  });

  // @traces 1368-FR-008
  it('shows skeleton rows again while a retry is read', async () => {
    list = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    const el = await open();
    list.mockImplementation(() => new Promise(() => {}));

    button(el, 'Încearcă din nou')?.click();
    await settle();

    expect(
      el.querySelector('[aria-busy="true"]')?.querySelectorAll('.skeleton-row'),
    ).toHaveLength(3);
    expect(el.textContent).not.toContain(
      'Lista de mărci nu a putut fi citită.',
    );
  });

  // @traces 1368-FR-008
  it('fails again on a second failed retry and still offers retry', async () => {
    list = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    const el = await open();

    button(el, 'Încearcă din nou')?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('Lista de mărci nu a putut fi citită.');
    expect(button(el, 'Încearcă din nou')).toBeDefined();
  });

  // @traces 1368-FR-008
  it('shows the read error, not an empty list, when the list read fails', async () => {
    list = jest.fn(async () => {
      throw new Error('boom');
    });
    const el = await open();

    expect(el.textContent).not.toContain('Nicio marcă nu se potrivește');
    expect(el.textContent).toContain('Lista de mărci nu a putut fi citită.');
  });
});

describe('adding a brand under hostile input', () => {
  // @traces 1368-FR-003
  it.each([['cancelled'], [undefined], [null]])(
    'leaves the list and the search alone when the dialog answers %s',
    async (answer) => {
      openDialog.mockImplementation(async () => answer);
      const el = await open();
      type(search(el), 'dac');
      await settle();

      button(el, 'Adaugă o marcă')?.click();
      await settle();

      expect(names(el)).toEqual(['Dacia']);
      expect(search(el).value).toBe('dac');
    },
  );

  // @traces 1368-FR-003
  it('does not list a brand twice when the dialog returns one already on the list', async () => {
    openDialog.mockImplementation(async () => brand('Dacia'));
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
  });

  // @traces 1368-FR-003
  it('places a new brand by folded name, so Ševrolet sorts before Škoda and after Lada', async () => {
    openDialog.mockImplementation(async () => brand('Ševrolet'));
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Ševrolet', 'Škoda']);
  });

  // @traces 1368-FR-003
  it('adds a brand to a list that was empty', async () => {
    list = jest.fn(async () => ({ items: [] }));
    openDialog.mockImplementation(async () => brand('Xpeng'));
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(names(el)).toEqual(['Xpeng']);
    expect(el.textContent).not.toContain('Nicio marcă nu se potrivește');
  });

  // @traces 1368-FR-003
  it('opens the dialog once per press, and again on a second press', async () => {
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();
    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(openDialog).toHaveBeenCalledTimes(2);
  });
});

describe('editing a row under hostile input', () => {
  // @traces 1368-FR-005
  it.each([
    ['exactly 2 characters', 'Ab'],
    ['exactly 40 characters', 'B'.repeat(40)],
  ])('accepts a rename to %s', async (_, to) => {
    const el = await open();

    await startRename(el, 'Dacia', to);
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { name: to, seenUpdatedAt: '2026-10-01T10:00:00.000Z' },
      id: 'id-Dacia',
    });
  });

  // @traces 1368-FR-005
  it.each([
    ['41 characters', 'B'.repeat(41)],
    ['zero-width characters only', '​​​'],
    ['an empty field', ''],
  ])('refuses a rename to %s and keeps the field open', async (_, to) => {
    const el = await open();

    await startRename(el, 'Dacia', to);
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    expect(field(el)).not.toBeNull();
  });

  // @traces 1368-FR-005
  it('sends the trimmed name', async () => {
    const el = await open();

    await startRename(el, 'Dacia', '  Tesla  ');
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { name: 'Tesla', seenUpdatedAt: '2026-10-01T10:00:00.000Z' },
      id: 'id-Dacia',
    });
  });

  // @traces 1368-FR-005
  it('closes the field and leaves the row as it was when saved unchanged', async () => {
    const el = await open();

    await startRename(el, 'Dacia', 'Dacia');
    button(el, 'Salvează')?.click();
    await settle();

    expect(field(el)).toBeNull();
    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
    expect(rowOf(el, 'Dacia').textContent).toContain('1.240');
  });

  // @traces 1368-FR-005
  it('keeps a retired brand retired when it is renamed', async () => {
    const el = await open();

    await startRename(el, 'Lada', 'Lada Niva');
    button(el, 'Salvează')?.click();
    await settle();

    expect(
      rowOf(el, 'Lada Niva').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('retrasă');
    expect(button(el, 'Readuce Lada Niva')).toBeDefined();
  });

  // @traces 1368-FR-005
  it('shows no taken-name message the next time the field opens', async () => {
    update.mockRejectedValueOnce(
      conflict({ code: 'brand_exists', detail: 'Marca există deja: Škoda' }),
    );
    const el = await open();
    await startRename(el, 'Dacia', 'skoda');
    button(el, 'Salvează')?.click();
    await settle();
    button(el, 'Renunță')?.click();
    await settle();

    button(el, 'Redenumește Dacia')?.click();
    await settle();

    expect(rowOf(el, 'Dacia').textContent).not.toContain('Marca există deja');
  });

  // @traces 1368-FR-005
  it('shows no taken-name message when the field is opened on another row', async () => {
    update.mockRejectedValueOnce(
      conflict({ code: 'brand_exists', detail: 'Marca există deja: Škoda' }),
    );
    const el = await open();
    await startRename(el, 'Dacia', 'skoda');
    button(el, 'Salvează')?.click();
    await settle();

    button(el, 'Redenumește Lada')?.click();
    await settle();

    expect(rowOf(el, 'Lada').textContent).not.toContain('Marca există deja');
  });

  // @traces 1368-FR-005
  it('opens one rename field at a time', async () => {
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    button(el, 'Redenumește Lada')?.click();
    await settle();

    expect(el.querySelectorAll('tbody input')).toHaveLength(1);
  });

  // @traces 1368-FR-005
  it('returns focus to the rename control when the field is cancelled', async () => {
    const el = await open();
    button(el, 'Redenumește Dacia')?.click();
    await settle();

    button(el, 'Renunță')?.click();
    await settle();

    expect(document.activeElement).toBe(button(el, 'Redenumește Dacia'));
  });

  // @traces 1368-FR-009
  it('keeps the typed name in the open field when the language changes', async () => {
    const el = await open();
    await startRename(el, 'Dacia', 'Tesla');

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(field(el).value).toBe('Tesla');
    expect(button(el, 'Save')).toBeDefined();
    expect(button(el, 'Cancel')).toBeDefined();
  });

  // @traces 1368-FR-007
  it.each([
    ['a stale answer with no brand', conflict({ code: 'stale_value' })],
    [
      'a stale answer whose brand is null',
      conflict({ brand: null, code: 'stale_value' }),
    ],
    ['a 409 with no body', new HttpErrorResponse({ status: 409 })],
    ['an unknown 409 code', conflict({ code: 'other' })],
    ['a network failure', new HttpErrorResponse({ status: 0 })],
    ['a plain Error', new Error('boom')],
  ])('shows the save error and keeps the row on %s', async (_, err) => {
    update.mockRejectedValueOnce(err);
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
    expect(
      rowOf(el, 'Dacia').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('activă');
    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  // @traces 1368-FR-007
  it('keeps the rename field open with the typed name on a plain save failure', async () => {
    update.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const el = await open();
    await startRename(el, 'Dacia', 'Tesla');

    button(el, 'Salvează')?.click();
    await settle();

    expect(field(el).value).toBe('Tesla');
    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  // @traces 1368-FR-007
  it('re-reads from a stale answer to a retirement and re-sorts the row', async () => {
    const now = brand('Zastava', {
      id: 'id-Dacia',
      state: 'retired',
      updatedAt: '2026-10-25T11:00:00.000Z',
    });
    update.mockRejectedValueOnce(conflict({ brand: now, code: 'stale_value' }));
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    expect(names(el)).toEqual(['Lada', 'Škoda', 'Zastava']);
    expect(rowOf(el, 'Zastava').textContent).toContain(
      'Alt administrator a modificat marca; rândul a fost actualizat.',
    );
  });

  // @traces 1368-FR-007
  it('shows the stale notice on the changed row only, in English too', async () => {
    update.mockRejectedValueOnce(
      conflict({
        brand: brand('Dacia', {
          state: 'retired',
          updatedAt: '2026-10-25T11:00:00.000Z',
        }),
        code: 'stale_value',
      }),
    );
    const el = await open('en');

    button(el, 'Retire Dacia')?.click();
    await settle();

    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Another admin changed this brand; the row was refreshed.',
    );
    expect(rowOf(el, 'Lada').textContent).not.toContain('Another admin');
  });

  // @traces 1368-FR-007
  it('clears the stale notice at the next action on that row even when it fails', async () => {
    update.mockRejectedValueOnce(
      conflict({
        brand: brand('Dacia', { updatedAt: '2026-10-25T11:00:00.000Z' }),
        code: 'stale_value',
      }),
    );
    update.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const el = await open();
    button(el, 'Retrage Dacia')?.click();
    await settle();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    expect(rowOf(el, 'Dacia').textContent).not.toContain('Alt administrator');
    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  // @traces 1368-FR-007
  it('announces the stale notice and the save error through live regions', async () => {
    update.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    const live = rowOf(el, 'Dacia').querySelector(
      '[role="status"], [role="alert"]',
    );
    expect(live?.textContent).toContain('Nu s‑a putut salva.');
  });

  // @traces 1368-FR-008
  it('lets a different row act while the first row saves', async () => {
    update.mockImplementationOnce(() => new Promise(() => {}));
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();
    button(el, 'Readuce Lada')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(2);
  });

  // @traces 1368-FR-008
  it('sends one update when the save button is pressed twice in a rename', async () => {
    update.mockImplementationOnce(() => new Promise(() => {}));
    const el = await open();
    await startRename(el, 'Dacia', 'Tesla');

    button(el, 'Salvează')?.click();
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
  });

  // @traces 1368-FR-009
  it('names every row control after its brand', async () => {
    const el = await open();

    const labels = [...rowOf(el, 'Škoda').querySelectorAll('button')].map((b) =>
      (b.getAttribute('aria-label') ?? b.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Redenumește Škoda', 'Retrage Škoda']);
  });
});
