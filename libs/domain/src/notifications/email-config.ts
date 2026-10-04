import type { AppEnv } from '@motor-fix/contracts';

export interface EmailConfig {
  sending: boolean;
  production: boolean;
  // Lower-cased addresses and "@domain" entries.
  allowlist: string[];
  from: { email: string; name: string };
  apiKey?: string;
  apiUrl: string;
  webhookSecret?: string;
}

export type BlockedReason = 'sending_off' | 'not_allowed';

const FROM = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/;

function sender(value = ''): EmailConfig['from'] {
  const named = FROM.exec(value);
  return named
    ? { email: named[2], name: named[1] || 'MotorFix' }
    : { email: value.trim(), name: 'MotorFix' };
}

export function emailConfig(
  appEnv: AppEnv,
  source: Record<string, string | undefined>,
): EmailConfig {
  const switchValue = source['EMAIL_SENDING'] || 'off';
  if (switchValue !== 'on' && switchValue !== 'off') {
    throw new Error('EMAIL_SENDING must be on or off');
  }
  return {
    allowlist: (source['EMAIL_ALLOWLIST'] ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    apiKey: source['BREVO_API_KEY'] || undefined,
    apiUrl: source['BREVO_API_URL'] || 'https://api.brevo.com/v3',
    from: sender(source['EMAIL_FROM']),
    production: appEnv === 'production',
    sending: switchValue === 'on',
    webhookSecret: source['BREVO_WEBHOOK_SECRET'] || undefined,
  };
}

export function blockedReason(
  config: EmailConfig,
  address: string,
): BlockedReason | null {
  if (!config.sending) return 'sending_off';
  if (config.production) return null;
  const email = address.toLowerCase();
  const domain = email.slice(email.lastIndexOf('@'));
  return config.allowlist.includes(email) || config.allowlist.includes(domain)
    ? null
    : 'not_allowed';
}
