import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { type BrandAnswer, BrandVerdict, verdict } from './brand-verdict';

const ref = (name: string, i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name,
  slug: name.toLowerCase(),
});
const BMW = ref('BMW', 1);
const AUDI = ref('Audi', 2);
const DACIA = ref('Dacia', 3);
const TESLA = ref('Tesla', 4);

const answer = (over: Partial<BrandAnswer> = {}): BrandAnswer => ({
  brandNote: null,
  doesNotTake: [],
  refusalPhrase: null,
  worksOn: [],
  ...over,
});

type Inputs = {
  answer?: BrandAnswer | null;
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

const lines = (host: HTMLElement) =>
  [...host.querySelectorAll('.line')].map(text);

describe('verdict rule, adversarial', () => {
  it('refuses a brand id that differs only by letter case', () => {
    expect(
      verdict(
        answer({
          worksOn: [{ ...BMW, id: 'ABCDEF00-0000-4000-8000-000000000001' }],
        }),
        'abcdef00-0000-4000-8000-000000000001',
      ),
    ).toBe('refused');
  });

  it('refuses an empty brand id even when a listed brand has the same name', () => {
    expect(verdict(answer({ worksOn: [BMW] }), '')).toBe('refused');
  });

  it('matches by id, not by name or slug', () => {
    expect(verdict(answer({ worksOn: [BMW] }), 'BMW')).toBe('refused');
    expect(verdict(answer({ worksOn: [BMW] }), 'bmw')).toBe('refused');
  });

  it('finds a brand at the end of a ten-thousand-brand list', () => {
    const many = Array.from({ length: 10000 }, (_, i) => ref(`B${i}`, i + 100));
    expect(verdict(answer({ worksOn: many }), many[9999].id)).toBe('works_on');
  });

  it('returns the same answer when called twice', () => {
    const a = answer({ doesNotTake: [TESLA], worksOn: [BMW] });
    expect([verdict(a, BMW.id), verdict(a, BMW.id)]).toEqual([
      'works_on',
      'works_on',
    ]);
    expect(a.worksOn).toEqual([BMW]);
  });
});

describe('BrandVerdict, adversarial', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides the refusal line and shows no empty-state text when only works-on has content', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: null,
    });
    expect(lines(host)).toEqual(['Lucrează pe: BMW']);
  });

  it('hides the works-on line when only the refusal list has content', async () => {
    const { host } = await render({
      answer: answer({ doesNotTake: [TESLA] }),
      brand: null,
    });
    expect(lines(host)).toEqual(['Nu primește: Tesla']);
  });

  it('shows the phrase on the refusal line when the refusal list is empty', async () => {
    const { host } = await render({
      answer: answer({ refusalPhrase: 'orice nu e BMW', worksOn: [BMW] }),
      brand: null,
    });
    expect(lines(host)).toEqual([
      'Lucrează pe: BMW',
      'Nu primește: orice nu e BMW',
    ]);
  });

  it('shows only the phrase line, with the works-on line hidden, when only a phrase is set', async () => {
    const { host } = await render({
      answer: answer({ refusalPhrase: 'orice nu e BMW' }),
      brand: null,
    });
    expect(lines(host)).toEqual(['Nu primește: orice nu e BMW']);
  });

  it('treats a phrase of tabs and newlines as none', async () => {
    const { host } = await render({
      answer: answer({ refusalPhrase: '\t\n  ' }),
      brand: null,
    });
    expect(lines(host)).toEqual([
      'Lucrează pe: nimic ales încă',
      'Nu primește: nimic ales încă',
    ]);
  });

  it('keeps a phrase as written, including inner spacing and diacritics', async () => {
    const { host } = await render({
      answer: answer({ refusalPhrase: 'Nu lucrăm pe  Șkoda — „electrice”' }),
      brand: null,
    });
    expect(host.textContent).toContain('Nu lucrăm pe  Șkoda — „electrice”');
  });

  it('prints a phrase that looks like HTML as text', async () => {
    const { host } = await render({
      answer: answer({ refusalPhrase: '<img src=x onerror=alert(1)>' }),
      brand: null,
    });
    expect(host.querySelector('img')).toBeNull();
    expect(lines(host)).toContain('Nu primește: <img src=x onerror=alert(1)>');
  });

  it('prints a brand name that looks like HTML as text', async () => {
    const evil = { ...BMW, name: '<script>x</script>' };
    const { host } = await render({
      answer: answer({ worksOn: [evil] }),
      brand: evil,
    });
    expect(host.querySelector('script')).toBeNull();
    expect(text(host.querySelector('mf-lamp'))).toBe(
      'Lucrează pe <script>x</script>',
    );
  });

  it('shows the lamp label with the name of the chosen brand, not the name in the garage list', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [{ ...BMW, name: 'Old name' }] }),
      brand: { id: BMW.id, name: 'BMW' },
    });
    expect(text(host.querySelector('mf-lamp'))).toBe('Lucrează pe BMW');
  });

  it('shows a green lamp when the chosen brand sits in both lists', async () => {
    const { host } = await render({
      answer: answer({ doesNotTake: [BMW], worksOn: [BMW] }),
      brand: BMW,
    });
    expect(host.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
  });

  it('shows a red lamp for a chosen brand the garage lists do not contain, with no error', async () => {
    const { host } = await render({
      answer: answer(),
      brand: { id: 'not-a-uuid', name: 'Lada' },
    });
    const lamp = host.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(text(lamp)).toBe('Nu primește Lada');
  });

  it('shows the loading placeholder only, with no lists or note, when loading with data present', async () => {
    const { host } = await render({
      answer: null,
      brand: BMW,
      mode: 'profile',
    });
    expect(text(host)).toBe('Se încarcă…');
    expect(host.querySelectorAll('mf-lamp')).toHaveLength(1);
    expect(host.querySelector('.note')).toBeNull();
  });

  it('shows the English loading text', async () => {
    const { host } = await render({ answer: null }, 'en');
    expect(text(host)).toBe('Loading…');
  });

  it('replaces the loading placeholder in place when the answer arrives', async () => {
    const { fixture, host } = await render({ answer: null, brand: BMW });
    expect(host.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'grey',
    );
    fixture.componentRef.setInput('answer', answer({ worksOn: [BMW] }));
    await settle(fixture);
    expect(host.querySelectorAll('mf-lamp')).toHaveLength(1);
    expect(host.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
    expect(text(host)).not.toContain('Se încarcă');
  });

  it('goes back to the placeholder when the answer is withdrawn', async () => {
    const { fixture, host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: BMW,
    });
    fixture.componentRef.setInput('answer', null);
    await settle(fixture);
    expect(text(host)).toBe('Se încarcă…');
  });

  it('removes the lamp when the chosen brand is cleared', async () => {
    const { fixture, host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: BMW,
    });
    fixture.componentRef.setInput('brand', null);
    await settle(fixture);
    expect(host.querySelector('mf-lamp')).toBeNull();
    expect(lines(host)).toEqual(['Lucrează pe: BMW']);
  });

  it('answers for the new brand when the chosen brand changes', async () => {
    const { fixture, host } = await render({
      answer: answer({ doesNotTake: [TESLA], worksOn: [BMW] }),
      brand: BMW,
    });
    fixture.componentRef.setInput('brand', TESLA);
    await settle(fixture);
    const lamp = host.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(text(lamp)).toBe('Nu primește Tesla');
  });

  it('switches the note between clipped and whole when the mode changes', async () => {
    const note = 'x'.repeat(140);
    const { fixture, host } = await render({
      answer: answer({ brandNote: note, worksOn: [BMW] }),
      mode: 'card',
    });
    expect(host.querySelector('.note')?.classList.contains('card')).toBe(true);
    fixture.componentRef.setInput('mode', 'profile');
    await settle(fixture);
    expect(host.querySelector('.note')?.classList.contains('card')).toBe(false);
    expect(text(host.querySelector('.note'))).toBe(note);
  });

  it('keeps a 140-character note whole in the page in card mode', async () => {
    const note = `${'ab '.repeat(46)}ab`;
    const { host } = await render({
      answer: answer({ brandNote: note, worksOn: [BMW] }),
      mode: 'card',
    });
    expect(text(host.querySelector('.note'))).toBe(note);
  });

  it('exposes the full note to assistive technology on a card', async () => {
    const note = 'Fără mașini 100% electrice și nimic fabricat înainte de 2005';
    const { host } = await render({
      answer: answer({ brandNote: note, worksOn: [BMW] }),
      mode: 'card',
    });
    const el = host.querySelector('.note') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).not.toBe('true');
    expect(el.textContent).toContain(note);
  });

  it('shows a note even when both lists are empty', async () => {
    const { host } = await render({
      answer: answer({ brandNote: 'Doar pe programare' }),
      mode: 'profile',
    });
    expect(text(host.querySelector('.note'))).toBe('Doar pe programare');
    expect(lines(host)).toEqual([
      'Lucrează pe: nimic ales încă',
      'Nu primește: nimic ales încă',
    ]);
  });

  it('shows no note element for an empty-string note', async () => {
    const { host } = await render({
      answer: answer({ brandNote: '', worksOn: [BMW] }),
    });
    expect(host.querySelector('.note')).toBeNull();
  });

  it('changes the labels but keeps brand names, phrase and note as written when the language switches', async () => {
    const { fixture, host } = await render({
      answer: answer({
        brandNote: 'Fără electrice',
        refusalPhrase: 'orice nu e BMW',
        worksOn: [BMW],
      }),
      brand: BMW,
    });
    await TestBed.inject(I18n).use('en');
    await settle(fixture);
    expect(text(host.querySelector('mf-lamp'))).toBe('Works on BMW');
    expect(lines(host)).toEqual([
      'Works on: BMW',
      'Does not take: orice nu e BMW',
    ]);
    expect(text(host.querySelector('.note'))).toBe('Fără electrice');
  });

  it('renders every brand name of a ten-thousand-brand list joined by a comma and a space', async () => {
    const many = Array.from({ length: 10000 }, (_, i) => ref(`B${i}`, i + 100));
    const { host } = await render({ answer: answer({ worksOn: many }) });
    expect(lines(host)[0]).toBe(
      `Lucrează pe: ${many.map((b) => b.name).join(', ')}`,
    );
  });

  it('writes a brand name containing a comma without changing it', async () => {
    const odd = { ...BMW, name: 'Rolls, Royce' };
    const { host } = await render({
      answer: answer({ worksOn: [odd, AUDI] }),
    });
    expect(lines(host)).toEqual(['Lucrează pe: Rolls, Royce, Audi']);
  });

  it('keeps unicode brand names intact', async () => {
    const skoda = { ...BMW, id: DACIA.id, name: 'Škoda' };
    const { host } = await render({
      answer: answer({ worksOn: [skoda] }),
      brand: skoda,
    });
    expect(text(host.querySelector('mf-lamp'))).toBe('Lucrează pe Škoda');
  });

  it('does not mutate the answer it is given', async () => {
    const given = answer({ doesNotTake: [TESLA, DACIA], worksOn: [BMW, AUDI] });
    const snapshot = JSON.parse(JSON.stringify(given));
    await render({ answer: given, brand: BMW });
    expect(given).toEqual(snapshot);
  });

  it('gives the lamp a label that carries the meaning and marks the lamp itself as decorative', async () => {
    const { host } = await render({
      answer: answer({ worksOn: [BMW] }),
      brand: BMW,
    });
    const lamp = host.querySelector('mf-lamp') as HTMLElement;
    expect(lamp.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(lamp.textContent).toContain('Lucrează pe BMW');
  });

  it('adds no live region of its own', async () => {
    const { fixture, host } = await render({
      answer: answer({ doesNotTake: [BMW] }),
      brand: BMW,
    });
    fixture.componentRef.setInput('answer', answer({ worksOn: [BMW] }));
    await settle(fixture);
    expect(
      host.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
    ).toHaveLength(0);
  });
});
