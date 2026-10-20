import { TEMPLATES } from './registry';
import { render, TemplateError } from '../templates';

const KIND = 'ADMIN_RECHECK_DUE';
const dashboard = 'https://motorfix.test/app/admin/garages';

// @traces 1351-FR-009
describe('the re-check alert under hostile values', () => {
  it.each(['email', 'bell', 'push'] as const)(
    'fails the %s render when the count is missing',
    (channel) => {
      expect(() => render(KIND, channel, 'en', { dashboard })).toThrow(
        TemplateError,
      );
    },
  );

  it('fails the e-mail render when the count is null', () => {
    expect(() =>
      render(KIND, 'email', 'en', { dashboard, garages: null }),
    ).toThrow(TemplateError);
  });

  it('fails the e-mail render when the link is missing', () => {
    expect(() =>
      render(KIND, 'email', 'ro', { garages: '3 service-uri' }),
    ).toThrow(TemplateError);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/app/admin/garages'])(
    'refuses the e-mail link %s',
    (link) => {
      expect(() =>
        render(KIND, 'email', 'en', { dashboard: link, garages: '3 garages' }),
      ).toThrow(TemplateError);
    },
  );

  it('escapes markup in the count in the e-mail html', () => {
    const mail = render(KIND, 'email', 'en', {
      dashboard,
      garages: '<script>alert(1)</script> garages',
    });
    expect(mail.html).not.toContain('<script>');
  });

  it('does not expand a placeholder held in the count', () => {
    expect(
      render(KIND, 'bell', 'en', { dashboard, garages: '{dashboard}' }),
    ).toBe('{dashboard} to re-check in the RAR register');
  });

  it('reads Romanian for an unknown language', () => {
    expect(
      render(KIND, 'bell', 'de', { dashboard, garages: '2 service-uri' }),
    ).toBe('2 service-uri de reverificat în registrul RAR');
  });

  it('holds no whatsapp or sms text', () => {
    expect(TEMPLATES[KIND]?.whatsapp).toBeUndefined();
    expect(TEMPLATES[KIND]?.sms).toBeUndefined();
  });

  it('passes the same push link as the e-mail button', () => {
    const push = render(KIND, 'push', 'ro', {
      dashboard,
      garages: '1 service',
    });
    const mail = render(KIND, 'email', 'ro', {
      dashboard,
      garages: '1 service',
    });
    expect(push.link).toBe(dashboard);
    expect(mail.html).toContain(dashboard);
  });
});
