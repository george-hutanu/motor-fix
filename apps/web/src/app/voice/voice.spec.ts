import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { type Slot, Voice } from './voice';

const SLOTS: Slot[] = [
  'eyebrow',
  'headline',
  'sub',
  'cta',
  'parts',
  'list',
  'feat',
  'garage',
  'no',
  'noLabel',
  'review',
];

function voiceOf(mark: string | null) {
  if (mark === null) delete document.documentElement.dataset['voice'];
  else document.documentElement.dataset['voice'] = mark;
  TestBed.resetTestingModule();
  return TestBed.inject(Voice);
}

afterEach(() => {
  delete document.documentElement.dataset['voice'];
});

// @traces 006-FR-006
describe('the visit voice', () => {
  it('is the voice the page was marked with', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(voiceOf(String(n)).voice).toBe(n);
  });

  it('is voice 1 when the page carries no mark or a mark that is no voice', () => {
    for (const mark of [null, '', '0', '6', '2.5', 'x', ' 3'])
      expect(voiceOf(mark).voice).toBe(1);
  });

  it('stays the voice read at the start, whatever the page says later', () => {
    const voice = voiceOf('4');
    document.documentElement.dataset['voice'] = '2';

    expect(voice.voice).toBe(4);
    expect(voice.key('headline')).toBe('public.voice.v4.headline');
  });
});

// @traces 006-FR-001
describe('the texts of each voice', () => {
  async function texts(language: 'ro' | 'en', mark: string) {
    const voice = voiceOf(mark);
    const i18n = TestBed.inject(I18n);
    await i18n.enter('public');
    await i18n.enter('driver');
    await i18n.use(language);
    return { i18n, voice };
  }

  it('names a key for each slot, the review title in the driver texts', () => {
    const voice = voiceOf('3');

    expect(voice.key('list')).toBe('public.voice.v3.list');
    expect(voice.key('noLabel')).toBe('public.voice.v3.noLabel');
    expect(voice.key('review')).toBe('driver.review.voices.v3');
  });

  it('has a second benefits line for voices 1, 2 and 4 only', () => {
    expect(voiceOf('1').key('feat2')).toBe('public.voice.v1.feat2');
    expect(voiceOf('2').key('feat2')).toBe('public.voice.v2.feat2');
    expect(voiceOf('3').key('feat2')).toBeNull();
    expect(voiceOf('4').key('feat2')).toBe('public.voice.v4.feat2');
    expect(voiceOf('5').key('feat2')).toBeNull();
  });

  it('has a text in Romanian and in English for every slot of every voice', async () => {
    for (const language of ['ro', 'en'] as const)
      for (const n of ['1', '2', '3', '4', '5']) {
        const { i18n, voice } = await texts(language, n);
        const keys = [...SLOTS.map((s) => voice.key(s)), voice.key('feat2')];
        for (const key of keys.filter((k) => k !== null)) {
          const text = i18n.t(key, { brand: 'BMW' });
          expect(text).not.toBe(key);
          expect(text.trim()).not.toBe('');
        }
      }
  });

  it('says the boards’ words', async () => {
    const two = await texts('ro', '2');
    expect(two.i18n.t(two.voice.key('list'), { brand: 'BMW' })).toBe(
      'Recomandați pentru BMW',
    );
    expect(two.i18n.t(two.voice.key('no'), { brand: 'BMW' })).toBe(
      'Nu lucrează pe BMW',
    );
    expect(two.i18n.t(two.voice.key('headline'), { brand: 'BMW' })).toBe(
      'Știm un mecanic bun pentru BMW.',
    );

    const four = await texts('ro', '4');
    expect(four.i18n.t(four.voice.key('headline'), { brand: 'BMW' })).toBe(
      'BMW merită mai mult decât „merge și așa”.',
    );
    expect(four.i18n.t(four.voice.key('cta'))).toBe('Găsește‑l acum');

    const five = await texts('ro', '5');
    expect(five.i18n.t(five.voice.key('review'))).toBe(
      'Prețul a fost cel promis?',
    );

    const one = await texts('en', '1');
    expect(one.i18n.t(one.voice.key('headline'), { brand: 'BMW' })).toBe(
      'Who’s tuned for your BMW?',
    );
    expect(one.i18n.t(one.voice.key('noLabel'))).toBe('Doesn’t take');

    const three = await texts('en', '3');
    expect(three.i18n.t(three.voice.key('headline'), { brand: 'BMW' })).toBe(
      'BMW. 3 garages. Top rating: 4.9.',
    );
  });
});
