import { NOTIFICATION_TYPES } from './catalogue';
import {
  CHANNELS,
  type Channel,
  type Registry,
  render,
  type Template,
  TemplateError,
  type WhatsAppText,
} from './templates';

const LANGUAGES = ['en', 'ro'] as const;
const CEDILLA = /[ŞşŢţ]/;
const EXAMPLE_APP = 'https://motorfix.example';

const strings = (text: unknown): string[] =>
  typeof text === 'string'
    ? [text]
    : Object.values(text as object).flatMap(strings);

// A driver may see their own plate; only the garage's day sheet carries
// other people's. No message carries a phone number.
function privacy(name: string, type: string, template: Template): string[] {
  const problems: string[] = [];
  const uses = (value: string) => Object.hasOwn(template.values, value);
  if (uses('plate') && template.audience !== 'driver' && type !== 'DAY_SHEET') {
    problems.push(`${name}: plate in a template for a non-driver`);
  }
  if (uses('phone')) problems.push(`${name}: phone number in a template`);
  return problems;
}

function whatsapp(at: string, text: WhatsAppText): string[] {
  const problems = text.name.trim() ? [] : [`${at}: no approved template name`];
  text.slots.forEach((slot, i) => {
    if (!slot.trim()) problems.push(`${at}: empty slot ${i + 1}`);
  });
  return problems;
}

// Renders with the example values, which also proves every placeholder is
// declared and every length limit holds.
function rendering(
  name: string,
  template: Template,
  channel: Channel,
  language: 'en' | 'ro',
): string | null {
  try {
    render(
      name,
      channel,
      language,
      { ...template.example, app: EXAMPLE_APP },
      { [name]: template },
    );
    return null;
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    return error.reason;
  }
}

function texts(name: string, template: Template, channel: Channel): string[] {
  const problems: string[] = [];
  for (const language of LANGUAGES) {
    const text = template[channel]?.[language];
    if (text === undefined) {
      problems.push(`${name} ${channel}: no ${language} text`);
      continue;
    }
    const at = `${name} ${channel} ${language}`;
    if (strings(text).some((s) => CEDILLA.test(s))) {
      problems.push(`${at}: ş or ţ with a cedilla`);
    }
    if (channel === 'whatsapp') {
      problems.push(...whatsapp(at, text as WhatsAppText));
    }
    const failure = rendering(name, template, channel, language);
    if (failure) problems.push(`${at}: ${failure}`);
  }
  return problems;
}

// Run by template-check.spec.ts in the unit suite, so a template that breaks
// a content rule fails CI. Answers one line per problem, none when clean.
export function checkTemplates(registry: Registry): string[] {
  const problems: string[] = [];
  for (const [name, template] of Object.entries(registry)) {
    const type = name.split('.')[0];
    if (type !== 'GENERIC' && !Object.hasOwn(NOTIFICATION_TYPES, type)) {
      problems.push(`${name}: not a notification type`);
      continue;
    }
    problems.push(...privacy(name, type, template));
    for (const channel of CHANNELS) {
      if (template[channel]) problems.push(...texts(name, template, channel));
    }
  }
  return problems;
}
