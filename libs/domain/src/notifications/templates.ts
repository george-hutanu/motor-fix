import {
  CANCEL_REASON_TEXTS,
  DECLINE_REASON_TEXTS,
  isDeclineReason,
  REVIEW_REPORT_REASON_TEXTS,
} from '@motor-fix/contracts';
import {
  formatClock,
  formatDay,
  formatLei,
  formatLeiRange,
  formatMonthYear,
  formatNum,
} from '@motor-fix/i18n/formats';

import { emailHtml } from './email-layout';
import { REPORT_DECISION_SET } from './templates/garage-report-decided';
import { TEMPLATES } from './templates/registry';
import { DECISIONS } from './templates/verification-result';

type Language = 'ro' | 'en';
export type Channel = 'email' | 'bell' | 'push' | 'sms' | 'whatsapp';
type Format =
  | 'text'
  | 'link'
  | 'count'
  | 'num'
  | 'lei'
  | 'when'
  | 'day'
  | 'date'
  | 'days'
  | 'reason'
  | 'cancel_reason'
  | 'report_reason'
  | 'score';

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
  // A value the body shortens with "…" when it would run past its limit,
  // such as a name a person typed; the bell and the e-mail carry it whole.
  shorten?: string;
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
  // Its e-mail used to be the generic one: a row stored before its values
  // existed still gets that, rather than failing.
  genericEmailWhenMissing?: true;
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
const SEGMENT = ' · ';

// Romanian numerals ending in 20–99 or 00 take "de": "20 de oferte".
function count(value: unknown, language: Language): string {
  const text = formatNum(value, language);
  if (language === 'en' || typeof value !== 'number' || value === 0) {
    return text;
  }
  const rest = Math.abs(value) % 100;
  return rest === 0 || rest >= 20 ? `${text} de` : text;
}

// A day comes as JSON text. 2026-02-30 parses as 2 March, so a date-only
// value must name its own day.
function realDay(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length !== 10) return true;
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

// The days left as when it falls: "astăzi", "peste o zi", "peste 7 zile",
// "peste 30 de zile". Days already past are no due date.
function days(value: unknown, language: Language): string {
  if (typeof value !== 'number' || value < 0) {
    throw new Error(`not days left: ${String(value)}`);
  }
  if (value === 0) return language === 'en' ? 'today' : 'astăzi';
  if (language === 'en')
    return `in ${formatNum(value, language)} ${value === 1 ? 'day' : 'days'}`;
  return value === 1 ? 'peste o zi' : `peste ${count(value, language)} zile`;
}

// A calendar day with its month in full: "13 noiembrie 2026".
function longDay(value: unknown, language: Language): string {
  const month = formatMonthYear(value, language);
  if (month === '—') throw new Error(`not a day: ${String(value)}`);
  return `${Number(String(value).slice(8))} ${month}`;
}

// A decline's reason code reads as the clause after the garage's name; a
// driver's cancel reason as the label the driver picked.
function reasonText(
  kind: 'reason' | 'cancel_reason',
  value: unknown,
  language: Language,
): string {
  if (kind === 'reason') {
    if (!isDeclineReason(value)) {
      throw new Error(`unknown decline reason ${String(value)}`);
    }
    return DECLINE_REASON_TEXTS[value].clause[language];
  }
  if (!Object.hasOwn(CANCEL_REASON_TEXTS, String(value))) {
    throw new Error(`unknown cancel reason ${String(value)}`);
  }
  return CANCEL_REASON_TEXTS[value as keyof typeof CANCEL_REASON_TEXTS].label[
    language
  ];
}

// A review report's reason as the admins read it.
function reportReason(value: unknown, language: Language): string {
  if (!Object.hasOwn(REVIEW_REPORT_REASON_TEXTS, String(value))) {
    throw new Error(`unknown report reason ${String(value)}`);
  }
  return REVIEW_REPORT_REASON_TEXTS[
    value as keyof typeof REVIEW_REPORT_REASON_TEXTS
  ][language];
}

// A review's score with one decimal, as the stars show it.
function scoreText(value: unknown, language: Language): string {
  const score = Number(value);
  if (!Number.isFinite(score)) throw new Error(`not a score: ${value}`);
  const text = score.toFixed(1);
  return language === 'ro' ? text.replace('.', ',') : text;
}

