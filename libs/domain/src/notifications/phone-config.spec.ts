// @traces 392-FR-008
import { phoneBlockedReason, phoneConfig } from './phone-config';

const on = {
  PHONE_ALLOWLIST: ' +40700000001 , +40700000002,',
  PHONE_SENDING: 'on',
  WHATSAPP_SENDER: '+40700000099',
  WHATSAPP_TEMPLATES: 'motorfix_due_itp_ro=12, motorfix_due_itp_en=13',
};

describe('the phone sending config', () => {
  it('is off, with the MotorFix sender and no templates, when nothing is set', () => {
    expect(phoneConfig('development', {})).toEqual({
      allowlist: [],
      production: false,
      sending: false,
      smsSender: 'MotorFix',
      whatsappSender: '',
      whatsappTemplates: {},
    });
  });

  it('reads the switch, the allowlist, the senders and the template ids', () => {
    expect(phoneConfig('staging', { ...on, SMS_SENDER: 'MotorFixRO' })).toEqual(
      {
        allowlist: ['+40700000001', '+40700000002'],
        production: false,
        sending: true,
        smsSender: 'MotorFixRO',
        whatsappSender: '+40700000099',
        whatsappTemplates: { motorfix_due_itp_en: 13, motorfix_due_itp_ro: 12 },
      },
    );
  });

  it('refuses a switch that is neither on nor off', () => {
    expect(() => phoneConfig('development', { PHONE_SENDING: 'yes' })).toThrow(
      'PHONE_SENDING must be on or off',
    );
  });

  it.each([
    '0712345678',
    '+40 712 345 678',
  ])('refuses the allowlist entry %p, which is not E.164', (entry) => {
    expect(() =>
      phoneConfig('staging', { ...on, PHONE_ALLOWLIST: entry }),
    ).toThrow('PHONE_ALLOWLIST must be E.164 numbers');
  });

  it('refuses sending without a WhatsApp sender number', () => {
    expect(() =>
      phoneConfig('production', { ...on, WHATSAPP_SENDER: '' }),
    ).toThrow('WHATSAPP_SENDER must be set when PHONE_SENDING=on');
  });

  it.each([
    'motorfix_due_itp_ro',
    'motorfix_due_itp_ro=',
    'motorfix_due_itp_ro=abc',
    '=12',
  ])('refuses the template entry %p', (entry) => {
    expect(() =>
      phoneConfig('development', { WHATSAPP_TEMPLATES: entry }),
    ).toThrow('WHATSAPP_TEMPLATES must be name=id pairs');
  });
});

describe('who a message may be sent to', () => {
  it('nobody while sending is off', () => {
    expect(
      phoneBlockedReason(phoneConfig('production', {}), '+40700000001'),
    ).toBe('sending_off');
  });

  it('anyone in production', () => {
    expect(
      phoneBlockedReason(phoneConfig('production', on), '+40711111111'),
    ).toBeNull();
  });

  it('outside production, only the allowlisted numbers', () => {
    const config = phoneConfig('staging', on);
    expect(phoneBlockedReason(config, '+40700000002')).toBeNull();
    expect(phoneBlockedReason(config, '+40711111111')).toBe('not_allowed');
  });
});
