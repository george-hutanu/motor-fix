import { HttpException, HttpStatus } from '@nestjs/common';

import { refusal } from '../auth/sign-up.service';

// The roles that answer a request for their garage, by quote or decline.
export const ANSWERING = new Set(['garage', 'receptionist', 'mechanic']);

// The garage's row of the request, locked so two answers are judged one
// after the other.
export interface AnswerTarget {
  recipient_id: string;
  recipient_status: string;
  request_status: string;
  driver_id: string;
  garage_status: string;
}

export const alreadyAnswered = () =>
  refusal(
    HttpStatus.CONFLICT,
    'already_answered',
    'Altcineva a răspuns deja la această cerere',
  );

const notOpen = () =>
  refusal(
    HttpStatus.CONFLICT,
    'request_not_open',
    'Cererea nu mai este deschisă',
  );

// A quote or a decline answers only an open request the garage has not
// answered yet.
export function judgeAnswer(target: AnswerTarget) {
  if (target.garage_status === 'suspended') throw notOpen();
  if (['quoted', 'declined'].includes(target.recipient_status)) {
    throw alreadyAnswered();
  }
  if (target.recipient_status !== 'waiting') throw notOpen();
  if (!['sent', 'quoted'].includes(target.request_status)) throw notOpen();
}

// A refused answer's outcome: the two conflicts by name, any other client
// error as `other`; a server error is not an answer's outcome.
export function answerOutcomeOf<T extends string>(
  error: unknown,
  other: T,
): 'already_answered' | 'request_not_open' | T | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse() as { code?: string };
  if (body.code === 'already_answered') return 'already_answered';
  if (body.code === 'request_not_open') return 'request_not_open';
  const status = error.getStatus();
  return status >= 400 && status < 500 ? other : null;
}
