import { codeForStatus } from '@motor-fix/contracts';
import { HttpException, Logger } from '@nestjs/common';

export type Language = 'ro' | 'en';

export interface ToolError {
  code: string;
  message: string;
}

const MESSAGES: Record<string, Record<Language, string>> = {
  already_decided: {
    en: 'This has already been decided.',
    ro: 'Acest lucru a fost deja hotărât.',
  },
  assistant_act_off: {
    en: 'The person allowed this assistant to read only; it cannot act for them.',
    ro: 'Persoana a permis acestui asistent doar să citească; nu poate acționa în numele ei.',
  },
  internal_error: {
    en: 'Something went wrong. Try again later.',
    ro: 'Ceva nu a mers. Încearcă din nou mai târziu.',
  },
  maintenance: {
    en: 'MotorFix is under maintenance; changes are paused. Reading still works.',
    ro: 'MotorFix este în mentenanță; modificările sunt oprite. Citirea funcționează în continuare.',
  },
  not_found: {
    en: 'Not found.',
    ro: 'Nu a fost găsit.',
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

export function refusal(code: string, language: Language): ToolError {
  return { code, message: MESSAGES[code]?.[language] ?? FALLBACK[language] };
}

export function toolError(error: unknown, language: Language): ToolError {
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
    // A use case states its refusal in English; until its code has a
    // Romanian text here, Romanian gets the general one.
    if (!MESSAGES[code] && language === 'en' && typeof own.message === 'string')
      return { code, message: own.message };
    return refusal(code, language);
  }
  if (databaseDown(error)) return refusal('service_unavailable', language);
  logger.error(error);
  return refusal('internal_error', language);
}

function databaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'PrismaClientInitializationError') return true;
  const code = (error as { code?: unknown }).code;
  return (
    error.name === 'PrismaClientKnownRequestError' &&
    typeof code === 'string' &&
    CONNECTION_CODES.has(code)
  );
}
