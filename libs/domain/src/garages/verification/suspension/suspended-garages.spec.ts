import { rarVerdict } from './suspended-garages';

// @traces 066-FR-004

describe("the RAR verdict read from a failed re-check's reason", () => {
  it.each([
    ['Autorizație RAR expirată pe 12 sept. 2026', 'expired'],
    ['autorizatia rar EXPIRAT', 'expired'],
    ['Autorizație RAR suspendată de RAR', 'suspended'],
    ['Autorizația a fost retrasă', 'withdrawn'],
    ['RETRAS din registru', 'withdrawn'],
  ])('reads %s as %s', (reason, verdict) => {
    expect(rarVerdict('recheck_failed', reason)).toBe(verdict);
  });

  it('takes the word that comes first in the text', () => {
    expect(
      rarVerdict(
        'recheck_failed',
        'Autorizație RAR retrasă după ce a fost suspendată',
      ),
    ).toBe('withdrawn');
    expect(rarVerdict('recheck_failed', 'Suspendată, apoi expirată')).toBe(
      'suspended',
    );
  });

  it('gives none when the reason names none of the three', () => {
    expect(rarVerdict('recheck_failed', 'Registrul nu a răspuns')).toBe(
      undefined,
    );
  });

  it.each(['documents_overdue', 'admin', 'report_confirmed'] as const)(
    'gives none for a %s suspension, whatever its reason',
    (cause) => {
      expect(rarVerdict(cause, 'Autorizație RAR expirată')).toBe(undefined);
    },
  );
});
