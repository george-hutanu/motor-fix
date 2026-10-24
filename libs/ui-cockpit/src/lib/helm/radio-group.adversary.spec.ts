// @traces 142-FR-007
import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HlmRadioGroup, HlmRadioImports } from './radio-group';

@Component({
  imports: [HlmRadioImports],
  template: `
    <div hlmRadioGroup name="a" aria-label="A" [value]="a()" (valueChange)="picks.push('a:' + $event)">
      <hlm-radio value="x y" inputId="a-1">Spaced</hlm-radio>
      <hlm-radio value="" inputId="a-2">Empty</hlm-radio>
      <hlm-radio value="z" inputId="a-3" [disabled]="off()">Z</hlm-radio>
    </div>
    <div hlmRadioGroup name="b" aria-label="B" [value]="'z'" (valueChange)="picks.push('b:' + $event)">
      <hlm-radio value="z" inputId="b-1">Z</hlm-radio>
      <hlm-radio value="w" inputId="b-2">W</hlm-radio>
    </div>
  `,
})
class Host {
  readonly group = viewChild.required(HlmRadioGroup);
  readonly a = signal('x y');
  readonly off = signal(false);
  readonly picks: string[] = [];
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

describe('the cockpit radio group under odd input', () => {
  it('checks and picks a value that holds a space', async () => {
    const { fixture, input, label } = await render();

    expect(input('a-1').checked).toBe(true);
    label('a-3').click();
    fixture.detectChanges();
    label('a-1').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picks).toEqual(['a:z', 'a:x y']);
  });

  it('keeps two groups with the same option value apart', async () => {
    const { fixture, input, label } = await render();

    label('b-2').click();
    fixture.detectChanges();

    expect(input('b-2').checked).toBe(true);
    expect(input('a-3').checked).toBe(false);
    expect(fixture.componentInstance.picks).toEqual(['b:w']);
  });

  it('gives each group its own radio name', async () => {
    const { input } = await render();

    expect(input('a-1').name).toBe('a');
    expect(input('b-1').name).toBe('b');
  });

  it('checks nothing when the value matches no option', async () => {
    const { fixture, element } = await render();

    fixture.componentInstance.a.set('nope');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelectorAll('[name="a"]:checked')).toHaveLength(0);
  });

  it('does not tell a pick of the option already checked', async () => {
    const { fixture, label } = await render();

    label('a-1').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.picks).toEqual([]);
  });

  it('stops picking an option once it is disabled and picks it again when enabled', async () => {
    const { fixture, input, label } = await render();

    fixture.componentInstance.off.set(true);
    fixture.detectChanges();
    label('a-3').click();
    fixture.detectChanges();
    expect(input('a-3').disabled).toBe(true);
    expect(fixture.componentInstance.picks).toEqual([]);

    fixture.componentInstance.off.set(false);
    fixture.detectChanges();
    label('a-3').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picks).toEqual(['a:z']);
  });

  it('resets to a value after two unkept picks in a row', async () => {
    const { fixture, input, label } = await render();
    const { group } = fixture.componentInstance;

    label('a-3').click();
    group().reset('x y');
    fixture.detectChanges();
    label('a-3').click();
    group().reset('x y');
    fixture.detectChanges();

    expect(input('a-1').checked).toBe(true);
    expect(input('a-3').checked).toBe(false);
  });

  it('puts no id or described-by on the host element itself', async () => {
    const { element } = await render();

    const hosts = [...element.querySelectorAll('hlm-radio')];
    expect(hosts).toHaveLength(5);
    for (const host of hosts) {
      expect(host.hasAttribute('id')).toBe(false);
      expect(host.hasAttribute('aria-describedby')).toBe(false);
    }
  });
});
