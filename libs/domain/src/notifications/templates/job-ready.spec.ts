import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'JOB_READY';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const params = { app: 'https://motorfix.test', garage: 'Garaj Nordic', link };

// @traces 277-FR-002
describe('the car-ready message to the driver', () => {
  it('is registered for the driver, carries no plate or phone and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'garage',
      'link',
    ]);
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('says the car is ready and the garage is expecting the driver, on the bell and the push', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Mașina ta e gata. Te așteptăm la Garaj Nordic.',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Your car is ready. Garaj Nordic is expecting you.',
    );
    const push = render(KIND, 'push', 'ro', params);
    expect(push.title).toBe('Mașina ta e gata');
    expect(push.body).toBe('Te așteptăm la Garaj Nordic.');
    expect(push.link).toBe(link);
    expect(render(KIND, 'push', 'en', params).title).toBe('Your car is ready');
  });

  it('links the e-mail to the tracker', () => {
    expect(render(KIND, 'email', 'ro', params).subject).toBe(
      'Mașina ta e gata',
    );
    const en = render(KIND, 'email', 'en', params);
    expect(en.subject).toBe('Your car is ready');
    expect(en.html).toContain('Garaj Nordic is expecting you.');
    expect(en.html).toContain(link);
  });

  it('names its approved WhatsApp templates with the garage as the one slot', () => {
    expect(TEMPLATES[KIND]?.whatsapp?.ro).toEqual({
      name: 'motorfix_job_ready_ro',
      slots: ['{garage}'],
    });
    expect(TEMPLATES[KIND]?.whatsapp?.en?.name).toBe('motorfix_job_ready_en');
  });
});
