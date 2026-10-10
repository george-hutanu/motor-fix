import { reasonLabel } from './verification-result';
import { bellText, render, templateName } from '../templates';

const KIND = 'VERIFICATION_RESULT';
const link = 'https://motorfix.test/app/garage';
const base = { app: 'https://motorfix.test', link };

// @traces 209-FR-009
describe('the reason label for stored codes', () => {
  it.each([
    ['constructor', 'Alt motiv'],
    ['__proto__', 'Alt motiv'],
    ['toString', 'Alt motiv'],
    ['hasOwnProperty', 'Alt motiv'],
    ['Documents', 'Alt motiv'],
    ['DOCUMENTS', 'Alt motiv'],
    [' rar', 'Alt motiv'],
    ['', 'Alt motiv'],
    [null, 'Alt motiv'],
  ])('labels %p as the other reason', (code, label) => {
    expect(reasonLabel(code, 'ro')).toBe(label);
  });

  it.each(['fr', '', 'EN', 'constructor'])(
    'answers in Romanian for the language %p',
    (language) => {
      expect(reasonLabel('rar', language)).toBe('Autorizație RAR');
    },
  );

  it('answers English only for en', () => {
    expect(reasonLabel('rar', 'en')).toBe('RAR authorisation');
    expect(reasonLabel('nope', 'en')).toBe('Other reason');
  });
});

// @traces 209-FR-005
describe('choosing the variant by decision', () => {
  it.each([
    'Approved',
    'APPROVED',
    ' approved',
    'approved ',
    'constructor',
    '__proto__',
    'toString',
    '',
    null,
    undefined,
    1,
    ['approved'],
    { toString: () => 'approved' },
  ])('falls back to the bare kind for the decision %p', (decision) => {
    expect(templateName(KIND, { decision: decision as never })).toBe(KIND);
  });

  it('falls back to the bare kind when there is no decision at all', () => {
    expect(templateName(KIND, {})).toBe(KIND);
  });

  it('shows the generic bell text for an unknown decision rather than throwing', () => {
    const generic = bellText('GENERIC', 'ro', {});
    expect(bellText(KIND, 'ro', { decision: 'Approved' })).toBe(generic);
    expect(bellText(KIND, 'ro', { decision: 'constructor' })).toBe(generic);
  });

  it('shows the generic bell text for null params', () => {
    expect(bellText(KIND, 'en', null as never)).toBe(
      bellText('GENERIC', 'en', {}),
    );
  });
});

// @traces 209-FR-010
describe('the admin note in the e-mail', () => {
  const negative = (note: string, decision = 'rejected') =>
    render(`${KIND}.${decision}`, 'email', 'ro', {
      ...base,
      decision,
      note,
      reason: 'Documente',
    });

  it('does not substitute placeholders written inside the note', () => {
    const note = 'Vezi {link} și {reason} și {note}';
    const mail = negative(note);
    expect(mail.text).toContain(note);
    expect(mail.html).toContain('{link}');
    expect(mail.html).toContain('{note}');
  });

  it('does not substitute placeholders written inside the reason label', () => {
    const mail = render(`${KIND}.rejected`, 'email', 'ro', {
      ...base,
      decision: 'rejected',
      note: 'x',
      reason: '{note}',
    });
    expect(mail.text).toContain('{note}');
  });

  it.each(['more_requested', 'rejected'])(
    'escapes markup and quotes in the %s HTML part and keeps the text part raw',
    (decision) => {
      const note = `<script>alert("x")</script> & 'q' </td></tr>`;
      const mail = negative(note, decision);
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('</td></tr></td>');
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).toContain('&amp;');
      expect(mail.text).toContain(note);
    },
  );

  it('quotes a very long note in full', () => {
    const note = 'cuvânt '.repeat(5000).trim();
    const mail = negative(note);
    expect(mail.text).toContain(note);
    expect(mail.html).toContain(note);
  });

  it('keeps unicode and newlines in the text part', () => {
    const note = 'Șțăîâ ✓ 日本語 😀\nal doilea rând';
    expect(negative(note).text).toContain(note);
  });

  it('fails the render when the note is missing', () => {
    expect(() =>
      render(`${KIND}.rejected`, 'email', 'ro', {
        ...base,
        decision: 'rejected',
        reason: 'Documente',
      }),
    ).toThrow();
  });

  it('fails the render when the note is null', () => {
    expect(() =>
      render(`${KIND}.rejected`, 'email', 'ro', {
        ...base,
        decision: 'rejected',
        note: null as never,
        reason: 'Documente',
      }),
    ).toThrow();
  });
});

// @traces 209-FR-010
describe('push and bell never carry the note', () => {
  it.each(['more_requested', 'rejected'])(
    'omits the note from the %s push and bell even when given',
    (decision) => {
      const note = 'SECRET-NOTE-TEXT';
      const params = { ...base, decision, note, reason: 'Documente' };
      for (const language of ['ro', 'en']) {
        const push = render(`${KIND}.${decision}`, 'push', language, params);
        expect(JSON.stringify(push)).not.toContain(note);
        expect(bellText(KIND, language, params)).not.toContain(note);
      }
    },
  );
});

// @traces 209-FR-006
describe('the approved e-mail links', () => {
  it('refuses a dashboard link that is not https', () => {
    expect(() =>
      render(`${KIND}.approved`, 'email', 'ro', {
        ...base,
        decision: 'approved',
        link: 'javascript:alert(1)',
        profile: 'https://motorfix.test/ro/garages/x',
      }),
    ).toThrow();
  });

  it('renders in Romanian for a language that is neither ro nor en', () => {
    const params = {
      ...base,
      decision: 'approved',
      profile: 'https://motorfix.test/ro/garages/x',
    };
    expect(render(`${KIND}.approved`, 'email', 'de', params)).toEqual(
      render(`${KIND}.approved`, 'email', 'ro', params),
    );
  });
});
