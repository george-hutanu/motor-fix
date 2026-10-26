import { refusalText } from './refusal-text';

const MESSAGES = 'driver.requests.cancelBookingDialog';

// A stand-in I18n that knows only the keys given, answering the key itself
// for any other, as the real one does.
const i18n = (known: Record<string, string>) => ({
  t: (key: string) => known[key] ?? key,
});

// @traces 1385-FR-006
describe('refusalText', () => {
  it("takes the dialog's own text for the code first", () => {
    const texts = i18n({
      [`${MESSAGES}.problem.invalid_transition`]:
        'Programarea nu mai poate fi anulată.',
      'shell.form.problem.invalid_transition': 'Shared',
    });

    expect(refusalText(texts, MESSAGES, 'invalid_transition')).toBe(
      'Programarea nu mai poate fi anulată.',
    );
  });

  it("falls back to the shared form's text", () => {
    const texts = i18n({ 'shell.form.problem.not_found': 'Nu mai găsim.' });

    expect(refusalText(texts, MESSAGES, 'not_found')).toBe('Nu mai găsim.');
  });

  it('answers nothing for a code neither knows', () => {
    expect(refusalText(i18n({}), MESSAGES, 'teapot')).toBeUndefined();
  });
});
