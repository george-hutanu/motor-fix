import { TestBed } from '@angular/core/testing';
import type { FieldProblem } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { MissingSummary, type SummaryState } from './missing-summary';

const problem = (field: string, code = 'required'): FieldProblem => ({
  code,
  field,
});

async function open(
  errors: FieldProblem[],
  state: SummaryState,
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(MissingSummary);
  fixture.componentRef.setInput('errors', errors);
  fixture.componentRef.setInput('state', state);
  const asked: string[] = [];
  fixture.componentInstance.goTo.subscribe((field) => asked.push(field));
  fixture.detectChanges();
  await fixture.whenStable();
  const summary = fixture.nativeElement as HTMLElement;
  return { asked, fixture, summary };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => problem(`steps.4.mechanics[${i}].name`));

describe('MissingSummary', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 115-FR-008 115-FR-012
  it.each([
    [1, 'Mai lipsește: 1 lucru'],
    [3, 'Mai lipsesc: 3 lucruri'],
    [19, 'Mai lipsesc: 19 lucruri'],
    [20, 'Mai lipsesc: 20 de lucruri'],
  ])('counts %i missing things in Romanian', async (n, title) => {
    const { summary } = await open(many(n), 'missing');

    expect(text(summary.querySelector('h2'))).toBe(title);
  });

  // @traces 115-FR-008
  it('counts only the things it lists', async () => {
    const { summary } = await open(
      [problem('steps.1.phone'), problem('steps.9.new')],
      'missing',
    );

    expect(text(summary.querySelector('h2'))).toBe('Mai lipsește: 1 lucru');
    expect(summary.querySelectorAll('button')).toHaveLength(1);
  });

  // @traces 115-FR-012
  it('counts in English', async () => {
    const { summary } = await open(many(2), 'missing', 'en');

    expect(text(summary.querySelector('h2'))).toBe('Still missing: 2 things');
  });

  // @traces 115-FR-008
  it('groups the items by step, in step order, and names each field', async () => {
    const { summary } = await open(
      [
        problem('files'),
        problem('steps.1.phone'),
        problem('steps.6.cui'),
        problem('steps.5.place.address'),
      ],
      'missing',
    );

    const groups = [...summary.querySelectorAll('[data-step]')].map((g) => [
      text(g.querySelector('h3')),
      [...g.querySelectorAll('button')].map(text),
    ]);
    expect(groups).toEqual([
      ['1 Service‑ul', ['Adaugă un număr de telefon']],
      [
        '5 Fotografii și adresă',
        ['Adaugă cel puțin o fotografie', expect.any(String)],
      ],
      ['6 Verificare', ['Scrie CUI‑ul firmei']],
    ]);
  });

  // @traces 115-FR-008 115-FR-013
  it('makes each item a button that asks to go to its field', async () => {
    const { asked, summary } = await open(
      [problem('steps.1.phone'), problem('files')],
      'missing',
    );
    const buttons = [...summary.querySelectorAll('button')];

    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    buttons[1]?.click();
    expect(asked).toEqual(['files']);
  });

  // @traces 115-FR-009 116-FR-001
  it('confirms a complete listing with the stages, Trimis lit, and says when a check failed', async () => {
    const complete = await open([], 'complete');
    expect(text(complete.summary.querySelector('h2.complete'))).toBe(
      'Am primit cererea. O verificăm în 1–2 zile lucrătoare.',
    );
    const stages = [
      ...complete.summary.querySelectorAll('mf-verification-stages ol > li'),
    ];
    expect(stages.map((li) => text(li.querySelector('.name')))).toEqual([
      'Trimis',
      'În verificare',
      'Aprobat, pe hartă',
    ]);
    expect(stages[0]?.getAttribute('aria-current')).toBe('step');
    expect(text(complete.summary.querySelector('.off-map'))).toMatch(
      /^Profilul nu apare pe hartă până la aprobare\./,
    );
    expect(text(complete.summary).toLowerCase()).not.toContain('publică');

    const failed = await open([], 'failed');
    expect(text(failed.summary)).toBe(
      'Nu am putut verifica. Încearcă din nou.',
    );
  });

  // @traces 115-FR-008
  it('shows nothing until asked, but keeps its polite live region', async () => {
    const { summary } = await open([problem('files')], null);
    const region = summary.querySelector('[aria-live="polite"]');

    expect(region).not.toBeNull();
    expect(region?.getAttribute('tabindex')).toBe('-1');
    expect(text(summary)).toBe('');
  });

  // @traces 115-FR-003
  it('names the registered seat for a mobile mechanic', async () => {
    const { fixture, summary } = await open(
      [problem('steps.5.place.address')],
      'missing',
    );
    const before = text(summary.querySelector('button'));
    fixture.componentRef.setInput('mobile', true);
    fixture.detectChanges();

    expect(text(summary.querySelector('button'))).not.toBe(before);
    expect(text(summary.querySelector('button'))).toBe(
      TestBed.inject(I18n).t('public.listing.check.seatAddressNeeded'),
    );
  });

  // @traces 1359-FR-001
  it('offers the survey under the complete notice and asks for it on a press', async () => {
    const { fixture, summary } = await open([], 'complete');
    let asked = 0;
    fixture.componentInstance.tellUs.subscribe(() => asked++);
    const button = summary.querySelector<HTMLButtonElement>('button.tell-us');

    expect(text(button)).toContain('SPUNE‑NE CUM LUCREZI');
    button?.click();
    expect(asked).toBe(1);
  });

  // @traces 1359-FR-001 116-FR-001
  it('names the survey button in English', async () => {
    const { summary } = await open([], 'complete', 'en');

    expect(text(summary.querySelector('h2.complete'))).toBe(
      'Request received. We check it within 1–2 working days.',
    );
    expect(text(summary).toLowerCase()).not.toContain('publish');

    expect(text(summary.querySelector('button.tell-us'))).toContain(
      'TELL US HOW YOU WORK',
    );
  });

  // @traces 1359-FR-001
  it.each(['missing', 'failed', null] as const)(
    'offers no survey when the state is %s',
    async (state) => {
      const { summary } = await open(
        state === 'missing' ? [problem('steps.1.phone')] : [],
        state,
      );

      expect(summary.querySelector('button.tell-us')).toBeNull();
    },
  );
});
