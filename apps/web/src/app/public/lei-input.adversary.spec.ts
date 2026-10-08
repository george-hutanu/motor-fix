import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { LeiInput, leiDigits } from './lei-input';

describe('leiDigits under hostile input', () => {
  it.each([
    ['-5', '5'],
    ['1,5', '15'],
    ['١٢٣', ''],
    ['１２３', ''],
    ['12e3', '123'],
    ['0x1F', '01'.replace(/^0/, '')],
    ['0', '0'],
    ['000', '0'],
    ['0001200', '1200'],
    ['\n 4 5\t0 ', '450'],
    ['😀7😀', '7'],
  ])('keeps the digits of %j as %j', (typed, digits) => {
    expect(leiDigits(typed)).toBe(digits);
  });

  it('answers the same for the same text twice', () => {
    expect(leiDigits(leiDigits('1.200 lei'))).toBe(leiDigits('1.200 lei'));
  });

  it('keeps a very long paste within what converts to bani', () => {
    const digits = leiDigits('9'.repeat(10_000));

    expect(digits).toMatch(/^9+$/);
    expect(Number.isSafeInteger(Number(digits) * 100)).toBe(true);
  });
});

@Component({
  imports: [LeiInput],
  template: `<input [(mfLei)]="bani" />`,
})
class Host {
  readonly bani = signal<number | undefined>(undefined);
}

function open() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const input = fixture.nativeElement.querySelector(
    'input',
  ) as HTMLInputElement;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { fixture, input, type };
}

describe('the lei input under hostile input', () => {
  it('holds a safe integer of bani after a paste of twenty digits', () => {
    const { fixture, type } = open();

    type('99999999999999999999');

    expect(Number.isSafeInteger(fixture.componentInstance.bani())).toBe(true);
  });

  it('holds a safe integer of bani after a paste of four hundred digits', () => {
    const { fixture, type } = open();

    type('7'.repeat(400));

    expect(Number.isSafeInteger(fixture.componentInstance.bani())).toBe(true);
  });

  it('holds zero bani, not nothing, for a typed 0', () => {
    const { fixture, input, type } = open();

    type('0');

    expect(fixture.componentInstance.bani()).toBe(0);
    expect(input.value).toBe('0');
  });

  it('holds nothing, never 0, once the owner clears the field', () => {
    const { fixture, input, type } = open();
    type('12');

    type('');

    expect(fixture.componentInstance.bani()).toBeUndefined();
    expect(input.value).toBe('');
  });

  it('holds nothing for text without a digit and empties the field', () => {
    const { fixture, input, type } = open();

    type('lei');

    expect(fixture.componentInstance.bani()).toBeUndefined();
    expect(input.value).toBe('');
  });

  it('strips a minus sign instead of holding a negative price', () => {
    const { fixture, input, type } = open();

    type('-250');

    expect(fixture.componentInstance.bani()).toBe(25_000);
    expect(input.value).toBe('250');
  });

  it('shows the field empty when the draft clears the value', () => {
    const { fixture, input, type } = open();
    type('12');

    fixture.componentInstance.bani.set(undefined);
    fixture.detectChanges();

    expect(input.value).toBe('');
  });

  it('shows whole lei for bani restored from a draft', () => {
    const { fixture, input } = open();

    fixture.componentInstance.bani.set(120_000);
    fixture.detectChanges();

    expect(input.value).toBe('1200');
  });

  it('shows 0 for restored zero bani, not an empty field', () => {
    const { fixture, input } = open();

    fixture.componentInstance.bani.set(0);
    fixture.detectChanges();

    expect(input.value).toBe('0');
  });

  it('keeps the same bani when the same text is typed twice', () => {
    const { fixture, type } = open();

    type('1.200');
    const first = fixture.componentInstance.bani();
    type('1.200');

    expect(fixture.componentInstance.bani()).toBe(first);
  });
});
