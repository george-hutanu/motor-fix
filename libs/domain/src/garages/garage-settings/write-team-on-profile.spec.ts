// @traces 059-FR-004

import { writeTeamOnProfile } from './write-team-on-profile';
import type { AuditPort } from '../../audit/audit.port';
import type { EventPort } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';

const GARAGE = 'garage-1';

const setup = (stored: boolean) => {
  const tx = {
    garage: {
      findUniqueOrThrow: jest.fn(async () => ({ teamOnProfile: stored })),
      update: jest.fn(async () => ({})),
    },
    mechanic: {
      findMany: jest.fn(async () => [{ id: 'm-1' }, { id: 'm-2' }]),
    },
  };
  const audit = {
    record: jest.fn(async () => undefined),
    recordChanges: jest.fn(async () => undefined),
  };
  const events = { record: jest.fn(async () => undefined) };
  return {
    audit,
    events,
    ports: {
      audit: audit as unknown as AuditPort,
      events: events as unknown as EventPort,
    },
    tx,
    txc: tx as unknown as Prisma.TransactionClient,
  };
};

const change = {
  actorId: 'actor-1',
  actorRole: 'garage' as const,
  garageId: GARAGE,
};

describe('writeTeamOnProfile', () => {
  it('writes nothing, records nothing and tells no one when the switch does not move', async () => {
    const { audit, events, ports, tx, txc } = setup(true);
    await writeTeamOnProfile(txc, change, true, ports);
    expect(tx.garage.update).not.toHaveBeenCalled();
    expect(audit.recordChanges).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('turns the switch off with one history entry and tells the profile and each card page', async () => {
    const { audit, events, ports, tx, txc } = setup(true);
    await writeTeamOnProfile(txc, change, false, ports);
    expect(tx.garage.update).toHaveBeenCalledWith({
      data: { teamOnProfile: false },
      where: { id: GARAGE },
    });
    expect(audit.recordChanges).toHaveBeenCalledWith(
      txc,
      expect.objectContaining({ subjectId: GARAGE, subjectType: 'garage' }),
      { team_on_profile: true },
      { team_on_profile: false },
    );
    expect(events.record).toHaveBeenCalledWith(txc, {
      audience: {
        garageId: GARAGE,
        mechanicIds: ['m-1', 'm-2'],
        results: false,
        type: 'public_garage',
      },
      kind: 'garage.updated',
      payload: { fields: ['team_on_profile'], garageId: GARAGE },
      subjectId: GARAGE,
    });
  });

  it('records the value a garage is created with, even the default, and tells no one', async () => {
    const { audit, events, ports, tx, txc } = setup(true);
    await writeTeamOnProfile(txc, change, true, { audit: ports.audit });
    expect(tx.garage.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      txc,
      expect.objectContaining({
        action: 'create',
        field: 'team_on_profile',
        newValue: true,
        subjectId: GARAGE,
        subjectType: 'garage',
      }),
    );
    expect(audit.recordChanges).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('writes a creation with the switch off onto the garage', async () => {
    const { audit, ports, tx, txc } = setup(true);
    await writeTeamOnProfile(txc, change, false, { audit: ports.audit });
    expect(tx.garage.update).toHaveBeenCalledWith({
      data: { teamOnProfile: false },
      where: { id: GARAGE },
    });
    expect(audit.record).toHaveBeenCalledWith(
      txc,
      expect.objectContaining({ action: 'create', newValue: false }),
    );
  });
});