function format(kind: Format, value: unknown, language: Language): string {
  switch (kind) {
    case 'count':
      return count(value, language);
    case 'days':
      return days(value, language);
    case 'date':
      return longDay(value, language);
    case 'num':
      return formatNum(value, language);
    case 'lei':
      return Array.isArray(value)
        ? formatLeiRange(value[0], value[1], language)
        : formatLei(value, language);
    // A calendar date, such as a due date: the day alone. A value that is no
    // real day fails, so the bell falls back to its generic text.
    case 'day': {
      const text = formatDay(value, language);
      if (text === '—' || !realDay(value)) {
        throw new Error(`not a day: ${String(value)}`);
      }
      return text;
    }
    case 'when': {
      const day = formatDay(value, language);
      return day === '—' ? day : `${day}, ${formatClock(value)}`;
    }
    case 'reason':
    case 'cancel_reason':
      return reasonText(kind, value, language);
    case 'report_reason':
      return reportReason(value, language);
    case 'score':
      return scoreText(value, language);
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
  const older =
    channel === 'email' &&
    template.genericEmailWhenMissing &&
    Object.keys(template.values).some((key) => params[key] == null);
  if (older) return render('GENERIC', channel, languageCode, params, registry);
  return renderText(channel, text, fill, value, language, fail) as Rendered[C];
}

// An e-mail link is only ever https, or http on the developer's own machine;
// anything else (javascript:, data:, a relative path) fails the render.
function safeHref(
  href: string,
  which: 'button' | 'stop',
  fail: (reason: string) => never,
): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return fail(`${which} link is not a URL`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local))
    return href;
  return fail(`${which} link must be https (http only on localhost)`);
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
      // A subject is one line, whatever a filled-in name holds.
      const subject = fill(mail.subject).replace(/[\r\n]+/g, ' ');
      // A line made of an optional value alone, such as a note, is left out
      // when that value is empty.
      const lines = mail.lines.map(fill).filter((line) => line !== '');
      const button = {
        href: safeHref(value(mail.button.link), 'button', fail),
        label: fill(mail.button.label),
      };
      const reason = fill(mail.reason);
      const stop = mail.stop && {
        href: safeHref(value(mail.stop.link), 'stop', fail),
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
      const body = pushBody(push, fill, value);
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
    case 'bell':
      return bellLine(text as string, fill);
    default:
      return fill(text as string);
  }
}

// A bell line is segments joined by " · "; a segment whose value is empty,
// such as a note the driver did not write, is left out with its separator.
function bellLine(source: string, fill: (source: string) => string): string {
  return source
    .split(SEGMENT)
    .map(fill)
    .filter((part) => part !== '')
    .join(SEGMENT);
}

// The push body, its `shorten` value cut at a whole character and closed
// with "…" when the body would pass its limit, counted in UTF-16 units as
// the limit is.
function pushBody(
  push: PushText,
  fill: (source: string) => string,
  value: (key: string) => string,
): string {
  const body = fill(push.body);
  const key = push.shorten;
  if (body.length <= PUSH_BODY || !key) return body;
  const fillWith = (text: string) =>
    push.body.replace(PLACEHOLDER, (_, name: string) =>
      name === key ? text : value(name),
    );
  let room = PUSH_BODY - fillWith('…').length;
  let short = '';
  for (const character of value(key)) {
    room -= character.length;
    if (room < 0) break;
    short += character;
  }
  return fillWith(`${short}…`);
}

// The kinds whose wording follows a param: one text per value it names,
// the kind's own text for any other.
const BY_PARAM: Record<string, [param: string, values: ReadonlySet<unknown>]> =
  {
    ADMIN_REVIEW_REPORTED: [
      'variant',
      new Set(['reply', 'automatic', 'reminder', 'reminder_reply']),
    ],
    ADMIN_VERIFICATION_QUEUED: ['item', new Set(['documents'])],
    BOOKING_CANCELLED: ['variant', new Set(['driver', 'driver_late'])],
    GARAGE_REPORT_DECIDED: ['decision', REPORT_DECISION_SET],
    REQUEST_CANCELLED: ['reason', new Set(['account_closed'])],
    VERIFICATION_RESULT: ['decision', DECISIONS],
  };

// A type with two texts: the param's one value picks the first, any other
// value the second.
const TWO_WAY = new Map<string, [param: string, first: string, second: string]>(
  [
    ['ADMIN_OUTAGE_ALERT', ['state', 'back', 'down']],
    ['BOOKING_LAPSED', ['side', 'garage', 'driver']],
    ['CATALOGUE_JOB_DECIDED', ['decision', 'approved', 'rejected']],
    ['QUOTE_EXPIRED', ['side', 'garage', 'driver']],
    ['REPAIR_UPDATED', ['by', 'admin', 'garage']],
    ['REQUEST_EXPIRED', ['side', 'garage', 'driver']],
    ['REVIEW_POSTED', ['source', 'profile', 'job']],
  ],
);

// The last e-mail to a deleted account, to the address it held: the one
// message a deleted account still gets.
export const farewell = (kind: string, params: Params) =>
  kind === 'ACCOUNT_EMAIL' &&
  params['purpose'] === 'account_deleted' &&
  typeof params['to'] === 'string';

export function templateName(kind: string, params: Params): string {
  const twoWay = TWO_WAY.get(kind);
  if (twoWay) {
    const [param, first, second] = twoWay;
    return `${kind}.${params[param] === first ? first : second}`;
  }
  const byParam = BY_PARAM[kind];
  if (byParam) {
    const value = params[byParam[0]];
    return byParam[1].has(value) ? `${kind}.${value}` : kind;
  }
  return kind === 'ACCOUNT_EMAIL' ? accountEmailName(params) : kind;
}

const ACCOUNT_PURPOSES = new Set([
  'password_reset',
  'password_changed',
  'email_change_notice',
  'account_deleted',
  'account_suspended',
]);

// A suspension with no support address set names none.
function accountEmailName(params: Params): string {
  const purpose = params['purpose'];
  if (purpose === 'account_suspended' && typeof params['support'] !== 'string')
    return 'ACCOUNT_EMAIL.account_suspended_contact';
  return typeof purpose === 'string' && ACCOUNT_PURPOSES.has(purpose)
    ? `ACCOUNT_EMAIL.${purpose}`
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
