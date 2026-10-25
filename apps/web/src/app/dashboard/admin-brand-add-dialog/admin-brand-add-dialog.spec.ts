// @traces 1368-FR-003 1368-FR-004
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type AdminBrandDto, AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { AdminBrandAddDialog, BRAND_NAME } from './admin-brand-add-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const created = (name: string): AdminBrandDto => ({
  cars: 0,
  garages: 0,
  id: 'id-new',
  name,
  slug: name.toLowerCase(),
  state: 'active',
  updatedAt: '2026-10-25T12:00:00.000Z',
  updatedBy: null,
});

let create: jest.Mock;
let result: Promise<OverlayResult<AdminBrandDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  create = jest.fn(async ({ body }: { body: { name: string } }) =>
    created(body.name),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { adminBrandsControllerCreate: create },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<AdminBrandDto>(
    AdminBrandAddDialog,
    { shape: 'dialog', title: 'admin.brands.add.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  const input = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const text = () => panel().textContent ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the add-a-brand dialog', () => {
  it("keeps the bound the API publishes for a new brand's name", () => {
    const openapi = JSON.parse(
      readFileSync(join(__dirname, '../../../../../api/openapi.json'), 'utf8'),
    );
    const name = openapi.components.schemas.CreateBrandDto.properties.name;

    expect(BRAND_NAME).toEqual({ max: name.maxLength, min: name.minLength });
  });

  it('asks for the name with one field, a save and a cancel button', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Adaugă o marcă',
    );
    expect(field('Nume').type).toBe('text');
    expect(button('Salvează')?.type).toBe('submit');
    expect(button('Renunță')?.type).toBe('button');
  });

  it('closes cancelled on Renunță and sends nothing', async () => {
    await open();
    type(field('Nume'), 'Xpeng');

    button('Renunță')?.click();
    await settle();

    expect(create).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('sends the trimmed name and closes with the new brand', async () => {
    await open();
    type(field('Nume'), '  Xpeng ');

    button('Salvează')?.click();
    await settle();

    expect(create).toHaveBeenCalledWith({ body: { name: 'Xpeng' } });
    await expect(result).resolves.toEqual(created('Xpeng'));
  });

  it.each([
    ['nothing', ''],
    ['one character', ' X '],
    ['41 characters', 'A'.repeat(41)],
    ['only spaces', '    '],
  ])('refuses %s before sending', async (_, value) => {
    await open();
    const input = field('Nume');
    type(input, value);

    button('Salvează')?.click();
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(panel()).toBeDefined();
  });

  it('shows the taken-name message under the field, the name kept', async () => {
    await open('en');
    create.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'brand_exists',
          detail: 'Marca există deja: Škoda',
          status: 409,
        },
        status: 409,
      }),
    );
    const input = field('Name');
    type(input, 'skoda');

    button('Save')?.click();
    await settle();

    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Marca există deja: Škoda');
    expect(input.value).toBe('skoda');
    expect(button('Save')).toBeDefined();
  });

  it('says the save failed on any other failure and stays open', async () => {
    await open();
    create.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    type(field('Nume'), 'Xpeng');

    button('Salvează')?.click();
    await settle();

    expect(text()).toContain('Nu s‑a putut salva. Încearcă din nou.');
    expect(field('Nume').value).toBe('Xpeng');
  });

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Add a brand',
    );
    expect(field('Name')).toBeDefined();
    expect(button('Save')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });
});
