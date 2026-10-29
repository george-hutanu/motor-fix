import { codeForStatus } from '@motor-fix/contracts';
import { HttpException, Logger } from '@nestjs/common';

export type Language = 'ro' | 'en';

export interface ToolError {
  code: string;
  message: string;
  // What a use case adds for the assistant to act on, e.g. the garage's
  // mechanics beside `mechanic_not_found`.
  [detail: string]: unknown;
}

const MESSAGES: Record<string, Record<Language, string>> = {
  already_answered: {
    en: 'Someone has already answered this request.',
    ro: 'Altcineva a răspuns deja la această cerere.',
  },
  already_decided: {
    en: 'This has already been decided.',
    ro: 'Acest lucru a fost deja hotărât.',
  },
  approval_required: {
    en: 'Approve it in the MotorFix app.',
    ro: 'Aprobă în aplicația MotorFix.',
  },
  assistant_act_off: {
    en: 'The person allowed this assistant to read only; it cannot act for them.',
    ro: 'Persoana a permis acestui asistent doar să citească; nu poate acționa în numele ei.',
  },
  assistant_read_off: {
    en: 'The person did not allow this assistant to read their MotorFix data.',
    ro: 'Persoana nu a permis acestui asistent să citească datele sale din MotorFix.',
  },
  empty_day_sheet: {
    en: 'This mechanic has no jobs on this day.',
    ro: 'Mecanicul nu are lucrări în această zi.',
  },
  empty_requests: {
    en: 'There are no quote requests here.',
    ro: 'Nu există cereri de ofertă aici.',
  },
  empty_schedule: {
    en: 'There are no bookings in this period.',
    ro: 'Nu sunt programări în această perioadă.',
  },
  empty_stats: {
    en: 'There was no activity in this period.',
    ro: 'Nu a fost nicio activitate în această perioadă.',
  },
  forbidden: {
    en: 'The person is not allowed to do this.',
    ro: 'Persoana nu are dreptul să facă acest lucru.',
  },
  internal_error: {
    en: 'Something went wrong. Try again later.',
    ro: 'Ceva nu a mers. Încearcă din nou mai târziu.',
  },
  maintenance: {
    en: 'MotorFix is under maintenance; changes are paused. Reading still works.',
    ro: 'MotorFix este în mentenanță; modificările sunt oprite. Citirea funcționează în continuare.',
  },
  mechanic_not_found: {
    en: 'No single mechanic of this garage has that name. Ask which of the listed mechanics was meant.',
    ro: 'Niciun mecanic al service-ului nu are exact acest nume. Întreabă la care dintre mecanicii din listă te referi.',
  },
  no_mechanic: {
    en: 'No mechanic',
    ro: 'Fără mecanic',
  },
  not_found: {
    en: 'Not found.',
    ro: 'Nu a fost găsit.',
  },
  not_sent_arguments_changed: {
    en: 'Nothing was sent: the details changed since the person agreed. Ask them again with the new summary.',
    ro: 'Nu s-a trimis nimic: detaliile s-au schimbat de când persoana a fost de acord. Întreab-o din nou, cu noul rezumat.',
  },
  not_sent_expired: {
    en: 'Nothing was sent: the confirmation expired after 5 minutes. Ask the person again for a new summary.',
    ro: 'Nu s-a trimis nimic: confirmarea a expirat după 5 minute. Întreabă persoana din nou, cu un rezumat nou.',
  },
  not_sent_refused: {
    en: 'Nothing was sent: the person did not agree. Ask them again if they change their mind.',
    ro: 'Nu s-a trimis nimic: persoana nu a fost de acord. Întreab-o din nou dacă se răzgândește.',
  },
  not_sent_void: {
    en: 'Nothing was sent: this confirmation was cancelled. Ask the person again for a new summary.',
    ro: 'Nu s-a trimis nimic: această confirmare a fost anulată. Întreabă persoana din nou, cu un rezumat nou.',
  },
  request_not_open: {
    en: 'The request is no longer open.',
    ro: 'Cererea nu mai este deschisă.',
  },
  service_unavailable: {
    en: 'MotorFix is not available right now. Try again later.',
    ro: 'MotorFix nu este disponibil acum. Încearcă din nou mai târziu.',
  },
  validation: {
    en: 'The input is not valid for this tool.',
    ro: 'Datele trimise nu sunt valide pentru acest instrument.',
  },
};

const FALLBACK: Record<Language, string> = {
  en: 'The request could not be completed.',
  ro: 'Cererea nu a putut fi îndeplinită.',
};

// Prisma's codes for a database it cannot reach or that dropped the connection.
const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1017']);

const logger = new Logger('McpTools');

export function text(key: string, language: Language): string {
  return MESSAGES[key]?.[language] ?? FALLBACK[language];
}

export function refusal(code: string, language: Language): ToolError {
  return { code, message: text(code, language) };
}

// A refusal known only by its code, such as a failure stored at a
// confirmation and answered again: worded in the language of this call.
export class ToolRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ToolRefusal';
  }
}

// The keys of an exception body a tool's refusal may carry: anything else a
// use case puts there stays on the server.
const DETAILS = new Set(['mechanics']);

export function toolError(error: unknown, language: Language): ToolError {
  if (error instanceof ToolRefusal) return refusal(error.code, language);
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const own =
      typeof body === 'object'
        ? (body as { code?: unknown; message?: unknown })
        : {};
    const code =
      typeof own.code === 'string'
        ? own.code
        : codeForStatus(error.getStatus());
    const details = Object.fromEntries(
      Object.entries(own).filter(([key]) => DETAILS.has(key)),
    );
    // A use case states its refusal in English; until its code has a
    // Romanian text here, Romanian gets the general one.
    if (!MESSAGES[code] && language === 'en' && typeof own.message === 'string')
      return { ...details, code, message: own.message };
    return { ...details, ...refusal(code, language) };
  }
  if (databaseDown(error)) return refusal('service_unavailable', language);
  logger.error(error);
  return refusal('internal_error', language);
}

export function databaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'PrismaClientInitializationError') return true;
  const code = (error as { code?: unknown }).code;
  return (
    error.name === 'PrismaClientKnownRequestError' &&
    typeof code === 'string' &&
    CONNECTION_CODES.has(code)
  );
}
