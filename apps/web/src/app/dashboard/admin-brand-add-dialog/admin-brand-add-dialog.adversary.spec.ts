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
const input = () => panel().querySelector('input') as HTMLInputElement;
const submit = () =>
  panel().querySelector('button[type="submit"]') as HTMLButtonElement;

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const conflict = (body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: { status: 409, ...body }, status: 409 });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the add-a-brand dialog under hostile input', () => {
  // @traces 1368-FR-003
  it('exports the API bounds 2 to 40', () => {
    expect(BRAND_NAME).toEqual({ max: 40, min: 2 });
  });

  // @traces 1368-FR-003
  it.each([
    ['exactly 2 characters', 'Ab', 'Ab'],
    ['exactly 40 characters', 'A'.repeat(40), 'A'.repeat(40)],
    [
      '40 characters padded with spaces',
      `  ${'A'.repeat(40)}  `,
      'A'.repeat(40),
    ],
  ])('accepts %s', async (_, value, sent) => {
    await open();
    type(input(), value);

    submit().click();
    await settle();

    expect(create).toHaveBeenCalledWith({ body: { name: sent } });
  });

  // @traces 1368-FR-003
  it.each([
    ['zero-width characters only', '​​​'],
    ['one letter between zero-width characters', '​A​​'],
    ['non-breaking spaces only', '   '],
    ['a tab and a newline', '\t\n'],
    ['41 characters after trimming', ` ${'Ž'.repeat(41)} `],
  ])('refuses %s with nothing sent', async (_, value) => {
    await open();
    type(input(), value);

    submit().click();
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  // @traces 1368-FR-003
  it('counts a combining accent as part of its letter, not as a character', async () => {
    await open();
    type(input(), 'Š');

    submit().click();
    await settle();

    expect(create).not.toHaveBeenCalled();
  });

  // @traces 1368-FR-003
  it('sends one create when the save button is pressed twice at once', async () => {
    await open();
    let answer: (b: AdminBrandDto) => void = () => {};
    create.mockImplementationOnce(
      () =>
        new Promise<AdminBrandDto>((resolve) => {
          answer = resolve;
        }),
    );
    type(input(), 'Xpeng');

    submit().click();
    submit().click();
    await settle();
    answer(created('Xpeng'));
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toEqual(created('Xpeng'));
  });

  // @traces 1368-FR-003
  it('submits from the keyboard with Enter in the field', async () => {
    await open();
    type(input(), 'Xpeng');

    input().form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(create).toHaveBeenCalledWith({ body: { name: 'Xpeng' } });
  });

  // @traces 1368-FR-004
  it.each([
    ['a 409 with another code', conflict({ code: 'other', detail: 'x' })],
    ['a 409 with no body', new HttpErrorResponse({ status: 409 })],
    ['a 400', new HttpErrorResponse({ status: 400 })],
    ['a network failure', new HttpErrorResponse({ status: 0 })],
    ['a plain Error', new Error('boom')],
  ])(
    'shows the generic save error on %s and keeps the name',
    async (_, err) => {
      await open();
      create.mockRejectedValueOnce(err);
      type(input(), 'Xpeng');

      submit().click();
      await settle();

      expect(panel().textContent).toContain(
        'Nu s‑a putut salva. Încearcă din nou.',
      );
      expect(input().value).toBe('Xpeng');
    },
  );

  // @traces 1368-FR-004
  it('drops the taken-name message once a later attempt fails differently', async () => {
    await open();
    create.mockRejectedValueOnce(
      conflict({ code: 'brand_exists', detail: 'Marca există deja: Škoda' }),
    );
    create.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    type(input(), 'skoda');
    submit().click();
    await settle();
    expect(panel().textContent).toContain('Marca există deja: Škoda');

    submit().click();
    await settle();

    expect(panel().textContent).not.toContain('Marca există deja');
    expect(panel().textContent).toContain(
      'Nu s‑a putut salva. Încearcă din nou.',
    );
  });

  // @traces 1368-FR-004
  it('shows a hostile taken-name message as text, not markup', async () => {
    await open();
    create.mockRejectedValueOnce(
      conflict({
        code: 'brand_exists',
        detail: 'Marca există deja: <img src=x onerror=alert(1)>',
      }),
    );
    type(input(), 'skoda');

    submit().click();
    await settle();

    expect(panel().querySelector('img')).toBeNull();
    expect(panel().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  // @traces 1368-FR-004
  it('announces the taken-name message and the save error through alert regions', async () => {
    await open();

    const alerts = panel().querySelectorAll('[role="alert"], [role="status"]');

    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  // @traces 1368-FR-003
  it('offers the labels the story names: Nume, Salvează and Renunță', async () => {
    await open();

    const labels = [...panel().querySelectorAll('label')].map((l) =>
      l.textContent?.trim(),
    );
    const buttons = [...panel().querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain('Nume');
    expect(buttons).toEqual(expect.arrayContaining(['Salvează', 'Renunță']));
  });

  // @traces 1368-FR-003
  it('offers the labels the story names in English: Name, Save and Cancel', async () => {
    await open('en');

    const labels = [...panel().querySelectorAll('label')].map((l) =>
      l.textContent?.trim(),
    );
    const buttons = [...panel().querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain('Name');
    expect(buttons).toEqual(expect.arrayContaining(['Save', 'Cancel']));
  });

  // @traces 1368-FR-003
  it('shows the 2 to 40 range next to the field', async () => {
    await open();

    const hint = document.getElementById('mf-brand-add-hint');
    expect(hint?.textContent).toMatch(/2.*40/);
  });
});
