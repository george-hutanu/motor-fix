import type { Template } from '../templates';

// A contact form message, to the support mailbox: always in Romanian, the
// sender's own language given as a line. Replies go to the sender.
export const SUPPORT_MESSAGE: Template = {
  audience: 'admin',
  email: {
    en: {
      button: { label: 'Open the contact page', link: 'contact' },
      lines: [
        'A new message through the contact form.',
        'From: {name} ({email})',
        'Role: {role}',
        'Language: {language}',
        'About the request or booking: {subjectRef}',
        'Message: {message}',
        'Reply to this e-mail to write to the sender directly.',
      ],
      reason:
        'You get this e-mail because this is the MotorFix support address.',
      subject: '[{reference}] {topic}: {name}',
    },
    ro: {
      button: { label: 'Deschide pagina de contact', link: 'contact' },
      lines: [
        'Mesaj nou prin formularul de contact.',
        'De la: {name} ({email})',
        'Rol: {role}',
        'Limba: {language}',
        'Despre cererea sau programarea: {subjectRef}',
        'Mesajul: {message}',
        'Răspunde la acest e-mail ca să-i scrii direct expeditorului.',
      ],
      reason:
        'Primești acest e-mail pentru că aceasta este adresa de suport MotorFix.',
      subject: '[{reference}] {topic}: {name}',
    },
  },
  example: {
    contact: 'https://motorfix.example/ro/contact',
    email: 'ana@example.test',
    language: 'română',
    message: 'Nu pot vedea cererea trimisă ieri.',
    name: 'Ana Pop',
    reference: 'MF-2026-000001',
    role: 'șofer',
    subjectRef: '—',
    topic: 'Contul meu',
  },
  values: {
    contact: 'link',
    email: 'text',
    language: 'text',
    message: 'text',
    name: 'text',
    reference: 'text',
    role: 'text',
    subjectRef: 'text',
    topic: 'text',
  },
};

// To the sender, in their language: the reference, when to expect the
// answer, and a copy of what they wrote. Always sent.
export const SUPPORT_ACKNOWLEDGEMENT: Template = {
  audience: 'any',
  email: {
    en: {
      button: { label: 'Open the contact page', link: 'contact' },
      lines: [
        'We have your message. Its reference is {reference}.',
        '{promise}',
        'What you wrote: {message}',
        'To add something, send a new message from the contact page and give the reference.',
      ],
      reason: 'You get this e-mail because you wrote to MotorFix.',
      subject: 'We have your message ({reference})',
    },
    ro: {
      button: { label: 'Deschide pagina de contact', link: 'contact' },
      lines: [
        'Am primit mesajul tău. Numărul lui este {reference}.',
        '{promise}',
        'Ce ai scris: {message}',
        'Ca să adaugi ceva, trimite un mesaj nou din pagina de contact și scrie numărul.',
      ],
      reason: 'Primești acest e-mail pentru că ai scris echipei MotorFix.',
      subject: 'Am primit mesajul tău ({reference})',
    },
  },
  example: {
    contact: 'https://motorfix.example/ro/contact',
    message: 'Nu pot vedea cererea trimisă ieri.',
    promise: 'Îți răspundem în cel mult o zi lucrătoare.',
    reference: 'MF-2026-000001',
  },
  values: {
    contact: 'link',
    message: 'text',
    promise: 'text',
    reference: 'text',
  },
};

const TOPICS: Readonly<Record<string, string>> = {
  account: 'Contul meu',
  listing: 'Listarea service-ului',
  other: 'Altceva',
  request_or_booking: 'Cerere sau programare',
  reviews: 'Recenzii',
};

const ROLES: Readonly<Record<string, string>> = {
  admin: 'administrator',
  driver: 'șofer',
  garage: 'service',
  visitor: 'vizitator',
};

const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'engleză',
  ro: 'română',
};

// Line breaks, control and separator characters become one space, so the
// sender's name cannot add a line to a header.
const oneLine = (text: string) =>
  text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

interface StoredMessage {
  reference: string;
  name: string;
  email: string;
  role: string;
  topic: string;
  language: string;
  subjectRef: string | null;
  message: string;
}

// A code's label, or the code itself; an inherited key such as
// `constructor` is not a label.
const label = (labels: Readonly<Record<string, string>>, code: string) =>
  Object.hasOwn(labels, code) ? labels[code] : code;

// SUPPORT_MESSAGE's values, but for the contact link: the codes as the
// mailbox reads them, in Romanian.
export function supportMessageValues(message: StoredMessage) {
  return {
    email: message.email,
    language: label(LANGUAGES, message.language),
    message: message.message,
    name: oneLine(message.name),
    reference: message.reference,
    role: label(ROLES, message.role),
    subjectRef: oneLine(message.subjectRef ?? '') || '—',
    topic: label(TOPICS, message.topic),
  };
}
