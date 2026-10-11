import type { Overlays } from '@motor-fix/overlays';

import { DeclineRequestDialog } from './decline-request-dialog/decline-request-dialog';
import { requestRow } from './garage-requests.testing';
import { declineRequest, sendQuote } from './request-actions';
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
