// @traces 142-FR-007
import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HlmRadioGroup, HlmRadioImports } from './radio-group';

@Component({
  imports: [HlmRadioImports],
  template: `
    <div hlmRadioGroup name="canal" aria-label="Canal" [value]="value()" (valueChange)="picked($event)">
      <hlm-radio value="email" inputId="r-email">E-mail</hlm-radio>
      <hlm-radio value="sms" inputId="r-sms" [disabled]="true" aria-describedby="hint">SMS</hlm-radio>
      <hlm-radio value="push" inputId="r-push">Push</hlm-radio>
    </div>
    <p id="hint">Adaugă telefonul</p>
  `,
})
class Host {
  readonly group = viewChild.required(HlmRadioGroup);
  readonly value = signal('email');
  readonly picks: string[] = [];
  picked(value: string) {
    this.picks.push(value);
  }
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const input = (id: string) =>
    element.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  const label = (id: string) =>
    element.querySelector<HTMLLabelElement>(
      `label[for="${id}"]`,
    ) as HTMLLabelElement;
  return { element, fixture, input, label };
}

describe('the cockpit radio group', () => {
  it('is one named radio group of native radios, each labelled by its text', async () => {
    const { element, input, label } = await render();

    const group = element.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Canal');
    expect(input('r-email').type).toBe('radio');
    expect(label('r-email').textContent?.trim()).toBe('E-mail');
    const names = new Set(
      [...element.querySelectorAll<HTMLInputElement>('input')].map(
        (i) => i.name,
      ),
    );
    expect(names.size).toBe(1);
  });

  it('checks the value it is given', async () => {
    const { input } = await render();

    expect(input('r-email').checked).toBe(true);
    expect(input('r-push').checked).toBe(false);
  });

  it('tells the pick of another option once', async () => {
    const { fixture, input, label } = await render();

    label('r-push').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picks).toEqual(['push']);
    expect(input('r-push').checked).toBe(true);
  });

  it('shows the value again when the owner puts it back', async () => {
    const { fixture, input, label } = await render();

    label('r-push').click();
    fixture.componentInstance.value.set('push');
    fixture.detectChanges();
    fixture.componentInstance.value.set('email');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input('r-email').checked).toBe(true);
  });

  it('shows its value again on reset after a pick the owner did not keep', async () => {
    const { fixture, input, label } = await render();

    label('r-push').click();
    fixture.detectChanges();
    expect(input('r-push').checked).toBe(true);
    const { group } = fixture.componentInstance;
    group().reset('email');
    fixture.detectChanges();

    expect(group().name).toBe('canal');
    expect(input('r-email').checked).toBe(true);
    expect(input('r-push').checked).toBe(false);
  });

  it('exposes a disabled option as disabled, described by its hint, and never picks it', async () => {
    const { fixture, input, label } = await render();

    expect(input('r-sms').disabled).toBe(true);
    expect(input('r-sms').getAttribute('aria-disabled')).toBe('true');
    expect(input('r-sms').getAttribute('aria-describedby')).toBe('hint');
    label('r-sms').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picks).toEqual([]);
  });
});
