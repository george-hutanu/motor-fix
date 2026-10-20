import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { SurveySection } from '@motor-fix/contracts/listing-survey';
import { I18n } from '@motor-fix/i18n';

import { SignupSurvey } from './signup-survey';

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(value: SurveySection = {}, language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(SignupSurvey);
  const changes: SurveySection[] = [];
  let backs = 0;
  let finishes = 0;
  // The page feeds every change back, as the draft keeper does.
  fixture.componentInstance.valueChange.subscribe((next) => {
    changes.push(next);
    fixture.componentRef.setInput('value', next);
  });
  fixture.componentInstance.back.subscribe(() => backs++);
  fixture.componentInstance.finish.subscribe(() => finishes++);
  fixture.componentRef.setInput('value', value);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    backs: () => backs,
    changes,
    finishes: () => finishes,
    fixture,
    host,
    i18n,
  };
}

async function settle(fixture: ComponentFixture<SignupSurvey>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const heading = (host: HTMLElement) => host.querySelector('h1');
const eyebrow = (host: HTMLElement) => text(host.querySelector('.eyebrow'));
const counter = (host: HTMLElement) => text(host.querySelector('.counter'));
const forward = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button.forward') as HTMLButtonElement;
const backButton = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button.back') as HTMLButtonElement;
const radios = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]'),
];
const outcome = (host: HTMLElement) => text(host.querySelector('.outcome'));

async function press(
  fixture: ComponentFixture<SignupSurvey>,
  button: HTMLElement,
) {
  button.click();
  await settle(fixture);
}

async function pick(
  fixture: ComponentFixture<SignupSurvey>,
  host: HTMLElement,
  label: string,
) {
  const option = radios(host).find((radio) => text(radio) === label);
  if (!option) throw new Error(`no answer ${label}`);
  await press(fixture, option);
}

