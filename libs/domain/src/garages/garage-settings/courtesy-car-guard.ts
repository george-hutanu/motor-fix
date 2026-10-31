import { HttpStatus } from '@nestjs/common';

import { refusal } from '../../auth/http-refusal';

// Courtesy-car terms belong to a listed car only; where the write sends the
// whole block, a listed car must come with its terms.
export function requireListedCourtesyCar(
  courtesyCar: unknown,
  listed: boolean,
  { required = false }: { required?: boolean } = {},
): void {
  const sent = courtesyCar !== undefined;
  if (sent ? listed : !(listed && required)) return;
  throw refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    sent
      ? 'The garage does not list a courtesy car'
      : 'A listed courtesy car needs its terms',
    [{ code: 'no_courtesy_car', field: 'courtesyCar' }],
  );
}
