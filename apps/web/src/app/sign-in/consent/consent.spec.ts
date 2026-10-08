import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { I18n } from '@motor-fix/i18n';
import { taskSave } from '@motor-fix/overlays';

import { Consent, consentControl } from './consent';

// Any form that creates an account places the same tick.
@Component({
  imports: [Consent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <mf-consent [control]="form.controls.consent" [save]="save" />
      <button type="submit">Continue</button>
    </form>
  `,
})
class OtherSignUp {
  readonly sent = jest.fn(async () => 'ok');
  readonly form = new FormGroup({ consent: consentControl() });
  readonly save = taskSave({ form: this.form, send: this.sent });
}

async function render() {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(OtherSignUp);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const box = element.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
  const submit = async () => {
    element.querySelector('button')?.click();
    await fixture.whenStable();
  };
  return { box, element, sent: fixture.componentInstance.sent, submit };
}

describe('the consent tick in any account form', () => {
  it('starts unticked and blocks the form until it is ticked', async () => {
    const { box, element, sent, submit } = await render();

    expect(box.checked).toBe(false);
    await submit();
    expect(sent).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Bifează pentru a continua.');

    box.click();
    await submit();
    expect(sent).toHaveBeenCalledWith({ consent: true }, expect.any(String));
  });

  it('shows no message before the form is sent', async () => {
    const { element } = await render();

    expect(element.textContent).not.toContain('Bifează pentru a continua.');
  });

  it('gives two ticks on one page their own error message', async () => {
    @Component({
      imports: [Consent],
      template: `
        <mf-consent [control]="first" [save]="save" />
        <mf-consent [control]="second" [save]="save" errorId="second-consent-error" />
      `,
    })
    class TwoTicks {
      readonly first = consentControl();
      readonly second = consentControl();
      readonly save = taskSave({
        form: new FormGroup({ first: this.first, second: this.second }),
        send: async () => 'ok',
      });
    }
    await TestBed.inject(I18n).enter('public');
    const fixture = TestBed.createComponent(TwoTicks);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const described = [...element.querySelectorAll('input')].map((box) =>
      box.getAttribute('aria-describedby'),
    );
    expect(new Set(described).size).toBe(2);
    for (const id of described) {
      expect(element.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
  });
});
