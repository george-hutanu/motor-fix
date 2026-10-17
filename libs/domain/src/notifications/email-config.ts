import type { AppEnv } from '@motor-fix/contracts';
import { EMAIL_PATTERN } from '@motor-fix/contracts/email';
import { publicWebUrl } from '@motor-fix/contracts/env';
import { Logger } from '@nestjs/common';

export interface EmailConfig {
  sending: boolean;
  production: boolean;
  // Lower-cased addresses and "@domain" entries.
  allowlist: string[];
  from: { email: string; name: string };
  // The one domain all mail comes from, lower-cased.
  domain?: string;
  // The support address, where a reply to any automatic e-mail goes.
  replyTo?: { email: string; name: string };
  apiKey?: string;
  apiUrl: string;
  webhookSecret?: string;
  // The web app, which every e-mail's button opens.
  webUrl?: string;
}

type BlockedReason = 'sending_off' | 'not_allowed';

const FROM = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/;
// Two labels at least: no scheme, path, port, @ or space.
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type Source = Record<string, string | undefined>;

// EMAIL_DOMAIN when it is a hostname, else none.
export function sendingDomain(source: Source): string | undefined {
  const value = source['EMAIL_DOMAIN']?.trim().toLowerCase() ?? '';
  return HOSTNAME.test(value) ? value : undefined;
}

// SUPPORT_EMAIL on any domain, else support at the sending domain.
export function supportAddress(source: Source): string | undefined {
  const email = source['SUPPORT_EMAIL']?.trim() ?? '';
  if (EMAIL_PATTERN.test(email)) return email;
  const domain = sendingDomain(source);
  return domain ? `support@${domain}` : undefined;
}

function domainSetting(source: Source, sending: boolean): string | undefined {
  const domain = sendingDomain(source);
  if (domain || !source['EMAIL_DOMAIN']?.trim()) return domain;
  const problem = 'EMAIL_DOMAIN must be a domain name such as mail.example.ro';
  if (sending) throw new Error(problem);
  new Logger('Email').warn(`${problem}: read as unset`);
  return undefined;
}

function sender(
  value = '',
  sending: boolean,
  domain?: string,
): EmailConfig['from'] {
  if (!value.trim() && domain) {
    return { email: `no-reply@${domain}`, name: 'MotorFix' };
  }
  const named = FROM.exec(value);
  const from = named
    ? { email: named[2], name: named[1] || 'MotorFix' }
    : { email: value.trim(), name: 'MotorFix' };
  if (sending && from.email && !from.email.includes('@')) {
    throw new Error('EMAIL_FROM must be an address or Name <address>');
  }
  const host = from.email.slice(from.email.lastIndexOf('@') + 1);
  if (sending && domain && host.toLowerCase() !== domain) {
    throw new Error(`EMAIL_FROM must be an address at EMAIL_DOMAIN ${domain}`);
  }
  return from;
}

// Read as the web server reads it. A value that is not a URL would put a
// broken link in every e-mail, so it leaves no address and the worker
// refuses its queue instead of stopping the process.
function webUrl(source: Source): string | undefined {
  try {
    return publicWebUrl(source)?.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function emailConfig(appEnv: AppEnv, source: Source): EmailConfig {
  const switchValue = source['EMAIL_SENDING'] || 'off';
  if (switchValue !== 'on' && switchValue !== 'off') {
    throw new Error('EMAIL_SENDING must be on or off');
  }
  const sending = switchValue === 'on';
  const domain = domainSetting(source, sending);
  const support = supportAddress(source);
  return {
    allowlist: (source['EMAIL_ALLOWLIST'] ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    apiKey: source['BREVO_API_KEY'] || undefined,
    // Only tests set it, to point at the recorded mock.
    apiUrl: source['BREVO_API_URL'] || 'https://api.brevo.com/v3',
    ...(domain ? { domain } : {}),
    from: sender(source['EMAIL_FROM'], sending, domain),
    production: appEnv === 'production',
    ...(support ? { replyTo: { email: support, name: 'MotorFix' } } : {}),
    sending,
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

// Sender, reply-to and, for a row with a one-click link (only news), the
// headers mail apps turn into their own unsubscribe button (RFC 8058).
export function emailEnvelope(
  config: EmailConfig,
  to: { email: string; name?: string },
  params: Readonly<Record<string, unknown>> = {},
) {
  const link = params['oneClick'];
  return {
    from: config.from,
    ...(typeof link === 'string'
      ? {
          headers: {
            'List-Unsubscribe': `<${link}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    to,
  };
}
