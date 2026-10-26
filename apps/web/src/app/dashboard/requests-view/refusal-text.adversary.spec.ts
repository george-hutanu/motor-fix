import { refusalText } from './refusal-text';

const MESSAGES = 'driver.requests.cancelRequestDialog';

const i18n = (known: Record<string, string>) => ({
  t: (key: string) => known[key] ?? key,
});

// @traces 1385-FR-006
describe('refusalText under odd codes', () => {
  it('answers nothing for an empty code', () => {
    expect(refusalText(i18n({}), MESSAGES, '')).toBeUndefined();
  });

  it('does not take a text for another dialog with the same code', () => {
    const texts = i18n({
      'driver.requests.cancelBookingDialog.problem.invalid_transition': 'x',
    });

    expect(refusalText(texts, MESSAGES, 'invalid_transition')).toBeUndefined();
  });

  it('does not let a dotted code climb into another key', () => {
    const texts = i18n({ 'shell.form.problem.x': 'leak' });

    expect(refusalText(texts, MESSAGES, '../x')).toBeUndefined();
  });
});
