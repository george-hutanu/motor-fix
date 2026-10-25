// @traces 1368-FR-001 1368-FR-002 1368-FR-003 1368-FR-005 1368-FR-006
// @traces 1368-FR-007 1368-FR-008 1368-FR-009
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

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('the brand list', () => {
  it('lists every brand with its state and both counts under its heading', async () => {
    const el = await open();

    const heading = el.querySelector('h2');
    expect(heading?.textContent?.trim()).toBe('Lista de mărci');
    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
    const headers = [...el.querySelectorAll('thead th')].map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(
      expect.arrayContaining(['Marcă', 'Stare', 'Service‑uri', 'Mașini']),
    );
    const dacia = rowOf(el, 'Dacia');
    expect(dacia.querySelector('mf-lamp')?.textContent?.trim()).toBe('activă');
    expect(dacia.querySelector('[data-garages]')?.textContent).toContain('18');
    expect(dacia.querySelector('[data-cars]')?.textContent).toContain('1.240');
    expect(
      rowOf(el, 'Lada').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('retrasă');
    expect(
      rowOf(el, 'Lada').querySelector('[data-cars]')?.textContent,
    ).toContain('0');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('speaks English when the interface does', async () => {
    const el = await open('en');

    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Brand list');
    expect(
      rowOf(el, 'Lada').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('retired');
    expect(button(el, 'Add a brand')).toBeDefined();
  });

  it('filters the loaded rows ignoring accents and case, with no new read', async () => {
    const el = await open();

    type(search(el), 'SKODA');
    await settle();

    expect(names(el)).toEqual(['Škoda']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(search(el).getAttribute('aria-label')).toBe('Caută o marcă');
  });

  it('says no brand matches when the search finds none', async () => {
    const el = await open();

    type(search(el), 'xpeng');
    await settle();

    expect(rows(el)).toHaveLength(0);
    expect(el.textContent).toContain('Nicio marcă nu se potrivește');
  });

  it('says no brand matches when the list is empty', async () => {
    list = jest.fn(async () => ({ items: [] }));
    const el = await open();

    expect(el.textContent).toContain('Nicio marcă nu se potrivește');
  });

  it('shows three skeleton rows and no row action while the list is read', async () => {
    list = jest.fn(() => new Promise(() => {}));
    const el = await open();

    const busy = el.querySelector('[aria-busy="true"]');
    expect(busy?.querySelectorAll('.skeleton-row')).toHaveLength(3);
    expect(search(el)).not.toBeNull();
    expect(button(el, 'Adaugă o marcă')).toBeDefined();
    expect(button(el, 'Redenumește')).toBeUndefined();
  });

  it('says the list could not be read and reads it again on retry', async () => {
    list = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    const el = await open();

    expect(el.textContent).toContain('Lista de mărci nu a putut fi citită.');
    list.mockImplementation(async () => ({ items: SEED }));
    button(el, 'Încearcă din nou')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
  });
});

describe('adding a brand', () => {
  it('opens the add dialog and puts the new brand at its folded-name place, clearing the search', async () => {
    const created = brand('Ford');
    openDialog.mockImplementation(async () => created);
    const el = await open();
    type(search(el), 'dac');
    await settle();

    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(openDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shape: 'dialog' }),
    );
    expect(search(el).value).toBe('');
    expect(names(el)).toEqual(['Dacia', 'Ford', 'Lada', 'Škoda']);
  });

  it('leaves the list as it was when the dialog is cancelled', async () => {
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
  });
});

describe('editing a row', () => {
  it('renames in place, sending the seen updatedAt, and re-sorts by folded name', async () => {
    const el = await open();

    button(rowOf(el, 'Dacia'), 'Redenumește Dacia')?.click();
    await settle();
    const field = rowOf(el, 'Dacia')?.querySelector(
      'input',
    ) as HTMLInputElement;
    expect(field.value).toBe('Dacia');
    expect(button(el, 'Retrage Dacia')).toBeUndefined();
    type(field, 'Tesla');
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { name: 'Tesla', seenUpdatedAt: '2026-10-01T10:00:00.000Z' },
      id: 'id-Dacia',
    });
    expect(names(el)).toEqual(['Lada', 'Škoda', 'Tesla']);
    expect(el.querySelector('tbody input')).toBeNull();
  });

  it('refuses a name outside 2 to 40 visible characters before sending', async () => {
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, ' D ');
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    const input = el.querySelector('tbody input') as HTMLInputElement;
    expect(input).not.toBeNull();
    const error = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((node) => node?.getAttribute('role') === 'alert');
    expect(error?.textContent?.trim()).toBe('Între 2 și 40 de caractere.');
  });

  it('closes the field with nothing sent when the name is unchanged', async () => {
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    button(el, 'Salvează')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    expect(el.querySelector('tbody input')).toBeNull();
    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
  });

  it('moves focus into the field on Rename and back to Rename on Cancel', async () => {
    const el = await open();

    button(el, 'Redenumește Dacia')?.focus();
    button(el, 'Redenumește Dacia')?.click();
    await settle();
    expect(document.activeElement).toBe(el.querySelector('tbody input'));

    button(el, 'Renunță')?.click();
    await settle();
    expect(el.querySelector('tbody input')).toBeNull();
    expect(document.activeElement).toBe(button(el, 'Redenumește Dacia'));
  });

  it('returns focus to the row after a saved rename', async () => {
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'Dacia Nouă');
    button(el, 'Salvează')?.click();
    await settle();

    expect(document.activeElement).toBe(button(el, 'Redenumește Dacia Nouă'));
  });

  it("keeps focus on the row's state action as it turns from Retire to Bring back", async () => {
    const el = await open();

    button(el, 'Retrage Dacia')?.focus();
    button(el, 'Retrage Dacia')?.click();
    await settle();

    expect(document.activeElement).toBe(button(el, 'Readuce Dacia'));
  });

  it('reads a taken-name answer that arrives as text', async () => {
    update.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: JSON.stringify({
          code: 'brand_exists',
          detail: 'Marca există deja: Škoda',
          status: 409,
        }),
        status: 409,
      }),
    );
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'skoda');
    button(el, 'Salvează')?.click();
    await settle();

    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Marca există deja: Škoda',
    );
  });

  it('re-reads the row from a stale answer that arrives as text', async () => {
    const now = brand('Dacia Group', {
      id: 'id-Dacia',
      state: 'retired',
      updatedAt: '2026-10-25T11:00:00.000Z',
    });
    update.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: JSON.stringify({ brand: now, code: 'stale_value', status: 409 }),
        status: 409,
      }),
    );
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'Dacia SA');
    button(el, 'Salvează')?.click();
    await settle();

    const row = rowOf(el, 'Dacia Group');
    expect(row.querySelector('mf-lamp')?.textContent?.trim()).toBe('retrasă');
    expect(row.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Alt administrator a modificat marca; rândul a fost actualizat.',
    );
  });

  it('says the save failed when a conflict body is not valid JSON', async () => {
    update.mockRejectedValueOnce(
      new HttpErrorResponse({ error: '{"code":"stale_value",', status: 409 }),
    );
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'Dacia SA');
    button(el, 'Salvează')?.click();
    await settle();

    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  it('keeps the field open with the API message when the name is taken', async () => {
    update.mockRejectedValueOnce(
      conflict({ code: 'brand_exists', detail: 'Marca există deja: Škoda' }),
    );
    const el = await open('en');

    button(el, 'Rename Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'skoda');
    button(el, 'Save')?.click();
    await settle();

    const field = el.querySelector('tbody input') as HTMLInputElement;
    expect(field.value).toBe('skoda');
    expect(rowOf(el, 'Dacia')?.textContent).toContain(
      'Marca există deja: Škoda',
    );
  });

  it('retires an active brand and brings it back, each with the seen updatedAt', async () => {
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();
    expect(update).toHaveBeenLastCalledWith({
      body: { active: false, seenUpdatedAt: '2026-10-01T10:00:00.000Z' },
      id: 'id-Dacia',
    });
    expect(
      rowOf(el, 'Dacia').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('retrasă');

    update.mockImplementationOnce(async () =>
      brand('Dacia', { updatedAt: '2026-10-25T12:05:00.000Z' }),
    );
    button(el, 'Readuce Dacia')?.click();
    await settle();
    expect(update).toHaveBeenLastCalledWith({
      body: { active: true, seenUpdatedAt: '2026-10-25T12:00:00.000Z' },
      id: 'id-Dacia',
    });
    expect(
      rowOf(el, 'Dacia').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('activă');
  });

  it('re-reads the row from a stale answer and says another admin changed it', async () => {
    const now = brand('Dacia Group', {
      cars: 1300,
      garages: 19,
      id: 'id-Dacia',
      state: 'retired',
      updatedAt: '2026-10-25T11:00:00.000Z',
    });
    update.mockRejectedValueOnce(conflict({ brand: now, code: 'stale_value' }));
    const el = await open();

    button(el, 'Redenumește Dacia')?.click();
    await settle();
    type(el.querySelector('tbody input') as HTMLInputElement, 'Dacia SA');
    button(el, 'Salvează')?.click();
    await settle();

    const row = rowOf(el, 'Dacia Group');
    expect(row).toBeDefined();
    expect(row.querySelector('mf-lamp')?.textContent?.trim()).toBe('retrasă');
    expect(row.querySelector('[data-cars]')?.textContent).toContain('1.300');
    expect(el.querySelector('tbody input')).toBeNull();
    expect(row.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Alt administrator a modificat marca; rândul a fost actualizat.',
    );

    button(row, 'Readuce Dacia Group')?.click();
    await settle();
    expect(update).toHaveBeenLastCalledWith({
      body: { active: true, seenUpdatedAt: '2026-10-25T11:00:00.000Z' },
      id: 'id-Dacia',
    });
    expect(el.textContent).not.toContain('Alt administrator');
  });

  it('says the save failed and leaves the row as it was on another failure', async () => {
    update.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    const row = rowOf(el, 'Dacia');
    expect(row.querySelector('mf-lamp')?.textContent?.trim()).toBe('activă');
    expect(row.textContent).toContain('Nu s‑a putut salva. Încearcă din nou.');
  });

  it('ignores a second action on a row while its save is on its way', async () => {
    let answer: (value: AdminBrandDto) => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise<AdminBrandDto>((resolve) => {
          answer = resolve;
        }),
    );
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();
    button(el, 'Retrage Dacia')?.click();
    button(el, 'Redenumește Dacia')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(el.querySelector('tbody input')).toBeNull();
    answer(brand('Dacia', { state: 'retired' }));
    await settle();
    expect(
      rowOf(el, 'Dacia').querySelector('mf-lamp')?.textContent?.trim(),
    ).toBe('retrasă');
  });

  it('lets another row act while one row saves, each keeping its own notice', async () => {
    let answer: (value: AdminBrandDto) => void = () => {};
    update
      .mockImplementationOnce(
        () =>
          new Promise<AdminBrandDto>((resolve) => {
            answer = resolve;
          }),
      )
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();
    button(el, 'Retrage Škoda')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(2);
    expect(rowOf(el, 'Škoda').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
    answer(brand('Dacia', { state: 'retired' }));
    await settle();
    expect(rowOf(el, 'Dacia').getAttribute('aria-busy')).toBeNull();
    expect(rowOf(el, 'Škoda').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  it("keeps another row's open field when a stale answer refreshes this row", async () => {
    let answer: () => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          answer = () =>
            reject(
              conflict({
                brand: brand('Lada', { state: 'active' }),
                code: 'stale_value',
              }),
            );
        }),
    );
    const el = await open();

    button(el, 'Readuce Lada')?.click();
    await settle();
    button(el, 'Redenumește Dacia')?.click();
    await settle();
    answer();
    await settle();

    expect(rowOf(el, 'Dacia').querySelector('input')).not.toBeNull();
    expect(rowOf(el, 'Lada').textContent).toContain(
      'Alt administrator a modificat marca',
    );
  });

  it('says the save failed when a stale answer carries no usable brand', async () => {
    update.mockRejectedValueOnce(
      conflict({ brand: { id: 'id-Dacia' }, code: 'stale_value' }),
    );
    const el = await open();

    button(el, 'Retrage Dacia')?.click();
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda']);
    expect(rowOf(el, 'Dacia').textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  it('keeps a brand added while the list was still being read', async () => {
    let answer: (value: { items: AdminBrandDto[] }) => void = () => {};
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    openDialog.mockResolvedValueOnce(brand('Xpeng'));
    const el = await open();

    button(el, 'Adaugă o marcă')?.click();
    await settle();
    answer({ items: SEED.map((b) => ({ ...b })) });
    await settle();

    expect(names(el)).toEqual(['Dacia', 'Lada', 'Škoda', 'Xpeng']);
  });
});
