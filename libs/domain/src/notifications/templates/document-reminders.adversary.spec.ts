import { bellLink } from '../bell/bell.link';
import { bellText, render, TemplateError } from '../templates';

const dashboard = 'https://motorfix.test/app/garage';

// @traces 068-FR-004
describe('the due and overdue notices at the edges of the calendar', () => {
  it.each([
    ['2028-02-29', '29 feb. 2028', '29 Feb 2028'],
    ['2027-01-01', '1 ian. 2027', '1 Jan 2027'],
    ['2026-12-31', '31 dec. 2026', '31 Dec 2026'],
    ['2027-09-05', '5 sept. 2027', '5 Sep 2027'],
  ])('names the due date %s in both languages', (dueOn, ro, en) => {
    expect(bellText('DOCUMENT_DUE', 'ro', { dashboard, dueOn })).toBe(
      `Reîncarcă documentele anuale până pe ${ro}`,
    );
    expect(bellText('DOCUMENT_DUE', 'en', { dashboard, dueOn })).toBe(
      `Upload your yearly documents again by ${en}`,
    );
  });

  it('names the first of the next month as the suspension day after a grace ending on the 31st', () => {
    const params = { dashboard, dueOn: '2027-01-17', suspendOn: '2027-02-01' };
    expect(bellText('DOCUMENT_OVERDUE', 'ro', params)).toContain(
      'altfel profilul va fi suspendat pe 1 feb. 2027',
    );
    expect(bellText('DOCUMENT_OVERDUE', 'en', params)).toContain(
      'otherwise the profile will be suspended on 1 Feb 2027',
    );
  });

  it.each(['DOCUMENT_DUE', 'DOCUMENT_OVERDUE'])(
    'fails the %s render for a due date that is not a day',
    (kind) => {
      for (const dueOn of ['garbage', '2027-02-30', '', '15/01/2027']) {
        expect(() =>
          render(kind, 'email', 'ro', {
            dashboard,
            dueOn,
            suspendOn: '2027-01-30',
          }),
        ).toThrow(/not a day/);
      }
    },
  );

  it('fails the overdue render without the suspension day', () => {
    expect(() =>
      render('DOCUMENT_OVERDUE', 'push', 'ro', {
        dashboard,
        dueOn: '2027-01-15',
      }),
    ).toThrow(TemplateError);
  });

  it.each(['DOCUMENT_DUE', 'DOCUMENT_OVERDUE'])(
    'refuses a %s e-mail link that is not https',
    (kind) => {
      expect(() =>
        render(kind, 'email', 'en', {
          dashboard: 'javascript:alert(1)',
          dueOn: '2027-01-15',
          suspendOn: '2027-01-30',
        }),
      ).toThrow(TemplateError);
    },
  );

  it.each(['DOCUMENT_DUE', 'DOCUMENT_OVERDUE'])(
    'opens the dashboard from the %s bell whatever the params',
    (kind) => {
      for (const params of [{}, null, { dashboard: 'https://evil.test/' }]) {
        expect(bellLink({ kind, params, subjectId: null } as never)).toBe(
          '/app/garage',
        );
      }
    },
  );

  it.each(['', 'fr', 'EN', '__proto__'])(
    'falls back to Romanian for the language %j',
    (language) => {
      const params = { dashboard, dueOn: '2027-01-15' };
      expect(render('DOCUMENT_DUE', 'email', language, params).subject).toBe(
        'Reîncarcă documentele anuale până pe 15 ian. 2027',
      );
    },
  );

  it('writes no personal data into the e-mail beyond the dates and the link', () => {
    const mail = render('DOCUMENT_OVERDUE', 'email', 'en', {
      account: 'radu@example.com',
      dashboard,
      dueOn: '2027-01-15',
      garage: 'ATELIER DINAMO SRL',
      suspendOn: '2027-01-30',
    });
    expect(mail.text).not.toContain('radu@example.com');
    expect(mail.text).not.toContain('DINAMO');
  });
});
