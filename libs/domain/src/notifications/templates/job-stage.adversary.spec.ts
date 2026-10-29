import { TEMPLATES } from './registry';
import { render } from '../templates';

const link = 'https://motorfix.test/app/driver/requests/r-1';
const evil = '<script>alert(1)</script>';

// @traces 277-FR-001
// @traces 277-FR-002
describe('the job stage messages under hostile values', () => {
  it('escapes markup in the actor and car of the started e-mail', () => {
    const mail = render('JOB_STARTED', 'email', 'en', {
      actor: evil,
      car: `"><img src=x onerror=1>`,
      link,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.subject).toContain('Work on');
  });

  it('escapes markup in the garage of the ready e-mail', () => {
    const mail = render('JOB_READY', 'email', 'ro', { garage: evil, link });
    expect(mail.html).not.toContain('<script>');
  });

  it('escapes a link that tries to break out of the button attribute', () => {
    const mail = render('JOB_READY', 'email', 'en', {
      garage: 'G',
      link: `${link}"><script>alert(1)</script>`,
    });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('keeps unicode names intact on the bell', () => {
    expect(
      render('JOB_READY', 'bell', 'ro', { garage: 'Șanț & Țuică 🚗', link }),
    ).toBe('Mașina ta e gata. Te așteptăm la Șanț & Țuică 🚗.');
  });

  it('renders Romanian for a language that is neither ro nor en', () => {
    expect(
      render('JOB_READY', 'bell', 'fr' as never, { garage: 'G', link }),
    ).toBe('Mașina ta e gata. Te așteptăm la G.');
  });

  it('holds no sms text for either type', () => {
    expect(TEMPLATES['JOB_READY']?.sms).toBeUndefined();
    expect(TEMPLATES['JOB_STARTED']?.sms).toBeUndefined();
  });

  it('declares the ready WhatsApp templates with only the garage slot', () => {
    expect(TEMPLATES['JOB_READY']?.whatsapp?.ro).toEqual({
      name: 'motorfix_job_ready_ro',
      slots: ['{garage}'],
    });
    expect(TEMPLATES['JOB_READY']?.whatsapp?.en).toEqual({
      name: 'motorfix_job_ready_en',
      slots: ['{garage}'],
    });
  });

  it('renders the same text twice for the same input', () => {
    const p = { garage: 'G', link };
    expect(render('JOB_READY', 'email', 'en', p)).toEqual(
      render('JOB_READY', 'email', 'en', p),
    );
  });
});
