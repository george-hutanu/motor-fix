import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCUMENT } from '@angular/common';
import { computed, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlatformService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { provideVoiceRead, type Slot, Voice } from './voice';

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
  document.documentElement.removeAttribute('data-home');
  document.documentElement.removeAttribute('data-voice-new');
  delete (window as { mfCopyVoice?: unknown }).mfCopyVoice;
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

  // The server's document (domino) has attributes but no dataset.
  it.each([
    [null, 1],
    ['3', 3],
  ])(
    'reads the mark %p on a document without dataset as voice %p',
    (mark, n) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DOCUMENT,
            useValue: { documentElement: { getAttribute: () => mark } },
          },
        ],
      });

      expect(TestBed.inject(Voice).voice).toBe(n);
    },
  );
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
    expect(voiceOf('1').feat2).toBe('public.voice.v1.feat2');
    expect(voiceOf('2').feat2).toBe('public.voice.v2.feat2');
    expect(voiceOf('3').feat2).toBeNull();
    expect(voiceOf('4').feat2).toBe('public.voice.v4.feat2');
    expect(voiceOf('5').feat2).toBeNull();
  });

  it('has a second benefits line exactly where the translations carry one', () => {
    for (const language of ['ro', 'en']) {
      const texts = JSON.parse(
        readFileSync(
          join(
            __dirname,
            `../../../../../libs/i18n/src/public/${language}.json`,
          ),
          'utf8',
        ),
      );
      for (const n of [1, 2, 3, 4, 5])
        expect(voiceOf(String(n)).feat2 !== null).toBe(
          'feat2' in texts.voice[`v${n}`],
        );
    }
  });

  it('has a text in Romanian and in English for every slot of every voice', async () => {
    for (const language of ['ro', 'en'] as const)
      for (const n of ['1', '2', '3', '4', '5']) {
        const { i18n, voice } = await texts(language, n);
        const keys = [...SLOTS.map((s) => voice.key(s)), voice.feat2];
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

type Settings = { enabled: number[]; pinned: number | null };

function withSettings(mark: string, answers: (Settings | Error)[]) {
  document.documentElement.dataset['voice'] = mark;
  // A stand-in for the page head: the pin, else the first voice on.
  (window as { mfCopyVoice?: unknown }).mfCopyVoice = (s: Settings) =>
    s.pinned ?? s.enabled[0];
  TestBed.resetTestingModule();
  const pending: ((answer: Settings | Error) => void)[] = [];
  const settings = jest.fn(
    () =>
      new Promise<Settings>((resolve, reject) => {
        const settle = (answer: Settings | Error) =>
          answer instanceof Error ? reject(answer) : resolve(answer);
        const next = answers.shift();
        if (next) settle(next);
        else pending.push(settle);
      }),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: PlatformService,
        useValue: { publicCopyVoicesControllerSettings: settings },
      },
    ],
  });
  return { pending, settings, voice: TestBed.inject(Voice) };
}

