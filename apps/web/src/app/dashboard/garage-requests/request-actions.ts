import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import type { Overlays } from '@motor-fix/overlays';

import {
  type DeclineRequestData,
  DeclineRequestDialog,
  type DeclineRequestResult,
} from './decline-request-dialog/decline-request-dialog';
import type { GarageRequestsFeed } from './garage-requests-feed';
import {
  type SendQuoteData,
  SendQuoteDialog,
  type SendQuoteResult,
} from './send-quote-dialog/send-quote-dialog';

type Lists = Pick<GarageRequestsFeed, 'reload' | 'sent'> | null;
type Request = Pick<GarageRequestSummaryDto, 'car' | 'driver' | 'id'>;

// Trimite oferta and Refuză, from a row or from the open request: each opens
// its dialog and keeps the lists in step with the answer it returns.
export async function sendQuote(overlays: Overlays, lists: Lists, id: string) {
  const result = await overlays.open<SendQuoteResult, SendQuoteData>(
    SendQuoteDialog,
    {
      data: { requestId: id },
      shape: 'dialog',
      title: 'garage.quotes.send.title',
    },
  );
  if (result === 'sent') lists?.sent(id);
  else if (result === 'refused') lists?.reload();
  return result;
}

export async function declineRequest(
  overlays: Overlays,
  lists: Lists,
  request: Request,
) {
  const result = await overlays.open<DeclineRequestResult, DeclineRequestData>(
    DeclineRequestDialog,
    {
      data: {
        car: `${request.car.brand} ${request.car.model} · ${request.car.year}`,
        driver: request.driver.shortName,
        requestId: request.id,
      },
      shape: 'dialog',
      title: 'garage.requests.decline.title',
    },
  );
  if (result === 'declined' || result === 'refused') lists?.reload();
  return result;
}