describe('SignupSurvey', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 1359-FR-003
  it('opens on the intro with what it sets up and the start button', async () => {
    const { host } = await open();

    expect(eyebrow(host)).toBe('ÎNAINTE SĂ CREEZI CONTUL');
    expect(text(heading(host))).toBe('Spune‑ne cum lucrezi');
    expect(text(host.querySelector('.lead'))).toBe(
      'Cinci întrebări scurte. Pornim service‑ul tău doar cu funcțiile pe care le folosești, ca ecranele să rămână simple.',
    );
    expect([...host.querySelectorAll('.sets li')].map(text)).toEqual([
      'Echipă și mecanici',
      'Program pe elevatoare',
      'Poze și video live din atelier',
      'Foi de lucru pe WhatsApp sau PDF',
    ]);
    expect(text(host.querySelector('.note'))).toBe(
      'Poți schimba oricând răspunsurile din Setări › Funcții.',
    );
    expect(counter(host)).toBe('5 ÎNTREBĂRI');
    expect(text(forward(host))).toContain('ÎNCEPE');
    expect(forward(host).disabled).toBe(false);
  });

  // @traces 1359-FR-002 1359-FR-003
  it.each([
    [
      1,
      'ECHIPĂ',
      'Câți mecanici lucrează la tine?',
      ['Doar eu', '1–2 mecanici', '3–5 mecanici', '6 sau mai mulți'],
    ],
    [
      2,
      'ELEVATOARE',
      'Câte elevatoare ai?',
      ['Niciunul', 'Unul', '2–3', '4 sau mai multe'],
    ],
    [
      3,
      'POZE ȘI VIDEO',
      'Vrei să le trimiți clienților poze și video live din atelier?',
      ['Da', 'Nu, deocamdată'],
    ],
    [
      4,
      'FOI DE LUCRU',
      'Vrei ca fiecare mecanic să primească foaia de lucru dimineața?',
      ['Da', 'Nu, deocamdată'],
    ],
    [
      5,
      'ULTIMA ÎNTREBARE',
      'Cum ai aflat de MotorFix?',
      [
        'Căutare pe Google',
        'Recomandare de la un client',
        'Alt service sau mecanic',
        'Facebook sau Instagram',
        'Altceva',
      ],
    ],
  ])(
    'shows question %i with its eyebrow, text, answers and counter',
    async (n, kicker, question, answers) => {
      const value: SurveySection = [
        { mechanicsCount: '0' },
        { liftsCount: '0' },
        { wantsLiveMedia: true },
        { wantsDaySheets: false },
      ]
        .slice(0, n - 1)
        .reduce((all, one) => Object.assign(all, one), {});
      const { fixture, host } = await open(value);
      if (n === 1) await press(fixture, forward(host));

      expect(eyebrow(host)).toBe(kicker);
      expect(text(heading(host))).toBe(question);
      expect(radios(host).map(text)).toEqual(answers);
      expect(counter(host)).toBe(`ÎNTREBAREA ${n} / 5`);
      expect(host.querySelectorAll('.segments .done')).toHaveLength(n - 1);
      expect(host.querySelectorAll('.segments > *')).toHaveLength(5);
    },
  );

  // @traces 1359-FR-004
  it('keeps the forward button disabled until an answer is picked', async () => {
    const { changes, fixture, host } = await open();
    await press(fixture, forward(host));

    expect(text(forward(host))).toContain('CONTINUĂ');
    expect(forward(host).disabled).toBe(true);
    await pick(fixture, host, 'Doar eu');

    expect(changes).toEqual([{ mechanicsCount: '0' }]);
    expect(forward(host).disabled).toBe(false);
  });

  // @traces 1359-FR-004
  it('offers the answers as one radio group named by the question', async () => {
    const { fixture, host } = await open({ mechanicsCount: '3-5' });
    await press(fixture, backButton(host));
    const group = host.querySelector('[role="radiogroup"]') as HTMLElement;

    expect(group.getAttribute('aria-labelledby')).toBe(heading(host)?.id);
    expect(radios(host).map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(radios(host).map((r) => r.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
      '-1',
    ]);
  });

  // @traces 1359-FR-004
  it('lets the first answer take the tab stop while none is picked', async () => {
    const { fixture, host } = await open();
    await press(fixture, forward(host));

    expect(radios(host).map((r) => r.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
    ]);
  });

  // @traces 1359-FR-004
  it('moves and picks with the arrow keys, wrapping at the ends', async () => {
    const { changes, fixture, host } = await open({ mechanicsCount: '0' });
    const key = async (name: string) => {
      const checked = host.querySelector(
        '[role="radio"][aria-checked="true"]',
      ) as HTMLElement;
      checked.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: name }),
      );
      await settle(fixture);
    };
    await pick(fixture, host, 'Niciunul');

    await key('ArrowRight');
    expect(changes.at(-1)).toEqual({ liftsCount: '1', mechanicsCount: '0' });
    expect(document.activeElement).toBe(radios(host)[1]);
    await key('ArrowDown');
    expect(changes.at(-1)?.liftsCount).toBe('2-3');
    await key('ArrowUp');
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect(changes.at(-1)?.liftsCount).toBe('4+');
    expect(document.activeElement).toBe(radios(host)[3]);
  });

  // @traces 1359-FR-005
  it.each([
    [{}, 'Doar eu', 'Echipă și mecanici', 'Oprit'],
    [{}, '1–2 mecanici', 'Echipă și mecanici', 'Pornit'],
    [{ mechanicsCount: '0' }, 'Niciunul', 'Program pe elevatoare', 'Oprit'],
    [
      { mechanicsCount: '0' },
      '4 sau mai multe',
      'Program pe elevatoare',
      'Pornit',
    ],
    [
      { liftsCount: '1', mechanicsCount: '0' },
      'Da',
      'Poze și video live',
      'Pornit',
    ],
    [
      { liftsCount: '1', mechanicsCount: '0' },
      'Nu, deocamdată',
      'Poze și video live',
      'Oprit',
    ],
    [
      { liftsCount: '1', mechanicsCount: '0', wantsLiveMedia: true },
      'Da',
      'Foi de lucru',
      'Pornit',
    ],
    [
      { liftsCount: '1', mechanicsCount: '0', wantsLiveMedia: true },
      'Nu, deocamdată',
      'Foi de lucru',
      'Oprit',
    ],
  ] as [SurveySection, string, string, string][])(
    'reads the feature line from the answer %#',
    async (value, answer, feature, state) => {
      const { fixture, host } = await open(value);
      if (Object.keys(value).length === 0) await press(fixture, forward(host));

      expect(outcome(host)).toBe(`${feature} Alege un răspuns`);
      await pick(fixture, host, answer);
      expect(outcome(host)).toBe(`${feature} ${state}`);
    },
  );

  // @traces 1359-FR-005
  it('shows a picture of the feature as markup and its example on each feature question', async () => {
    const examples: string[] = [];
    for (const value of [
      {},
      { mechanicsCount: '0' },
      { liftsCount: '0', mechanicsCount: '0' },
      { liftsCount: '0', mechanicsCount: '0', wantsLiveMedia: false },
    ] as SurveySection[]) {
      const { fixture, host } = await open(value);
      if (Object.keys(value).length === 0) await press(fixture, forward(host));
      const mockup = host.querySelector('.mockup') as HTMLElement;
      expect(mockup).not.toBeNull();
      expect(mockup.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('img')).toBeNull();
      examples.push(text(host.querySelector('.example')));
      TestBed.resetTestingModule();
    }

    expect(examples.every((example) => example.startsWith('EXEMPLU'))).toBe(
      true,
    );
    expect(examples[0]).toContain('Atelier Dinamo are patru mecanici.');
    expect(examples[1]).toContain('Cu trei elevatoare vezi ziua pe un orar');
    expect(examples[2]).toContain('Mecanicul fotografiază plăcuțele uzate');
    expect(examples[3]).toContain('La 7:30, fiecare mecanic primește');
  });

  // @traces 1359-FR-003
  it('asks the source under its note, with no feature line, and offers the summary', async () => {
    const { fixture, host } = await open({
      liftsCount: '0',
      mechanicsCount: '0',
      wantsDaySheets: false,
      wantsLiveMedia: true,
    });

    expect(text(host.querySelector('.note'))).toBe(
      'Doar ca să știm cum ajung service‑urile la noi. Nu schimbă nimic în contul tău.',
    );
    expect(host.querySelector('.outcome')).toBeNull();
    expect(host.querySelector('.mockup')).toBeNull();
    expect(text(forward(host))).toContain('VEZI REZUMATUL');
    expect(forward(host).disabled).toBe(true);
    await pick(fixture, host, 'Căutare pe Google');
    expect(forward(host).disabled).toBe(false);
  });

  // @traces 1359-FR-007 1359-FR-006
  it('sums up the five starting features, day sheets and WhatsApp apart', async () => {
    const { fixture, finishes, host } = await open({
      foundVia: 'google',
      liftsCount: '0',
      mechanicsCount: '0',
      wantsDaySheets: false,
      wantsLiveMedia: true,
    });

    expect(eyebrow(host)).toBe('REZUMAT');
    expect(counter(host)).toBe('REZUMAT');
    expect(text(heading(host))).toBe('Pornim service‑ul tău cu:');
    expect([...host.querySelectorAll('.features li')].map(text)).toEqual([
      'Echipă și mecanici Oprit',
      'Program pe elevatoare Oprit',
      'Poze și video live Pornit',
      'Foi de lucru Oprit',
      'WhatsApp Pornit',
    ]);
    expect(text(host.querySelector('.always'))).toBe(
      'Mereu pornite: cereri de ofertă, rezervări, recenzii și profilul public.',
    );
    expect(text(host.querySelector('.change'))).toBe(
      'Poți schimba oricând din Setări › Funcții. O funcție oprită dispare din meniuri și ecrane.',
    );
    expect(text(forward(host))).toContain('CREEAZĂ CONTUL');
    await press(fixture, forward(host));
    expect(finishes()).toBe(1);
  });

  // @traces 1359-FR-011
  it('holds the create button while the answers are saved, and tells how it went without moving focus', async () => {
    const { fixture, host } = await open({
      foundVia: 'other',
      liftsCount: '1',
      mechanicsCount: '1-2',
      wantsDaySheets: true,
      wantsLiveMedia: true,
    });
    forward(host).focus();
    const status = host.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(text(status)).toBe('');

    fixture.componentRef.setInput('busy', true);
    await settle(fixture);
    expect(forward(host).disabled).toBe(true);

    fixture.componentRef.setInput('busy', false);
    fixture.componentRef.setInput('notice', 'saved');
    await settle(fixture);
    expect(text(host.querySelector('[role="status"]'))).toBe(
      'Răspunsurile tale sunt salvate.',
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(forward(host));

    fixture.componentRef.setInput('notice', 'failed');
    await settle(fixture);
    expect(text(host.querySelector('[role="alert"]'))).toBe(
      'Nu am putut salva. Încearcă din nou.',
    );
    expect(text(host.querySelector('[role="status"]'))).toBe('');
    expect(document.activeElement).toBe(forward(host));
  });

  // @traces 1359-FR-002
  it('goes back one screen at a time, keeping the answers, and from the intro asks for the form', async () => {
    const { backs, changes, fixture, host } = await open({
      liftsCount: '2-3',
      mechanicsCount: '6+',
    });
    expect(text(heading(host))).toBe(
      'Vrei să le trimiți clienților poze și video live din atelier?',
    );

    await press(fixture, backButton(host));
    expect(text(heading(host))).toBe('Câte elevatoare ai?');
    expect(
      text(host.querySelector('[role="radio"][aria-checked="true"]')),
    ).toBe('2–3');
    expect(forward(host).disabled).toBe(false);
    await press(fixture, backButton(host));
    await press(fixture, backButton(host));
    expect(text(heading(host))).toBe('Spune‑ne cum lucrezi');
    expect(backs()).toBe(0);

    await press(fixture, backButton(host));
    expect(backs()).toBe(1);
    expect(changes).toEqual([]);
    expect(backButton(host).getAttribute('aria-label')).toBe('Înapoi');
  });

  // @traces 1359-FR-015
  it('moves focus to the new heading on a forward or back press', async () => {
    const { fixture, host } = await open({ mechanicsCount: '0' });

    await press(fixture, backButton(host));
    expect(document.activeElement).toBe(heading(host));
    expect(heading(host)?.getAttribute('tabindex')).toBe('-1');
    await press(fixture, forward(host));
    expect(document.activeElement).toBe(heading(host));
    expect(text(heading(host))).toBe('Câte elevatoare ai?');
  });

  // @traces 1359-FR-014 1359-FR-003
  it('reads in English, from the intro to the summary', async () => {
    const intro = await open({}, 'en');
    expect(text(heading(intro.host))).toBe('Tell us how you work');
    expect(text(forward(intro.host))).toContain('START');
    expect(counter(intro.host)).toBe('5 QUESTIONS');
    await press(intro.fixture, forward(intro.host));
    expect(radios(intro.host)[0] && text(radios(intro.host)[0])).toBe(
      'Just me',
    );
    expect(outcome(intro.host)).toBe('Team and mechanics Pick an answer');
    expect(counter(intro.host)).toBe('QUESTION 1 / 5');
    TestBed.resetTestingModule();

    const summary = await open(
      {
        foundVia: 'social',
        liftsCount: '4+',
        mechanicsCount: '0',
        wantsDaySheets: false,
        wantsLiveMedia: false,
      },
      'en',
    );
    expect(text(heading(summary.host))).toBe('Your garage starts with:');
    expect(text(forward(summary.host))).toContain('CREATE ACCOUNT');
    expect(
      [...summary.host.querySelectorAll('.features li')].map(text),
    ).toEqual([
      'Team and mechanics Off',
      'Schedule by lift On',
      'Live photos and video Off',
      'Day sheets Off',
      'WhatsApp On',
    ]);
  });

  // @traces 1359-FR-014
  it('switches language in place, keeping the screen and the answers', async () => {
    const { fixture, host, i18n } = await open({
      liftsCount: '1',
      mechanicsCount: '1-2',
    });
    await pick(fixture, host, 'Da');

    await i18n.use('en');
    await settle(fixture);

    expect(text(heading(host))).toBe(
      'Do you want to send customers photos and live video from the workshop?',
    );
    expect(
      text(host.querySelector('[role="radio"][aria-checked="true"]')),
    ).toBe('Yes');
    expect(outcome(host)).toBe('Live photos and video On');
  });

  // @traces 1359-FR-015
  it('pins the buttons on a phone and skips motion when asked to', () => {
    const css = readFileSync(join(__dirname, 'signup-survey.css'), 'utf8');

    expect(css).toMatch(/@media \(max-width: 767\.98px\)/);
    expect(css).toMatch(/position: sticky/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: (reduce|no-preference)\)/,
    );
  });
});
