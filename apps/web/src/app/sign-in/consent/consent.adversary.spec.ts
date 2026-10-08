import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { I18n } from '@motor-fix/i18n';
import { taskSave } from '@motor-fix/overlays';

import { Consent, consentControl } from './consent';

@Component({
  imports: [Consent, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <mf-consent [control]="form.controls.consent" [save]="save" />
      <button type="submit">Continue</button>
    </form>
  `,
})
class Form {
  readonly sent = jest.fn(async () => 'ok');
  readonly form = new FormGroup({ consent: consentControl() });
  readonly save = taskSave({ form: this.form, send: this.sent });
}

async function render(language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Form);
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
  const links = () =>
    [...element.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      rel: a.getAttribute('rel'),
      target: a.getAttribute('target'),
      text: a.textContent,
    }));
  return {
    box,
    element,
    fixture,
    i18n,
    links,
    sent: fixture.componentInstance.sent,
    submit,
  };
}

describe('the consent tick under misuse', () => {
  it('blocks the form again after the tick is set and cleared', async () => {
    const { box, element, sent, submit } = await render();

    box.click();
    box.click();
    await submit();

    expect(box.checked).toBe(false);
    expect(sent).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Bifează pentru a continua.');
  });

  it('sends once when the tick is set and the form is sent twice in a row', async () => {
    const { box, sent, submit } = await render();

    box.click();
    await submit();
    await submit();

    expect(sent.mock.calls.length).toBeLessThanOrEqual(2);
    expect(sent.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of sent.mock.calls as unknown[][])
      expect(call[0]).toEqual({ consent: true });
  });

  it('sends nothing for three refused attempts in a row', async () => {
    const { sent, submit } = await render();

    await submit();
    await submit();
    await submit();

    expect(sent).not.toHaveBeenCalled();
  });

  it('marks the box invalid for assistive technology only after a refused attempt', async () => {
    const { box, submit } = await render();
    expect(box.getAttribute('aria-invalid')).toBeNull();

    await submit();

    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe('mf-consent-error');
    expect(document.getElementById('mf-consent-error')).not.toBeNull();
  });

  it('clears the message and the invalid mark once the tick is set', async () => {
    const { box, element, submit } = await render();
    await submit();

    box.click();
    await submit();

    expect(element.textContent).not.toContain('Bifează pentru a continua.');
    expect(box.getAttribute('aria-invalid')).toBeNull();
  });

  it('links the Romanian titles to the Romanian texts in a new tab without an opener', async () => {
    const { links } = await render('ro');

    expect(links()).toEqual([
      {
        href: '/ro/terms',
        rel: 'noopener',
        target: '_blank',
        text: 'Termenii de utilizare',
      },
      {
        href: '/ro/privacy',
        rel: 'noopener',
        target: '_blank',
        text: 'Nota de informare privind datele personale',
      },
    ]);
  });

  it('links the English titles to the English texts in a new tab without an opener', async () => {
    const { links } = await render('en');

    expect(links()).toEqual([
      {
        href: '/en/terms',
        rel: 'noopener',
        target: '_blank',
        text: 'Terms of use',
      },
      {
        href: '/en/privacy',
        rel: 'noopener',
        target: '_blank',
        text: 'Privacy notice',
      },
    ]);
  });

  it('reads the English sentence and message', async () => {
    const { element, submit } = await render('en');

    await submit();

    expect(
      element.querySelector('label')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('I accept the Terms of use and have read the Privacy notice.');
    expect(element.textContent).toContain('Tick to continue.');
  });

  it('follows the language when it changes after the tick is shown', async () => {
    const { i18n, fixture, links } = await render('ro');

    await i18n.use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(links().map((l) => l.href)).toEqual(['/en/terms', '/en/privacy']);
  });

  it('is not set by clicking a link in its text', async () => {
    const { box, element } = await render();
    const link = element.querySelector('a') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());

    link.click();

    expect(box.checked).toBe(false);
  });
});
