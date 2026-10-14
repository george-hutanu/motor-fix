import { TestBed } from '@angular/core/testing';
import type { MechanicsSection } from '@motor-fix/contracts';
import { checkListing } from '@motor-fix/contracts/listing-check';
import { I18n } from '@motor-fix/i18n';

import { MechanicsStep } from './mechanics-step';
import { forStep } from '../field-watch';

// @traces 109-FR-011

// The page's judgement of the section, as it hands it to the step.
const judged = (value: MechanicsSection) =>
  forStep(checkListing({ data: { steps: { '4': value } } }), 4);

async function open(value: MechanicsSection = {}, language = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(MechanicsStep);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('problems', judged(value));
  const shown: boolean[] = [];
  fixture.componentInstance.value.subscribe((v) =>
    fixture.componentRef.setInput('problems', judged(v)),
  );
  fixture.componentInstance.shown.subscribe((v) => shown.push(v));
  fixture.detectChanges();
  await fixture.whenStable();
  const step = fixture.nativeElement as HTMLElement;
  const last = () => fixture.componentInstance.value();
  return { fixture, last, shown, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
// The errors the step shows: its live regions stay in place, empty when silent.
const shownErrors = (step: HTMLElement) =>
  [...step.querySelectorAll('.error')].map(text).filter(Boolean);
const toggle = (step: HTMLElement) =>
  step.querySelector<HTMLButtonElement>(
    'button[role="switch"]',
  ) as HTMLButtonElement;
const rows = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLElement>('li.mechanic'),
];
const nameField = (row: HTMLElement) =>
  row.querySelector<HTMLInputElement>('input[name="name"]') as HTMLInputElement;
const specialityField = (row: HTMLElement) =>
  row.querySelector<HTMLInputElement>(
    'input[name="speciality"]',
  ) as HTMLInputElement;
const addButton = (step: HTMLElement) =>
  step.querySelector<HTMLButtonElement>('button.add') as HTMLButtonElement;

function typeIn({ fixture }: Opened, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function leaveName({ fixture }: Opened, row: HTMLElement) {
  nameField(row).dispatchEvent(new Event('blur'));
  fixture.detectChanges();
}

function press({ fixture }: Opened, button: HTMLButtonElement) {
  button.click();
  fixture.detectChanges();
}

describe('step 4, the mechanics', () => {
  it('shows the switch off by default, the hint, no rows and the add button', async () => {
    const { step } = await open();

    expect(toggle(step).getAttribute('aria-checked')).toBe('false');
    expect(toggle(step).getAttribute('aria-label')).toBe(
      'Afișează‑i pe pagina ta',
    );
    expect(text(step)).toContain(
      'Oamenii cărora le poți da lucrări mai târziu',
    );
    expect(rows(step)).toEqual([]);
    expect(text(addButton(step))).toBe('Adaugă un mecanic');
  });

  it('keeps the switch in the section', async () => {
    const opened = await open();

    press(opened, toggle(opened.step));

    expect(opened.last()).toEqual({ onProfile: true });
    expect(toggle(opened.step).getAttribute('aria-checked')).toBe('true');
  });

  it('adds a row, keeps its name and speciality, and shows the initials', async () => {
    const opened = await open();

    press(opened, addButton(opened.step));
    const [row] = rows(opened.step);
    typeIn(opened, nameField(row), 'Ion Marin');
    typeIn(opened, specialityField(row), 'Diagnoză');

    expect(opened.last()).toEqual({
      mechanics: [{ name: 'Ion Marin', speciality: 'Diagnoză' }],
    });
    expect(text(row.querySelector('.initials'))).toBe('IM');

    typeIn(opened, specialityField(row), '');
    expect(opened.last()).toEqual({ mechanics: [{ name: 'Ion Marin' }] });
  });

  // @traces 115-FR-004 115-FR-006
  it('asks for a name of two characters once the field is left', async () => {
    const opened = await open();
    press(opened, addButton(opened.step));
    const [row] = rows(opened.step);
    typeIn(opened, nameField(row), 'I');

    const region = row.querySelector('#listing-mechanic-error-0');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(text(region)).toBe('');
    leaveName(opened, row);

    expect(text(row.querySelector('.error'))).toBe('Scrie numele mecanicului');
    expect(nameField(row).getAttribute('aria-invalid')).toBe('true');
    expect(nameField(row).getAttribute('aria-describedby')).toBe(
      'listing-mechanic-error-0',
    );
  });

  // @traces 115-FR-006
  it('shows a restored wrong name at once, without leaving it', async () => {
    const { fixture, step } = await open();
    const restored = { mechanics: [{ name: 'I' }, { name: 'Ana Pop' }] };
    fixture.componentRef.setInput('value', restored);
    fixture.componentRef.setInput('problems', judged(restored));
    fixture.detectChanges();

    const [first, second] = rows(step);
    expect(text(first.querySelector('.error'))).toBe(
      'Scrie numele mecanicului',
    );
    expect(text(second.querySelector('.error'))).toBe('');
  });

  // @traces 115-FR-004 115-FR-008
  it('shows every wrong name when sending is asked for', async () => {
    const opened = await open();
    press(opened, addButton(opened.step));
    press(opened, addButton(opened.step));
    expect(shownErrors(opened.step)).toEqual([]);

    opened.fixture.componentRef.setInput('showAll', true);
    opened.fixture.detectChanges();

    expect(shownErrors(opened.step)).toHaveLength(2);
    expect(opened.shown.at(-1)).toBe(true);
  });

  // @traces 115-FR-006
  it('follows the name once shown, and goes when it is fixed', async () => {
    const opened = await open();
    press(opened, addButton(opened.step));
    const [row] = rows(opened.step);
    leaveName(opened, row);
    expect(text(row.querySelector('.error'))).toBe('Scrie numele mecanicului');

    typeIn(opened, nameField(row), 'Ion Marin');

    expect(text(row.querySelector('.error'))).toBe('');
    expect(nameField(row).getAttribute('aria-invalid')).toBeNull();
  });

  // @traces 115-FR-005
  it('tells a warning without marking the name wrong', async () => {
    const opened = await open({ mechanics: [{ name: 'Ion Marin' }] });
    opened.fixture.componentRef.setInput('problems', {
      errors: [],
      warnings: [{ code: 'invalid', field: 'steps.4.mechanics[0].name' }],
    });
    opened.fixture.detectChanges();
    const [row] = rows(opened.step);

    expect(text(row.querySelector('.warning'))).toBe(
      'Scrie numele mecanicului',
    );
    expect(nameField(row).getAttribute('aria-invalid')).toBeNull();
    expect(opened.shown.at(-1)).toBe(false);
  });

  // @traces 115-FR-007
  it('says whether it shows an error, and marks each name by its row', async () => {
    const opened = await open({
      mechanics: [{ name: 'Ion Marin' }, { name: 'Ana Pop' }],
    });

    expect(opened.shown.at(-1)).toBe(false);
    const second = rows(opened.step)[1];
    typeIn(opened, nameField(second), '');
    leaveName(opened, second);
    expect(opened.shown.at(-1)).toBe(true);
    expect(
      [...opened.step.querySelectorAll('[data-field]')].map((e) =>
        e.getAttribute('data-field'),
      ),
    ).toEqual(['steps.4.mechanics[0].name', 'steps.4.mechanics[1].name']);
  });

  it('removes a row', async () => {
    const opened = await open({
      mechanics: [{ name: 'Ion Marin' }, { name: 'Ana Pop' }],
    });

    press(
      opened,
      rows(opened.step)[0].querySelector(
        'button[aria-label="Șterge Ion Marin"]',
      ) as HTMLButtonElement,
    );

    expect(opened.last()).toEqual({ mechanics: [{ name: 'Ana Pop' }] });
    expect(rows(opened.step)).toHaveLength(1);
  });

  it('stops adding at 30 mechanics and says so', async () => {
    const mechanics = Array.from({ length: 30 }, (_, i) => ({
      name: `Mecanic ${i}`,
    }));
    const { step } = await open({ mechanics });

    expect(addButton(step).disabled).toBe(true);
    expect(text(step)).toContain('Cel mult 30 de mecanici');
  });

  it('restores the kept rows and switch, and speaks English', async () => {
    const { step } = await open(
      {
        mechanics: [{ name: 'Ana Pop', speciality: 'Frâne' }],
        onProfile: true,
      },
      'en',
    );

    expect(toggle(step).getAttribute('aria-checked')).toBe('true');
    expect(nameField(rows(step)[0]).value).toBe('Ana Pop');
    expect(specialityField(rows(step)[0]).value).toBe('Frâne');
    expect(text(addButton(step))).toBe('Add a mechanic');
  });
});
