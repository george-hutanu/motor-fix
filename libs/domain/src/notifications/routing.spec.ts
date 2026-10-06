// @traces 392-FR-004 392-FR-005
import type { OutsideChannel } from '@motor-fix/contracts';

import { mutedChannels } from './preferences';
import { outsideChannels } from './routing';

const everyone = { email: true, phone: true, push: false, whatsapp: true };
const withDevice = { ...everyone, push: true };
const driverChose = (type: string, channel: OutsideChannel) =>
  mutedChannels(type, [{ channel, enabled: true, garageId: null, type }]);

describe('the outside channels of a driver message', () => {
  it('is e-mail when nothing is saved', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'email'), everyone),
    ).toEqual(['email']);
    expect(
      outsideChannels('DUE_ITP', mutedChannels('DUE_ITP', []), everyone),
    ).toEqual(['email']);
  });

  it('is the SMS a driver with a verified phone chose', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'sms'), everyone),
    ).toEqual(['sms']);
  });

  it('is the WhatsApp a driver chose', () => {
    expect(
      outsideChannels(
        'QUOTE_RECEIVED',
        driverChose('QUOTE_RECEIVED', 'whatsapp'),
        everyone,
      ),
    ).toEqual(['whatsapp']);
  });

  it('is e-mail for a driver without a verified phone', () => {
    const noPhone = { ...everyone, phone: false };
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'sms'), noPhone),
    ).toEqual(['email']);
    expect(
      outsideChannels('DUE_RCA', driverChose('DUE_RCA', 'whatsapp'), noPhone),
    ).toEqual(['email']);
  });

  it('is nothing outside the app without an address or a phone', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'sms'), {
        email: false,
        phone: false,
        push: false,
        whatsapp: true,
      }),
    ).toEqual([]);
  });

  it('keeps e-mail beside the chosen channel for an always-sent type', () => {
    expect(
      outsideChannels(
        'BOOKING_CONFIRMED',
        driverChose('BOOKING_CONFIRMED', 'whatsapp'),
        everyone,
      ),
    ).toEqual(['email', 'whatsapp']);
  });

  it('is never stopped by a garage that switched WhatsApp off', () => {
    // The caller passes whatsapp: true for every driver type.
    expect(
      outsideChannels(
        'QUOTE_RECEIVED',
        driverChose('QUOTE_RECEIVED', 'whatsapp'),
        everyone,
      ),
    ).toEqual(['whatsapp']);
  });

  it('is push for a driver who chose it and has a device', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'push'), withDevice),
    ).toEqual(['push']);
  });

  it('is e-mail for a driver who chose push and has no device', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'push'), everyone),
    ).toEqual(['email']);
  });

  it('is nothing for a driver who chose push, has no device and no address', () => {
    expect(
      outsideChannels('DUE_ITP', driverChose('DUE_ITP', 'push'), {
        ...everyone,
        email: false,
      }),
    ).toEqual([]);
  });

  it('keeps e-mail beside push for an always-sent type', () => {
    expect(
      outsideChannels(
        'BOOKING_CONFIRMED',
        driverChose('BOOKING_CONFIRMED', 'push'),
        withDevice,
      ),
    ).toEqual(['email', 'push']);
  });
});

describe('the outside channels of a staff message', () => {
  it('leaves WhatsApp off until the person turned it on', () => {
    expect(
      outsideChannels(
        'REQUEST_RECEIVED',
        mutedChannels('REQUEST_RECEIVED', []),
        everyone,
      ),
    ).toEqual(['email']);
  });

  it('adds WhatsApp once the person turned it on', () => {
    const muted = mutedChannels('REQUEST_RECEIVED', [
      {
        channel: 'whatsapp',
        enabled: true,
        garageId: 'g',
        type: 'REQUEST_RECEIVED',
      },
    ]);
    expect(outsideChannels('REQUEST_RECEIVED', muted, everyone)).toEqual([
      'email',
      'whatsapp',
    ]);
  });

  it('sends e-mail instead when the garage switched WhatsApp off', () => {
    const muted = mutedChannels('REQUEST_RECEIVED', [
      {
        channel: 'whatsapp',
        enabled: true,
        garageId: 'g',
        type: 'REQUEST_RECEIVED',
      },
      {
        channel: 'email',
        enabled: false,
        garageId: 'g',
        type: 'REQUEST_RECEIVED',
      },
    ]);
    expect(
      outsideChannels('REQUEST_RECEIVED', muted, {
        ...everyone,
        whatsapp: false,
      }),
    ).toEqual(['email']);
  });

  it('sends a transactional WhatsApp-only type with nothing saved', () => {
    const muted = mutedChannels('CAR_TRANSFER_LINK', []);
    expect(outsideChannels('CAR_TRANSFER_LINK', muted, everyone)).toEqual([
      'whatsapp',
    ]);
  });

  it('sends no e-mail instead for a WhatsApp-only type', () => {
    const muted = mutedChannels('CAR_TRANSFER_LINK', []);
    expect(
      outsideChannels('CAR_TRANSFER_LINK', muted, {
        ...everyone,
        phone: false,
      }),
    ).toEqual([]);
  });
});

describe('push for staff', () => {
  it('is on once a device is saved, beside e-mail', () => {
    expect(
      outsideChannels(
        'REQUEST_RECEIVED',
        mutedChannels('REQUEST_RECEIVED', []),
        withDevice,
      ),
    ).toEqual(['email', 'push']);
  });

  it('is off without a device, e-mail alone', () => {
    expect(
      outsideChannels(
        'REQUEST_RECEIVED',
        mutedChannels('REQUEST_RECEIVED', []),
        everyone,
      ),
    ).toEqual(['email']);
  });

  it('is off when the person muted it', () => {
    const muted = mutedChannels('REQUEST_RECEIVED', [
      {
        channel: 'push',
        enabled: false,
        garageId: 'g',
        type: 'REQUEST_RECEIVED',
      },
    ]);
    expect(outsideChannels('REQUEST_RECEIVED', muted, withDevice)).toEqual([
      'email',
    ]);
  });

  it('does not turn a muted e-mail back on when push is unreachable', () => {
    const muted = mutedChannels('REQUEST_RECEIVED', [
      {
        channel: 'email',
        enabled: false,
        garageId: 'g',
        type: 'REQUEST_RECEIVED',
      },
    ]);
    expect(outsideChannels('REQUEST_RECEIVED', muted, everyone)).toEqual([]);
  });

  it('is nothing for a push-only type without a device', () => {
    expect(
      outsideChannels(
        'ASSISTANT_APPROVAL_NEEDED',
        mutedChannels('ASSISTANT_APPROVAL_NEEDED', []),
        everyone,
      ),
    ).toEqual([]);
  });
});
