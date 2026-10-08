import { TestBed } from '@angular/core/testing';
import type { MechanicsSection } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { MechanicsStep } from './mechanics-step';

// @traces 109-FR-011

async function open(value: MechanicsSection = {}, language = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(MechanicsStep);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  await fixture.whenStable();
  const step = fixture.nativeElement as HTMLElement;
  const last = () => fixture.componentInstance.value();
  return { fixture, last, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
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

  it('asks for a name of two characters once the field is left', async () => {
    const opened = await open({ mechanics: [{ name: 'I' }] });
    const [row] = rows(opened.step);

    expect(row.querySelector('.error')).toBeNull();
    nameField(row).dispatchEvent(new Event('blur'));
    opened.fixture.detectChanges();

    expect(text(row.querySelector('.error'))).toBe('Scrie numele mecanicului');
    expect(nameField(row).getAttribute('aria-invalid')).toBe('true');
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
