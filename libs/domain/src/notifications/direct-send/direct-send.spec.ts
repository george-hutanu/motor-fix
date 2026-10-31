import type { Job } from 'bullmq';

import {
  DIRECT_SEND_WAIT_MS,
  type DirectSendJob,
  sendDirect,
} from './direct-send';
import { type Brevo, BrevoError } from '../brevo/brevo';
import { testConfig, testPhoneConfig } from '../notifications.testing';

const TO = '+40722123456';
const values = {
  car: 'Dacia Logan',
  days: 7,
  link: 'https://motorfix.example/ro/transfer/abc',
};
const invite = {
  app: 'https://motorfix.test',
  garage: 'Service Popescu',
  link: 'https://motorfix.test/ro/invite/tok',
};

function sender(
  sendWhatsApp: Brevo['sendWhatsApp'] = async () => 'wa-1',
  send: Brevo['send'] = async () => 'em-1',
) {
  const brevo = { send: jest.fn(send), sendWhatsApp: jest.fn(sendWhatsApp) };
  return {
    brevo,
    email: testConfig('http://brevo.test'),
    phone: testPhoneConfig({
      PHONE_ALLOWLIST: '+407*',
      WHATSAPP_TEMPLATES:
        'motorfix_car_transfer_link_ro=41,motorfix_car_transfer_link_en=42',
    }),
  };
}

function job(
  name: 'whatsapp' | 'email',
  data: Partial<DirectSendJob> = {},
  timestamp = Date.now(),
): Job<DirectSendJob> {
  return {
    data: {
      language: 'ro',
      template: 'CAR_TRANSFER_LINK',
      to: TO,
      values,
      ...data,
    },
    name,
    timestamp,
  } as Job<DirectSendJob>;
}

// @traces 1379-FR-002 415-FR-006
describe('sendDirect, WhatsApp', () => {
  it('sends the rendered template through the provider once and answers null', async () => {
    const s = sender();

    expect(await sendDirect(s, job('whatsapp'))).toBeNull();
    expect(s.brevo.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(s.brevo.sendWhatsApp).toHaveBeenCalledWith({
      params: ['Dacia Logan', values.link, '7'],
      sender: s.phone.whatsappSender,
      templateId: 41,
      to: TO,
    });
  });

  it('picks the template of the language', async () => {
    const s = sender();

    await sendDirect(s, job('whatsapp', { language: 'en' }));

    expect(s.brevo.sendWhatsApp.mock.calls[0][0].templateId).toBe(42);
  });

  it('answers template_missing for a template the configuration does not name', async () => {
    const s = sender();
    s.phone.whatsappTemplates = {};

    expect(await sendDirect(s, job('whatsapp'))).toBe('template_missing');
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('answers not_allowed for a number outside the allowlist', async () => {
    const s = sender();

    expect(await sendDirect(s, job('whatsapp', { to: '+40622123456' }))).toBe(
      'not_allowed',
    );
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('answers sending_off while sending is off', async () => {
    const s = sender();
    s.phone.sending = false;

    expect(await sendDirect(s, job('whatsapp'))).toBe('sending_off');
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });
});

// @traces 1379-FR-002
describe('sendDirect, e-mail', () => {
  const mail = (to = 'ana@example.test') =>
    job('email', {
      name: 'Ana',
      template: 'STAFF_INVITE.mechanic',
      to,
      values: invite,
    });

  it('sends the rendered e-mail through the provider once and answers null', async () => {
    const s = sender();

    expect(await sendDirect(s, mail())).toBeNull();
    expect(s.brevo.send).toHaveBeenCalledTimes(1);
    const sent = s.brevo.send.mock.calls[0][0];
    expect(sent.to).toEqual({ email: 'ana@example.test', name: 'Ana' });
    expect(sent.html).toContain(invite.link);
    expect(sent.subject).toBeTruthy();
  });

  it('answers the blocked reason for an address outside the allowlist', async () => {
    const s = sender();

    expect(await sendDirect(s, mail('ana@elsewhere.test'))).toBe('not_allowed');
    expect(s.brevo.send).not.toHaveBeenCalled();
  });
});

// @traces 1379-FR-004 1379-FR-008
describe('sendDirect, once and never late', () => {
  it('answers stale and calls nothing for a job older than the wait cap', async () => {
    const s = sender();
    const old = Date.now() - DIRECT_SEND_WAIT_MS - 1;

    expect(await sendDirect(s, job('whatsapp', {}, old))).toBe('stale');
    expect(await sendDirect(s, job('email', {}, old))).toBe('stale');
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
    expect(s.brevo.send).not.toHaveBeenCalled();
  });

  it('fails the job with the provider’s reason after exactly one call', async () => {
    const s = sender(async () => {
      throw new BrevoError('provider_timeout', true);
    });

    await expect(sendDirect(s, job('whatsapp'))).rejects.toThrow(
      /^provider_timeout$/,
    );
    expect(s.brevo.sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('fails with provider_error for anything but a provider refusal', async () => {
    const s = sender(undefined, async () => {
      throw new Error('socket hang up to ana@example.test');
    });

    await expect(
      sendDirect(
        s,
        job('email', {
          template: 'STAFF_INVITE.mechanic',
          to: 'ana@example.test',
          values: invite,
        }),
      ),
    ).rejects.toThrow(/^provider_error$/);
    expect(s.brevo.send).toHaveBeenCalledTimes(1);
  });
});
