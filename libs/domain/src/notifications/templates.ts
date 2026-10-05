import {
  formatClock,
  formatDay,
  formatLei,
  formatLeiRange,
  formatNum,
} from '@motor-fix/i18n/formats';

import { emailHtml } from './email-layout';
import { TEMPLATES } from './templates/registry';

type Language = 'ro' | 'en';
export type Channel = 'email' | 'bell' | 'push' | 'sms' | 'whatsapp';
type Format = 'text' | 'link' | 'count' | 'num' | 'lei' | 'when';

interface EmailText {
  subject: string;
  lines: readonly string[];
  // `link` names the value the button opens.
  button: { label: string; link: string };
  reason: string;
  // A stop link under the reason, for mail the person may refuse.
  stop?: { label: string; link: string };
}

interface PushText {
  title: string;
  body: string;
  link: string;
}

export interface WhatsAppText {
  name: string;
  slots: readonly string[];
}

type Texts<T> = Partial<Record<Language, T>>;

export interface Template {
  audience: 'driver' | 'garage' | 'mechanic' | 'admin' | 'any';
  values: Readonly<Record<string, Format>>;
  // Values the template check renders every channel with.
  example: Readonly<Record<string, unknown>>;
  email?: Texts<EmailText>;
  bell?: Texts<string>;
  push?: Texts<PushText>;
  sms?: Texts<string>;
  whatsapp?: Texts<WhatsAppText>;
}

interface Rendered {
  email: { subject: string; text: string; html: string };
  bell: string;
  push: PushText;
  sms: string;
  whatsapp: { name: string; params: string[] };
}

type Params = Readonly<Record<string, unknown>>;
export type Registry = Readonly<Record<string, Template>>;

export class TemplateError extends Error {
  constructor(
    readonly template: string,
    readonly channel: Channel,
    readonly reason: string,
  ) {
    super(`template ${template} ${channel}: ${reason}`);
  }
}

export const CHANNELS: readonly Channel[] = [
  'email',
  'bell',
  'push',
  'sms',
  'whatsapp',
];

// The worker offers the web app's address to every template.
const BUILT_IN: Readonly<Record<string, Format>> = { app: 'link' };
const PUSH_TITLE = 50;
const PUSH_BODY = 120;
// Romanian diacritics force UCS-2, whose single SMS holds 70 characters.
const SMS = 70;
const PLACEHOLDER = /\{(\w*)\}/g;

// Romanian numerals ending in 20–99 or 00 take "de": "20 de oferte".
function count(value: unknown, language: Language): string {
  const text = formatNum(value, language);
  if (language === 'en' || typeof value !== 'number' || value === 0) {
    return text;
  }
  const rest = Math.abs(value) % 100;
  return rest === 0 || rest >= 20 ? `${text} de` : text;
}

function format(kind: Format, value: unknown, language: Language): string {
  switch (kind) {
    case 'count':
      return count(value, language);
    case 'num':
      return formatNum(value, language);
    case 'lei':
      return Array.isArray(value)
        ? formatLeiRange(value[0], value[1], language)
        : formatLei(value, language);
    case 'when': {
      const day = formatDay(value, language);
      return day === '—' ? day : `${day}, ${formatClock(value)}`;
    }
    default:
      return String(value);
  }
}

// A type with no e-mail or bell text yet sends the generic one.
function pick(registry: Registry, name: string, channel: Channel) {
  if (registry[name]?.[channel]) return registry[name];
  if (channel !== 'email' && channel !== 'bell') return undefined;
  return registry[name.endsWith('.grouped') ? 'GENERIC.grouped' : 'GENERIC'];
}

// Only the template's own values and the built-in ones; never an inherited
// property such as `constructor`.
function declared(template: Template, key: string): Format | undefined {
  if (Object.hasOwn(template.values, key)) return template.values[key];
  return Object.hasOwn(BUILT_IN, key) ? BUILT_IN[key] : undefined;
}

export function render<C extends Channel>(
  name: string,
  channel: C,
  languageCode: string,
  params: Params,
  registry: Registry = TEMPLATES,
): Rendered[C] {
  const language: Language = languageCode === 'en' ? 'en' : 'ro';
  const fail = (reason: string): never => {
    throw new TemplateError(name, channel, reason);
  };
  const template = pick(registry, name, channel) ?? fail('no template');
  const text = template[channel]?.[language] ?? fail(`no ${language} text`);
  const value = (key: string) => {
    const kind =
      declared(template, key) ??
      fail(key ? `undeclared value ${key}` : 'no link');
    const given = Object.hasOwn(params, key) ? params[key] : undefined;
    if (given === undefined || given === null) fail(`missing value ${key}`);
    return format(kind, given, language);
  };
  const fill = (source: string) =>
    source.replace(PLACEHOLDER, (_, key: string) => value(key));
  return renderText(channel, text, fill, value, language, fail) as Rendered[C];
}

function renderText(
  channel: Channel,
  text: unknown,
  fill: (source: string) => string,
  value: (key: string) => string,
  language: Language,
  fail: (reason: string) => never,
): Rendered[Channel] {
  switch (channel) {
    case 'email': {
      const mail = text as EmailText;
      const subject = fill(mail.subject);
      const lines = mail.lines.map(fill);
      const button = {
        href: value(mail.button.link),
        label: fill(mail.button.label),
      };
      const reason = fill(mail.reason);
      const stop = mail.stop && {
        href: value(mail.stop.link),
        label: fill(mail.stop.label),
      };
      return {
        html: emailHtml({ button, language, lines, reason, stop, subject }),
        subject,
        text: [
          ...lines,
          `${button.label}: ${button.href}`,
          '—',
          reason,
          ...(stop ? [`${stop.label}: ${stop.href}`] : []),
        ].join('\n\n'),
      };
    }
    case 'push': {
      const push = text as PushText;
      const title = fill(push.title);
      const body = fill(push.body);
      const link = value(push.link);
      if (title.length > PUSH_TITLE) fail('push title over 50 characters');
      if (body.length > PUSH_BODY) fail('push body over 120 characters');
      return { body, link, title };
    }
    case 'sms': {
      const sms = fill(text as string);
      if (sms.length > SMS) fail('sms over 70 characters');
      return sms;
    }
    case 'whatsapp': {
      const whatsapp = text as WhatsAppText;
      return { name: whatsapp.name, params: whatsapp.slots.map(fill) };
    }
    default:
      return fill(text as string);
  }
}

export function templateName(kind: string, params: Params): string {
  if (kind !== 'ACCOUNT_EMAIL') return kind;
  return params['purpose'] === 'password_reset'
    ? 'ACCOUNT_EMAIL.password_reset'
    : 'ACCOUNT_EMAIL.email_check';
}

// The bell never shows a half-written text: the generic one replaces it.
export function bellText(
  kind: string,
  language: string,
  params: Params,
  registry: Registry = TEMPLATES,
): string {
  // A bell row's params come from JSON, which may hold null.
  const values = params ?? {};
  try {
    return render(
      templateName(kind, values),
      'bell',
      language,
      values,
      registry,
    );
  } catch {
    return render('GENERIC', 'bell', language, {}, registry);
  }
}
