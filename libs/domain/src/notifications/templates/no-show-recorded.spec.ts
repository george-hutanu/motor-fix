import { TEMPLATES } from './registry';
import { VIEW_OF_KIND } from '../bell/bell.link';
import { notificationType } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const app = 'https://motorfix.test';
const link = `${app}/app/driver/requests/r-1`;
const params = { garage: 'Volt Auto', link, slot: '2026-10-30T07:00:00.000Z' };

// @traces 1259-FR-007
describe('the no-show message to the driver', () => {
  it('has one driver text that passes the template check', () => {
    const own = { NO_SHOW_RECORDED: TEMPLATES['NO_SHOW_RECORDED'] };

    expect(own.NO_SHOW_RECORDED?.audience).toBe('driver');
    expect(checkTemplates(own)).toEqual([]);
    expect(templateName('NO_SHOW_RECORDED', {})).toBe('NO_SHOW_RECORDED');
  });

  it('names the garage and the slot on the bell and the push, in both languages', () => {
    const ro = render('NO_SHOW_RECORDED', 'bell', 'ro', params);
    const en = render('NO_SHOW_RECORDED', 'bell', 'en', params);

    expect(ro).toMatch(/^Nu te-ai prezentat la Volt Auto · /);
    expect(en).toMatch(/^You did not show up at Volt Auto · /);
    expect(ro).toContain('09:00');
    expect(en).toContain('09:00');
    const push = render('NO_SHOW_RECORDED', 'push', 'en', params);
    expect(push.body).toMatch(/^You did not show up at Volt Auto · /);
    expect(push.link).toBe(link);
  });

  it('says in the e-mail that no fee is charged, opening the driver’s requests', () => {
    const ro = render('NO_SHOW_RECORDED', 'email', 'ro', params);
    const en = render('NO_SHOW_RECORDED', 'email', 'en', params);

    expect(ro.text).toContain('Nu te-ai prezentat la Volt Auto');
    expect(ro.text).toContain('Nu se percepe nicio taxă');
    expect(en.text).toContain('No fee is charged');
    expect(en.text).toContain(link);
    expect(ro.text).toContain(link);
  });

  it('is an event in the bookings group, never held for quiet hours, its bell opening the requests', () => {
    const type = notificationType('NO_SHOW_RECORDED');

    expect(type.trigger).toBe('event');
    expect(type.group).toBe('bookings');
    expect(type.urgent).toBe(true);
    expect([...type.channels].sort()).toEqual(['email', 'push', 'whatsapp']);
    expect(VIEW_OF_KIND['NO_SHOW_RECORDED']).toBe('requests');
  });
});
