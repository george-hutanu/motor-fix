import { TestBed } from '@angular/core/testing';
import type { DetailsSection } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { DetailsStep } from './details-step';

// @traces 109-FR-001 109-FR-002 109-FR-003

async function open(value: DetailsSection = {}, language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(DetailsStep);
  fixture.componentRef.setInput('value', value);
  const emitted: DetailsSection[] = [];
  fixture.componentInstance.value.subscribe((v) => emitted.push(v));
  fixture.detectChanges();
  await fixture.whenStable();
  const step = fixture.nativeElement as HTMLElement;
  const last = () => emitted.at(-1) ?? fixture.componentInstance.value();
  return { emitted, fixture, last, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const field = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  ) as HTMLInputElement;
const chips = (step: HTMLElement, group: string) => [
  ...step.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`),
];
const chip = (step: HTMLElement, group: string, label: string) =>
  chips(step, group).find((c) => text(c) === label) as HTMLButtonElement;
const errorOf = (step: HTMLElement, name: string) => {
  const ids = field(step, name).getAttribute('aria-describedby') ?? '';
  return ids
    .split(' ')
    .filter(Boolean)
    .map((id) => step.querySelector(`#${id}.error`))
    .filter(Boolean)
    .map(text)
    .join(' ');
};

function type({ fixture, step }: Opened, name: string, value: string) {
  const input = field(step, name);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function leave({ fixture, step }: Opened, name: string) {
  field(step, name).dispatchEvent(new Event('blur'));
  fixture.detectChanges();
}

function tap(opened: Opened, group: string, label: string) {
  chip(opened.step, group, label).click();
  opened.fixture.detectChanges();
}

describe('step 1, the garage details', () => {
  it('shows the name, the phone, what the garage is best at and the kind of business', async () => {
    const { step } = await open();

    expect(
      [...step.querySelectorAll('label')].map((l) => text(l)).slice(0, 3),
    ).toEqual(['Numele service‑ului', 'Telefon', 'La ce sunteți cei mai buni']);
    expect(text(step.querySelector('#listing-known-for-hint'))).toBe(
      'Un rând sau două pe care șoferii le citesc primele. Diesel german, reparații de cutii de viteze, frâne în aceeași zi.',
    );
    expect(chips(step, 'kind').map((c) => text(c))).toEqual([
      'Firmă',
      'PFA',
      'II',
      'Mecanic mobil',
    ]);
    expect(chips(step, 'legal')).toEqual([]);
    expect(field(step, 'phone').type).toBe('tel');
  });

  it('keeps each typed text in the section, and drops an emptied one', async () => {
    const opened = await open();

    type(opened, 'name', 'Service Popescu');
    type(opened, 'phone', '0722 123 456');
    type(opened, 'knownFor', 'Frâne');
    expect(opened.last()).toEqual({
      knownFor: 'Frâne',
      name: 'Service Popescu',
      phone: '0722 123 456',
    });

    type(opened, 'knownFor', '');
    expect(opened.last()).toEqual({
      name: 'Service Popescu',
      phone: '0722 123 456',
    });
  });

  it('chooses one kind of business, pressed, and asks the legal form only for a mobile mechanic', async () => {
    const opened = await open();

    tap(opened, 'kind', 'PFA');
    expect(chip(opened.step, 'kind', 'PFA').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(opened.last()).toEqual({ businessKind: 'pfa' });

    tap(opened, 'kind', 'Mecanic mobil');
    expect(chips(opened.step, 'legal').map((c) => text(c))).toEqual([
      'PFA',
      'Firmă',
    ]);
    tap(opened, 'legal', 'Firmă');
    expect(opened.last()).toEqual({
      businessKind: 'mobile',
      mobileLegalForm: 'company',
    });

    tap(opened, 'kind', 'Firmă');
    expect(chips(opened.step, 'legal')).toEqual([]);
    expect(opened.last()).toEqual({ businessKind: 'company' });
  });

  it('says a foreign phone is refused only once the field is left, and clears it for a Romanian one', async () => {
    const opened = await open();

    type(opened, 'phone', '+44 20 7946 0958');
    expect(errorOf(opened.step, 'phone')).toBe('');

    leave(opened, 'phone');
    expect(errorOf(opened.step, 'phone')).toBe(
      'Momentan acceptăm doar numere din România',
    );
    expect(field(opened.step, 'phone').getAttribute('aria-invalid')).toBe(
      'true',
    );

    type(opened, 'phone', '0722 123 456');
    expect(errorOf(opened.step, 'phone')).toBe('');
    expect(field(opened.step, 'phone').getAttribute('aria-invalid')).toBeNull();
  });

  it('asks for the name, phone and strengths once each field is left empty', async () => {
    const opened = await open();

    for (const name of ['name', 'phone', 'knownFor']) leave(opened, name);

    expect(errorOf(opened.step, 'name')).toBe('Între 2 și 80 de caractere');
    expect(errorOf(opened.step, 'phone')).toBe('Adaugă un număr de telefon');
    expect(errorOf(opened.step, 'knownFor')).toBe(
      'Spune pe scurt la ce sunteți cei mai buni',
    );
  });

  it('opens with the values the draft holds', async () => {
    const { step } = await open({
      businessKind: 'mobile',
      knownFor: 'Frâne',
      mobileLegalForm: 'pfa',
      name: 'Service Popescu',
      phone: '0722 123 456',
    });

    expect(field(step, 'name').value).toBe('Service Popescu');
    expect(field(step, 'phone').value).toBe('0722 123 456');
    expect(field(step, 'knownFor').value).toBe('Frâne');
    expect(
      chip(step, 'kind', 'Mecanic mobil').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(chip(step, 'legal', 'PFA').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('speaks English', async () => {
    const opened = await open({}, 'en');

    type(opened, 'phone', '+33 6 12 34 56 78');
    leave(opened, 'phone');

    expect(errorOf(opened.step, 'phone')).toBe(
      'We only take Romanian numbers for now',
    );
    expect(chips(opened.step, 'kind').map((c) => text(c))).toContain(
      'Mobile mechanic',
    );
  });
});
