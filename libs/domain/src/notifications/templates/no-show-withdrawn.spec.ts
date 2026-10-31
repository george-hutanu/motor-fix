import { TEMPLATES } from './registry';
import { VIEW_OF_KIND } from '../bell/bell.link';
import { notificationType } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const app = 'https://motorfix.test';
const link = `${app}/app/driver/requests/r-1`;
const params = { garage: 'Volt Auto', link, slot: '2026-10-30T07:00:00.000Z' };

// @traces 1259-FR-008
describe('the withdrawn no-show message to the driver', () => {
  it('has one driver text that passes the template check', () => {
    const own = { NO_SHOW_WITHDRAWN: TEMPLATES['NO_SHOW_WITHDRAWN'] };

    expect(own.NO_SHOW_WITHDRAWN?.audience).toBe('driver');
    expect(checkTemplates(own)).toEqual([]);
    expect(templateName('NO_SHOW_WITHDRAWN', {})).toBe('NO_SHOW_WITHDRAWN');
  });

  it('says the booking stands again, naming the garage and the slot', () => {
    const ro = render('NO_SHOW_WITHDRAWN', 'bell', 'ro', params);
    const en = render('NO_SHOW_WITHDRAWN', 'bell', 'en', params);

    expect(ro).toMatch(
      /^Volt Auto a retras neprezentarea · programarea din .*09:00.* rămâne valabilă$/,
    );
    expect(en).toMatch(
      /^Volt Auto withdrew the no-show · your booking on .*09:00.* stands$/,
    );
    const push = render('NO_SHOW_WITHDRAWN', 'push', 'ro', params);
    expect(push.body).toMatch(/^Volt Auto a retras neprezentarea · /);
    expect(push.link).toBe(link);
  });

  it('opens the driver’s requests from the e-mail, in both languages', () => {
    const ro = render('NO_SHOW_WITHDRAWN', 'email', 'ro', params);
    const en = render('NO_SHOW_WITHDRAWN', 'email', 'en', params);

    expect(ro.text).toContain('rămâne valabilă');
    expect(en.text).toContain('stands');
    expect(ro.text).toContain(link);
    expect(en.text).toContain(link);
  });

  it('is an event in the bookings group, never held for quiet hours, its bell opening the requests', () => {
    const type = notificationType('NO_SHOW_WITHDRAWN');

    expect(type.trigger).toBe('event');
    expect(type.group).toBe('bookings');
    expect(type.urgent).toBe(true);
    expect([...type.channels].sort()).toEqual(['email', 'push', 'whatsapp']);
    expect(VIEW_OF_KIND['NO_SHOW_WITHDRAWN']).toBe('requests');
  });
});
