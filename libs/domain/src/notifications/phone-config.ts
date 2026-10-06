import { type AppEnv, E164 } from '@motor-fix/contracts';

export const PHONE_CONFIG = Symbol('PHONE_CONFIG');

// SMS and WhatsApp, both through Brevo with the e-mail's API key.
export interface PhoneConfig {
  sending: boolean;
  production: boolean;
  // E.164 numbers, or prefixes ending in * (+4070000*); outside production
  // only these are sent to.
  allowlist: string[];
  smsSender: string;
  whatsappSender: string;
  // Template name → Brevo template id, for the templates WhatsApp approved.
  whatsappTemplates: Readonly<Record<string, number>>;
}

const ENTRY = /^([\w.-]+)=(\d+)$/;
const PREFIX = /^\+[1-9]\d{0,14}\*$/;

function numbers(value = ''): string[] {
  const list = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (list.some((entry) => !E164.test(entry) && !PREFIX.test(entry))) {
    throw new Error('PHONE_ALLOWLIST must be E.164 numbers');
  }
  return list;
}

function templates(value = ''): Record<string, number> {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [, name, id] = ENTRY.exec(entry) ?? [];
      if (!name) throw new Error('WHATSAPP_TEMPLATES must be name=id pairs');
      return [name, Number(id)] as const;
    });
  return Object.fromEntries(entries);
}

export function phoneConfig(
  appEnv: AppEnv,
  source: Record<string, string | undefined>,
): PhoneConfig {
  const switchValue = source['PHONE_SENDING'] || 'off';
  if (switchValue !== 'on' && switchValue !== 'off') {
    throw new Error('PHONE_SENDING must be on or off');
  }
  const whatsappSender = (source['WHATSAPP_SENDER'] ?? '').trim();
  if (switchValue === 'on' && !whatsappSender) {
    throw new Error('WHATSAPP_SENDER must be set when PHONE_SENDING=on');
  }
  return {
    allowlist: numbers(source['PHONE_ALLOWLIST']),
    production: appEnv === 'production',
    sending: switchValue === 'on',
    smsSender: source['SMS_SENDER'] || 'MotorFix',
    whatsappSender,
    whatsappTemplates: templates(source['WHATSAPP_TEMPLATES']),
  };
}

export function phoneBlockedReason(
  config: PhoneConfig,
  phone: string,
): 'sending_off' | 'not_allowed' | null {
  if (!config.sending) return 'sending_off';
  if (config.production) return null;
  const allowed = config.allowlist.some((entry) =>
    entry.endsWith('*')
      ? phone.startsWith(entry.slice(0, -1))
      : entry === phone,
  );
  return allowed ? null : 'not_allowed';
}
