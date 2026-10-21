import type { Overlays } from '@motor-fix/overlays';

import { ConfirmBookingDialog } from './confirm-booking-dialog/confirm-booking-dialog';
import { DeclineRequestDialog } from './decline-request-dialog/decline-request-dialog';
import { quotedRow, requestRow } from './garage-requests.testing';
import { confirmBooking, declineRequest, sendQuote } from './request-actions';
import { SendQuoteDialog } from './send-quote-dialog/send-quote-dialog';

let open: jest.Mock;
let feed: { reload: jest.Mock; sent: jest.Mock };
const overlays = () => ({ open }) as unknown as Overlays;

beforeEach(() => {
  open = jest.fn(async () => 'cancelled');
  feed = { reload: jest.fn(), sent: jest.fn() };
});

// @traces 347-FR-006
describe('sendQuote', () => {
  it('opens the send dialog for the request', async () => {
    await sendQuote(overlays(), feed, 'req-1');

    expect(open).toHaveBeenCalledWith(SendQuoteDialog, {
      data: { requestId: 'req-1' },
      shape: 'dialog',
      title: 'garage.quotes.send.title',
    });
    expect(feed.sent).not.toHaveBeenCalled();
    expect(feed.reload).not.toHaveBeenCalled();
  });

  it('tells the lists a quote was sent, and answers with the result', async () => {
    open.mockResolvedValueOnce('sent');

    expect(await sendQuote(overlays(), feed, 'req-1')).toBe('sent');
    expect(feed.sent).toHaveBeenCalledWith('req-1');
  });

  it('re-reads the lists after a refused send', async () => {
    open.mockResolvedValueOnce('refused');

    expect(await sendQuote(overlays(), feed, 'req-1')).toBe('refused');
    expect(feed.reload).toHaveBeenCalledTimes(1);
  });

  it('works with no lists to tell', async () => {
    open.mockResolvedValueOnce('sent');

    expect(await sendQuote(overlays(), null, 'req-1')).toBe('sent');
  });
});

// @traces 347-FR-006
describe('declineRequest', () => {
  it('opens the decline dialog with the driver and the car', async () => {
    await declineRequest(overlays(), feed, requestRow());

    expect(open).toHaveBeenCalledWith(DeclineRequestDialog, {
      data: {
        car: 'Dacia Logan · 2018',
        driver: 'Vlad P.',
        requestId: 'req-1',
      },
      shape: 'dialog',
      title: 'garage.requests.decline.title',
    });
    expect(feed.reload).not.toHaveBeenCalled();
  });

  it.each(['declined', 'refused'])(
    're-reads the lists after a %s answer',
    async (answer) => {
      open.mockResolvedValueOnce(answer);

      expect(await declineRequest(overlays(), feed, requestRow())).toBe(answer);
      expect(feed.reload).toHaveBeenCalledTimes(1);
    },
  );
});

// @traces 389-FR-014
// @traces 389-FR-015
describe('confirmBooking', () => {
  const row = quotedRow(
    {
      booking: {
        confirmBy: '2026-10-16T18:00:00.000Z',
        durationMinutes: 90,
        id: 'booking-1',
        lift: null,
        mechanic: null,
        startsAt: '2026-10-17T06:00:00.000Z',
        status: 'awaiting_confirmation',
      },
    },
    { status: 'accepted' },
  );

  it('opens the confirm panel for the row', async () => {
    await confirmBooking(overlays(), feed, row);

    expect(open).toHaveBeenCalledWith(ConfirmBookingDialog, {
      data: { row },
      shape: 'drawer',
      title: 'garage.quotes.confirm.title',
    });
    expect(feed.reload).not.toHaveBeenCalled();
  });

  it('re-reads the lists once the booking is confirmed', async () => {
    open.mockResolvedValueOnce('confirmed');

    expect(await confirmBooking(overlays(), feed, row)).toBe('confirmed');
    expect(feed.reload).toHaveBeenCalledTimes(1);
  });
});
