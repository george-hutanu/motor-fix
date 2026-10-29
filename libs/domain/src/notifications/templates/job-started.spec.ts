import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'JOB_STARTED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const ro = { actor: 'Mihai', car: 'Dacia Logan', link };
const en = { actor: 'Mihai', car: 'the Dacia Logan', link };

// @traces 277-FR-001
describe('the work-started message to the driver', () => {
  it('is registered for the driver, carries no plate or phone and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'actor',
      'car',
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

  it('says who started work on which car, on the bell and the push', () => {
    expect(render(KIND, 'bell', 'ro', ro)).toBe(
      'Mihai a început lucrul la Dacia Logan.',
    );
    expect(render(KIND, 'bell', 'en', en)).toBe(
      'Mihai started work on the Dacia Logan.',
    );
    expect(
      render(KIND, 'bell', 'en', {
        actor: 'Garaj Nordic',
        car: 'your car',
        link,
      }),
    ).toBe('Garaj Nordic started work on your car.');
    const push = render(KIND, 'push', 'ro', ro);
    expect(push.title).toBe('Lucrul a început');
    expect(push.body).toBe('Mihai a început lucrul la Dacia Logan.');
    expect(push.link).toBe(link);
    expect(render(KIND, 'push', 'en', en).title).toBe('Work has started');
  });

  it('names the car in the e-mail subject and links the tracker', () => {
    expect(render(KIND, 'email', 'ro', ro).subject).toBe(
      'Lucrul la Dacia Logan a început',
    );
    const mail = render(KIND, 'email', 'en', en);
    expect(mail.subject).toBe('Work on the Dacia Logan has started');
    expect(mail.html).toContain(link);
  });

  it('names its approved WhatsApp templates with the actor and the car', () => {
    expect(TEMPLATES[KIND]?.whatsapp?.ro).toEqual({
      name: 'motorfix_job_started_ro',
      slots: ['{actor}', '{car}'],
    });
    expect(TEMPLATES[KIND]?.whatsapp?.en?.name).toBe('motorfix_job_started_en');
  });
});
