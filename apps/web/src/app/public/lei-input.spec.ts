import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { LeiInput } from './lei-input';

// @traces 109-FR-005

@Component({
  imports: [LeiInput],
  template: `<input inputmode="numeric" [(mfLei)]="bani" />`,
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

describe('the lei input', () => {
  it.each([
    ['1200', '1200'],
    ['1.200 lei', '1200'],
    [' 12 345 ', '12345'],
    ['abc', ''],
    ['', ''],
    ['007', '7'],
    ['1'.repeat(20), '1'.repeat(9)],
  ])('keeps the digits of %j as %j', (typed, digits) => {
    const { input, type } = open();

    type(typed);

    expect(input.value).toBe(digits);
  });

  it('holds bani for the lei typed, digits only', () => {
    const { fixture, input, type } = open();

    type('1.200 lei');

    expect(input.value).toBe('1200');
    expect(fixture.componentInstance.bani()).toBe(120_000);
  });

  it('keeps a pasted run of digits to nine, past any price, without failing', () => {
    const { fixture, input, type } = open();

    type('12345678901234567890');

    expect(input.value).toBe('123456789');
    expect(fixture.componentInstance.bani()).toBe(12_345_678_900);
  });

  it('strips letters and spaces as they are typed or pasted', () => {
    const { fixture, input, type } = open();

    type('18o');

    expect(input.value).toBe('18');
    expect(fixture.componentInstance.bani()).toBe(1_800);
  });

  it('holds nothing for an emptied field', () => {
    const { fixture, type } = open();
    type('150');

    type('');

    expect(fixture.componentInstance.bani()).toBeUndefined();
  });

  it('shows the lei of the bani it is given', () => {
    const { fixture, input } = open();

    fixture.componentInstance.bani.set(24_000);
    fixture.detectChanges();

    expect(input.value).toBe('240');
  });

  it('marks the field as numeric for the phone keyboard', () => {
    const { input } = open();

    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});
