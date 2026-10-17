import { rarVerdict } from './suspended-garages';

describe('rarVerdict', () => {
  // @traces 066-FR-004
  it.each([
    ['Autorizația RAR a expirat', 'expired'],
    ['Autorizația RAR a fost suspendată', 'suspended'],
    ['Autorizația RAR a fost retrasă', 'withdrawn'],
  ])('reads %j as %s', (reason, verdict) => {
    expect(rarVerdict('recheck_failed', reason)).toBe(verdict);
  });

  // @traces 066-FR-004
  it('takes the word that comes first in the text', () => {
    expect(rarVerdict('recheck_failed', 'retrasă după ce a expirat')).toBe(
      'withdrawn',
    );
    expect(rarVerdict('recheck_failed', 'expirat apoi suspendat')).toBe(
      'expired',
    );
    expect(rarVerdict('recheck_failed', 'suspendat, apoi retras')).toBe(
      'suspended',
    );
  });

  // @traces 066-FR-004
  it('ignores case', () => {
    expect(rarVerdict('recheck_failed', 'EXPIRATĂ')).toBe('expired');
    expect(rarVerdict('recheck_failed', 'RetRaSă')).toBe('withdrawn');
  });

  // @traces 066-FR-004
  it('matches any ending', () => {
    expect(rarVerdict('recheck_failed', 'expirate')).toBe('expired');
    expect(rarVerdict('recheck_failed', 'suspendarea')).toBeUndefined();
    expect(rarVerdict('recheck_failed', 'retragerea')).toBeUndefined();
  });

  // @traces 066-FR-004
  it('matches the word in the middle of another word', () => {
    expect(rarVerdict('recheck_failed', 'neexpirat')).toBe('expired');
  });

  // @traces 066-FR-004
  it.each(['', '   ', 'Autorizație nevalidă', 'expir', 'suspend', 'retra'])(
    'is absent for a reason naming none: %j',
    (reason) => {
      expect(rarVerdict('recheck_failed', reason)).toBeUndefined();
    },
  );

  // @traces 066-FR-004
  it.each(['documents_overdue', 'report_confirmed', 'admin'] as const)(
    'is absent for cause %s even when the reason names a verdict',
    (cause) => {
      expect(rarVerdict(cause, 'Autorizația a expirat')).toBeUndefined();
    },
  );

  // @traces 066-FR-004
  it('reads a multi-line reason', () => {
    expect(rarVerdict('recheck_failed', 'RAR\n\nretrasă\nexpirat')).toBe(
      'withdrawn',
    );
  });

  // @traces 066-FR-004
  it('survives a very long reason with the word at the end', () => {
    expect(rarVerdict('recheck_failed', `${'x '.repeat(100_000)}expirat`)).toBe(
      'expired',
    );
  });

  // @traces 066-FR-004
  it('does not read a prototype key as a verdict', () => {
    expect(
      rarVerdict('recheck_failed', 'constructor toString'),
    ).toBeUndefined();
  });

  // @traces 066-FR-004
  it('reads a decomposed unicode reason around the word', () => {
    expect(
      rarVerdict(
        'recheck_failed',
        'Autorizația ar fi expirată'.normalize('NFD'),
      ),
    ).toBe('expired');
  });
});
