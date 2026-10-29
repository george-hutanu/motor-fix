import type { MediaRefusal } from '@motor-fix/contracts';
import type { HttpStatus } from '@nestjs/common';

import { refusal } from '../auth/http-refusal';
import type { Actor } from '../auth/policy';
import { said } from '../quotes/refusals';

type Words = Parameters<typeof said>[0];

// What each refusal says, in the caller's language.
const WORDS: Record<MediaRefusal, Words> = {
  clip_too_long: {
    en: 'A clip runs at most 60 seconds',
    ro: 'Un clip durează cel mult 60 de secunde',
  },
  file_missing: {
    en: 'The file has not finished uploading',
    ro: 'Fișierul nu s-a încărcat încă',
  },
  file_too_large: {
    en: 'The file is too large',
    ro: 'Fișierul este prea mare',
  },
  file_type_mismatch: {
    en: 'The file is not the type it was sent as',
    ro: 'Fișierul nu este de tipul declarat',
  },
  file_type_not_allowed: {
    en: 'Send a JPEG, PNG, HEIC or WebP photo, or an MP4, MOV or WebM clip',
    ro: 'Trimite o fotografie JPEG, PNG, HEIC sau WebP ori un clip MP4, MOV sau WebM',
  },
  forbidden: {
    en: 'Only the garage owner and the job’s mechanic can do this',
    ro: 'Doar proprietarul service-ului și mecanicul lucrării pot face asta',
  },
  invalid_state: {
    en: 'This file cannot change now',
    ro: 'Fișierul nu mai poate fi modificat acum',
  },
  job_handed_over: {
    en: 'The car has been handed over',
    ro: 'Mașina a fost predată',
  },
  job_not_in_work: {
    en: 'The job is not in work',
    ro: 'Lucrarea nu este în lucru',
  },
  not_found: { en: 'Not found', ro: 'Nu a fost găsit' },
  storage_unavailable: {
    en: 'Files cannot be stored right now. Try again in a few minutes.',
    ro: 'Fișierele nu pot fi salvate acum. Încearcă din nou în câteva minute.',
  },
};

export const mediaRefused = (
  status: HttpStatus,
  code: MediaRefusal,
  actor: Pick<Actor, 'language'>,
) => refusal(status, code, said(WORDS[code], actor));
