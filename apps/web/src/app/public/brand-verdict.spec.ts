import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { GarageBrandAnswerDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandVerdict, verdict } from './brand-verdict';

const ref = (name: string, i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name,
  slug: name.toLowerCase(),
});
const BMW = ref('BMW', 1);
const AUDI = ref('Audi', 2);
const DACIA = ref('Dacia', 3);
const TESLA = ref('Tesla', 4);

const answer = (
  over: Partial<GarageBrandAnswerDto> = {},
): GarageBrandAnswerDto => ({
  brandNote: null,
  doesNotTake: [],
  refusalPhrase: null,
  worksOn: [],
  ...over,
});

type Inputs = {
  answer?: GarageBrandAnswerDto | null;
  brand?: { id: string; name: string } | null;
  mode?: 'card' | 'profile';
};

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function render(inputs: Inputs, language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(BrandVerdict);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host };
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('verdict rule', () => {
  it('says works_on when the brand is in the works-on list', () => {
    expect(verdict(answer({ worksOn: [BMW, AUDI] }), BMW.id)).toBe('works_on');
  });

  it('says refused when the brand is in the refusal list', () => {
    expect(verdict(answer({ doesNotTake: [DACIA] }), DACIA.id)).toBe('refused');
  });

  it('says refused when the garage has not marked the brand at all', () => {
    expect(verdict(answer({ worksOn: [BMW] }), TESLA.id)).toBe('refused');
    expect(verdict(answer(), TESLA.id)).toBe('refused');
  });

  it('lets works_on win when the brand sits in both lists', () => {
    expect(
      verdict(answer({ doesNotTake: [BMW], worksOn: [BMW] }), BMW.id),
    ).toBe('works_on');
  });
});

describe('BrandVerdict', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a green lamp naming the brand when the garage works on it', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: BMW,
      mode: 'profile',
    });
    const lamp = host.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(text(lamp)).toBe('Lucrează pe BMW');
  });

  it('shows a red lamp for a refused brand, in English too', async () => {
    const { host } = await render(
      {
        answer: answer({ doesNotTake: [DACIA] }),
        brand: DACIA,
        mode: 'profile',
      },
      'en',
    );
    const lamp = host.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(text(lamp)).toBe('Does not take Dacia');
  });

  it('shows a red lamp for a brand the garage never marked', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: TESLA,
      mode: 'card',
    });
    const lamp = host.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(text(lamp)).toBe('Nu primește Tesla');
  });

  it('shows no lamp when no brand is chosen, only the lists', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW, AUDI] }),
      brand: null,
      mode: 'profile',
    });
    expect(host.querySelector('mf-lamp')).toBeNull();
    expect(text(host)).toContain('Lucrează pe: BMW, Audi');
  });

  it('shows one grey loading lamp and no lists while the answer is missing', async () => {
    for (const brand of [BMW, null]) {
      const { host } = await render({ answer: null, brand, mode: 'card' });
      const lamp = host.querySelector('mf-lamp');
      expect(lamp?.getAttribute('data-state')).toBe('grey');
      expect(text(lamp)).toBe('Se încarcă…');
      expect(text(host)).not.toContain('Lucrează pe:');
      expect(text(host)).not.toContain('Nu primește:');
      TestBed.resetTestingModule();
    }
  });

  it('writes both lists in the order given', async () => {
    const { host } = await render({
      answer: answer({ doesNotTake: [DACIA, TESLA], worksOn: [BMW, AUDI] }),
      brand: null,
      mode: 'profile',
    });
    expect(text(host)).toContain('Lucrează pe: BMW, Audi');
    expect(text(host)).toContain('Nu primește: Dacia, Tesla');
  });

  it('hides an empty list line', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: null,
      mode: 'profile',
    });
    expect(text(host)).toContain('Lucrează pe: BMW');
    expect(text(host)).not.toContain('Nu primește:');
    expect(text(host)).not.toContain('nimic ales încă');
  });

  it('says nothing is picked yet on both lines when both lists are empty and there is no phrase', async () => {
    const { host } = await render(
      { answer: answer(), brand: null, mode: 'profile' },
      'en',
    );
    const lines = [...host.querySelectorAll('.line')].map(text);
    expect(lines).toEqual([
      'Works on: nothing picked yet',
      'Does not take: nothing picked yet',
    ]);
  });

  it('puts the refusal phrase in place of the refused names', async () => {
    const { host } = await render({
      answer: answer({
        doesNotTake: [DACIA, TESLA],
        refusalPhrase: 'Nu lucrăm pe electrice',
        worksOn: [BMW],
      }),
      brand: null,
      mode: 'profile',
    });
    expect(text(host)).toContain('Nu primește: Nu lucrăm pe electrice');
    expect(text(host)).not.toContain('Dacia');
    expect(text(host)).not.toContain('nimic ales încă');
  });

  it('treats a blank refusal phrase as none', async () => {
    const { host } = await render({
      answer: answer({ doesNotTake: [DACIA], refusalPhrase: '   ' }),
      brand: null,
      mode: 'profile',
    });
    expect(text(host)).toContain('Nu primește: Dacia');
  });

  it('shows the full note on a profile', async () => {
    const note = 'Specializați pe cutii automate. Programări doar dimineața.';
    const { host } = await render({
      answer: answer({ brandNote: note, worksOn: [BMW] }),
      brand: null,
      mode: 'profile',
    });
    const el = host.querySelector('.note');
    expect(text(el)).toBe(note);
    expect(el?.classList.contains('card')).toBe(false);
  });

  it('keeps the full note in the page on a card, clipped by its class', async () => {
    const note = 'Specializați pe cutii automate. Programări doar dimineața.';
    const { host } = await render({
      answer: answer({ brandNote: note, worksOn: [BMW] }),
      brand: BMW,
      mode: 'card',
    });
    const el = host.querySelector('.note');
    expect(el?.classList.contains('card')).toBe(true);
    expect(text(el)).toBe(note);
  });

  it('shows no note when the garage wrote none', async () => {
    const { host } = await render({
      answer: answer({ brandNote: '  ', worksOn: [BMW] }),
      brand: null,
      mode: 'profile',
    });
    expect(host.querySelector('.note')).toBeNull();
  });

  it('prints a note that looks like HTML as text', async () => {
    const { host } = await render({
      answer: answer({ brandNote: '<b>bold</b><img src=x>', worksOn: [BMW] }),
      brand: null,
      mode: 'profile',
    });
    expect(host.querySelector('.note b')).toBeNull();
    expect(host.querySelector('.note img')).toBeNull();
    expect(text(host.querySelector('.note'))).toBe('<b>bold</b><img src=x>');
  });

  it('redraws in place when a new answer arrives', async () => {
    const { fixture, host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: BMW,
      mode: 'card',
    });
    const before = host.querySelector('mf-lamp');
    expect(before?.getAttribute('data-state')).toBe('green');
    fixture.componentRef.setInput('answer', answer({ doesNotTake: [BMW] }));
    await settle(fixture);
    const after = host.querySelector('mf-lamp');
    expect(after?.getAttribute('data-state')).toBe('red');
    expect(text(after)).toBe('Nu primește BMW');
    expect(text(host)).toContain('Nu primește: BMW');
  });
});
