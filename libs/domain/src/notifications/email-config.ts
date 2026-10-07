import type { AppEnv } from '@motor-fix/contracts';
import { publicWebUrl } from '@motor-fix/contracts/env';

export interface EmailConfig {
  sending: boolean;
  production: boolean;
  // Lower-cased addresses and "@domain" entries.
  allowlist: string[];
  from: { email: string; name: string };
  apiKey?: string;
  apiUrl: string;
  webhookSecret?: string;
  // The web app, which every e-mail's button opens.
  webUrl?: string;
}

type BlockedReason = 'sending_off' | 'not_allowed';

const FROM = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/;

function sender(value = '', sending = false): EmailConfig['from'] {
  const named = FROM.exec(value);
  const from = named
    ? { email: named[2], name: named[1] || 'MotorFix' }
    : { email: value.trim(), name: 'MotorFix' };
  if (sending && from.email && !from.email.includes('@')) {
    throw new Error('EMAIL_FROM must be an address or Name <address>');
  }
  return from;
}

// Read as the web server reads it. A value that is not a URL would put a
// broken link in every e-mail, so it leaves no address and the worker
// refuses its queue instead of stopping the process.
function webUrl(
  source: Record<string, string | undefined>,
): string | undefined {
  try {
    return publicWebUrl(source)?.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
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
    // Only tests set it, to point at the recorded mock.
    apiUrl: source['BREVO_API_URL'] || 'https://api.brevo.com/v3',
    from: sender(source['EMAIL_FROM'], switchValue === 'on'),
    production: appEnv === 'production',
    sending: switchValue === 'on',
    webhookSecret: source['BREVO_WEBHOOK_SECRET'] || undefined,
    webUrl: webUrl(source),
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
