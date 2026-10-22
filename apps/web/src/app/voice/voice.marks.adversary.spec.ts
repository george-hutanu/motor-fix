import { TestBed } from '@angular/core/testing';

import { Voice } from './voice';

const root = () => document.documentElement;

afterEach(() => {
  for (const name of ['data-voice', 'data-home', 'data-voice-new'])
    root().removeAttribute(name);
  TestBed.resetTestingModule();
});

// @traces 009-FR-001 009-FR-006
describe('the marks the app reads from the page', () => {
  it('reads Home and a take from the document, and the voice with them', () => {
    root().setAttribute('data-voice', '4');
    root().setAttribute('data-home', '');
    root().setAttribute('data-voice-new', '');

    const voice = TestBed.inject(Voice);

    expect(voice.voice).toBe(4);
    expect(voice.fromHome).toBe(true);
    expect(voice.taken).toBe(true);
  });

  it('reads no Home and no take from a bare document', () => {
    const voice = TestBed.inject(Voice);

    expect(voice.fromHome).toBe(false);
    expect(voice.taken).toBe(false);
    expect(voice.voice).toBe(1);
  });

  it('reads a Home load that kept its voice as Home without a take', () => {
    root().setAttribute('data-voice', '2');
    root().setAttribute('data-home', '');

    const voice = TestBed.inject(Voice);

    expect(voice.fromHome).toBe(true);
    expect(voice.taken).toBe(false);
  });

  it('reads a take mark that carries a value as a take', () => {
    root().setAttribute('data-voice', '2');
    root().setAttribute('data-home', 'true');
    root().setAttribute('data-voice-new', 'false');

    const voice = TestBed.inject(Voice);

    expect(voice.fromHome).toBe(true);
    expect(voice.taken).toBe(true);
  });

  it.each(['0', '6', 'x', '', '3.5', '-1', ' 3'])(
    'falls back to voice 1 for the mark %p',
    (mark) => {
      root().setAttribute('data-voice', mark);

      expect(TestBed.inject(Voice).voice).toBe(1);
    },
  );

  it('does not follow later changes of the marks', () => {
    root().setAttribute('data-voice', '3');
    root().setAttribute('data-home', '');
    const voice = TestBed.inject(Voice);

    root().setAttribute('data-voice', '5');
    root().removeAttribute('data-home');
    root().setAttribute('data-voice-new', '');

    expect(voice.voice).toBe(3);
    expect(voice.fromHome).toBe(true);
    expect(voice.taken).toBe(false);
  });
});