// @traces 010-FR-011
describe('the settings read while the visit runs', () => {
  it('moves every text to the voice the page head picks when the visit voice is off', () => {
    const hand = jest.fn(() => 2);
    (window as { mfCopyVoice?: unknown }).mfCopyVoice = hand;
    const voice = voiceOf('4');
    const headline = computed(() => voice.copy.headline);
    expect(headline()).toBe('public.voice.v4.headline');

    voice.apply({ enabled: [1, 2, 3], pinned: null });

    expect(hand).toHaveBeenCalledWith({ enabled: [1, 2, 3], pinned: null });
    expect(voice.voice).toBe(2);
    expect(headline()).toBe('public.voice.v2.headline');
    expect(voice.key('no')).toBe('public.voice.v2.no');
    expect(voice.feat2).toBe('public.voice.v2.feat2');
  });

  it('keeps the voice when the page head did not run', () => {
    const voice = voiceOf('3');

    voice.apply({ enabled: [1, 5], pinned: 5 });

    expect(voice.voice).toBe(3);
  });

  it('reads the settings, past every cache when given a time', async () => {
    const { settings, voice } = withSettings('1', [
      { enabled: [2], pinned: 2 },
    ]);

    await voice.read('2026-10-22T10:00:00.000Z');

    expect(settings).toHaveBeenCalledWith({ at: '2026-10-22T10:00:00.000Z' });
    expect(voice.voice).toBe(2);
  });

  it('acts on the newest read even when an older one answers last', async () => {
    const { pending, voice } = withSettings('1', []);
    const older = voice.read();
    const newer = voice.read('x');

    pending[1]({ enabled: [3], pinned: null });
    pending[0]({ enabled: [4], pinned: null });
    await Promise.all([older, newer]);

    expect(voice.voice).toBe(3);
  });

  it('keeps the voice when the read fails', async () => {
    const { voice } = withSettings('4', [new Error('offline')]);

    await voice.read();

    expect(voice.voice).toBe(4);
  });
});

// @traces 010-FR-011
describe('the settings read at boot', () => {
  const boot = (platform: string) => {
    TestBed.resetTestingModule();
    const settings = jest.fn(async () => ({ enabled: [1], pinned: null }));
    TestBed.configureTestingModule({
      providers: [
        provideVoiceRead(),
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: PlatformService,
          useValue: { publicCopyVoicesControllerSettings: settings },
        },
      ],
    });
    TestBed.inject(Voice);
    return settings;
  };

  it('reads them once in the browser, which a cache may answer', () => {
    const settings = boot('browser');

    expect(settings).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledWith(undefined);
  });

  it('reads none on the server', () => {
    expect(boot('server')).not.toHaveBeenCalled();
  });
});

function marked(marks: string[]) {
  for (const mark of marks) document.documentElement.setAttribute(mark, '');
  TestBed.resetTestingModule();
  return TestBed.inject(Voice);
}

// @traces 009-FR-001 009-FR-011
describe('how the page was loaded', () => {
  it('came from Home only when the page head marked it so', () => {
    expect(marked(['data-home']).fromHome).toBe(true);
    document.documentElement.removeAttribute('data-home');
    expect(marked(['data-voice-new']).fromHome).toBe(false);
  });

  it('took its voice only when the page head marked it so', () => {
    expect(marked(['data-home', 'data-voice-new']).taken).toBe(true);
    document.documentElement.removeAttribute('data-voice-new');
    expect(marked(['data-home']).taken).toBe(false);
  });

  it('is neither with no mark', () => {
    const voice = marked([]);

    expect(voice.fromHome).toBe(false);
    expect(voice.taken).toBe(false);
  });

  it('keeps what it read at the start, whatever the page says later', () => {
    const voice = marked([]);
    document.documentElement.setAttribute('data-home', '');
    document.documentElement.setAttribute('data-voice-new', '');

    expect(voice.fromHome).toBe(false);
    expect(voice.taken).toBe(false);
  });

  it('reads the marks through getAttribute, once, on a document without dataset', () => {
    const getAttribute = jest.fn((name: string) =>
      name === 'data-voice' ? '2' : '',
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: { documentElement: { getAttribute } } },
      ],
    });
    const voice = TestBed.inject(Voice);
    const calls = getAttribute.mock.calls.length;

    expect(voice.fromHome).toBe(true);
    expect(voice.taken).toBe(true);
    expect(getAttribute).toHaveBeenCalledWith('data-home');
    expect(getAttribute).toHaveBeenCalledWith('data-voice-new');
    expect(getAttribute.mock.calls.length).toBe(calls);
  });

  it('is neither on the server render, which carries no mark', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: { documentElement: { getAttribute: () => null } },
        },
      ],
    });
    const voice = TestBed.inject(Voice);

    expect(voice.fromHome).toBe(false);
    expect(voice.taken).toBe(false);
  });
});
