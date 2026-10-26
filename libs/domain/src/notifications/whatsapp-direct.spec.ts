import { type Brevo, BrevoError } from './brevo/brevo';
import { testPhoneConfig } from './notifications.testing';
import { sendWhatsAppDirect } from './whatsapp-direct';

const TO = '+40722123456';
const values = {
  car: 'Dacia Logan',
  days: 7,
  link: 'https://motorfix.example/ro/transfer/abc',
};

function sender(send: Brevo['sendWhatsApp']) {
  const sendWhatsApp = jest.fn(send);
  return {
    brevo: { sendWhatsApp } as unknown as Brevo,
    config: testPhoneConfig({
      PHONE_ALLOWLIST: '+407*',
      WHATSAPP_TEMPLATES:
        'motorfix_car_transfer_link_ro=41,motorfix_car_transfer_link_en=42',
    }),
    sendWhatsApp,
  };
}

// @traces 415-car-transfer-link-FR-006
describe('sendWhatsAppDirect', () => {
  it('sends the rendered template through the provider and answers null', async () => {
    const s = sender(async () => 'wa-1');

    const kind = await sendWhatsAppDirect(
      s,
      'CAR_TRANSFER_LINK',
      'ro',
      values,
      TO,
    );

    expect(kind).toBeNull();
    expect(s.sendWhatsApp).toHaveBeenCalledWith({
      params: ['Dacia Logan', values.link, '7'],
      sender: s.config.whatsappSender,
      templateId: 41,
      to: TO,
    });
  });

  it('picks the template of the language', async () => {
    const s = sender(async () => 'wa-1');

    await sendWhatsAppDirect(s, 'CAR_TRANSFER_LINK', 'en', values, TO);

    expect(s.sendWhatsApp.mock.calls[0][0].templateId).toBe(42);
  });

  it('answers template_missing for a template the configuration does not name', async () => {
    const s = sender(async () => 'wa-1');
    s.config.whatsappTemplates = {};

    expect(
      await sendWhatsAppDirect(s, 'CAR_TRANSFER_LINK', 'ro', values, TO),
    ).toBe('template_missing');
    expect(s.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('answers not_allowed for a number outside the allowlist', async () => {
    const s = sender(async () => 'wa-1');

    expect(
      await sendWhatsAppDirect(
        s,
        'CAR_TRANSFER_LINK',
        'ro',
        values,
        '+40622123456',
      ),
    ).toBe('not_allowed');
    expect(s.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('answers sending_off while sending is off', async () => {
    const s = sender(async () => 'wa-1');
    s.config.sending = false;

    expect(
      await sendWhatsAppDirect(s, 'CAR_TRANSFER_LINK', 'ro', values, TO),
    ).toBe('sending_off');
  });

  it('answers the provider’s reason, or provider_error for anything else', async () => {
    const refused = sender(async () => {
      throw new BrevoError('invalid_parameter', false);
    });
    const broken = sender(async () => {
      throw new Error('socket hang up');
    });

    expect(
      await sendWhatsAppDirect(refused, 'CAR_TRANSFER_LINK', 'ro', values, TO),
    ).toBe('invalid_parameter');
    expect(
      await sendWhatsAppDirect(broken, 'CAR_TRANSFER_LINK', 'ro', values, TO),
    ).toBe('provider_error');
  });
});
