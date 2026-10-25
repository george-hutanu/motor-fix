import { firstLine, shortName, toReassign } from './reads';

// @traces 313-FR-005
describe('the first line of a description', () => {
  it.each([
    ['Scârțâie la frână\nmai ales dimineața', 'Scârțâie la frână'],
    ['Frână\r\nzgomot', 'Frână'],
    ['   Frână  \nx', 'Frână'],
    ['\n  \nScârțâie', 'Scârțâie'],
  ])('reads %j as %j', (text, line) => {
    expect(firstLine(text)).toBe(line);
  });

  it.each([null, '', '   ', '\n \r\n'])('reads %j as nothing', (text) => {
    expect(firstLine(text)).toBeNull();
  });
});

type MechanicOfRow = {
  removedAt: Date | null;
  workingHours: unknown;
  worksSaturdays: boolean;
  daysOff: { firstDay: Date; lastDay: Date }[];
  garage: { hours: unknown };
};

const open: [string, string][] = [['08:00', '17:00']];
const garage = {
  hours: {
    fri: open,
    mon: open,
    sat: [['09:00', '14:00']],
    sun: [],
    thu: open,
    tue: open,
    wed: open,
  },
};
const mechanic = (extra: Partial<MechanicOfRow> = {}): MechanicOfRow => ({
  daysOff: [],
  garage,
  removedAt: null,
  workingHours: null,
  worksSaturdays: false,
  ...extra,
});
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// @traces 056-FR-008 058-FR-007
describe('a booking to reassign', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  // Monday 26 October, 09:00 in Bucharest.
  const later = new Date('2026-10-26T07:00:00Z');
  const earlier = new Date('2026-10-20T07:00:00Z');
  const removed = mechanic({ removedAt: new Date('2026-10-23T12:00:00Z') });
  const current = mechanic();
  const booking = { durationMinutes: 60, startsAt: later, status: 'confirmed' };

  it('is a confirmed booking still ahead whose mechanic was removed', () => {
    expect(toReassign({ ...booking, mechanic: removed }, now)).toBe(true);
  });

  it('is a confirmed booking ahead on a day off of its mechanic', () => {
    const away = mechanic({
      daysOff: [{ firstDay: day('2026-10-26'), lastDay: day('2026-10-28') }],
    });

    expect(toReassign({ ...booking, mechanic: away }, now)).toBe(true);
  });

  it("is a confirmed booking ahead outside its mechanic's stretch", () => {
    const afternoons = mechanic({
      workingHours: {
        fri: [['12:00', '17:00']],
        mon: [['12:00', '17:00']],
        sat: [],
        sun: [],
        thu: [],
        tue: [],
        wed: [],
      },
    });

    expect(toReassign({ ...booking, mechanic: afternoons }, now)).toBe(true);
  });

  it.each([
    ['one already past', { ...booking, mechanic: removed, startsAt: earlier }],
    ['one starting now', { ...booking, mechanic: removed, startsAt: now }],
    ['a cancelled one', { ...booking, mechanic: removed, status: 'cancelled' }],
    [
      'one awaiting confirmation',
      { ...booking, mechanic: removed, status: 'awaiting_confirmation' },
    ],
    ["a current card's", { ...booking, mechanic: current }],
    ['one with no mechanic', { ...booking, mechanic: null }],
    [
      'one on a day off that ended before it',
      {
        ...booking,
        mechanic: mechanic({
          daysOff: [
            { firstDay: day('2026-10-24'), lastDay: day('2026-10-25') },
          ],
        }),
      },
    ],
  ])('is not %s', (_, row) => {
    expect(toReassign(row, now)).toBe(false);
  });
});

// @traces 413-FR-010
describe('a short name', () => {
  it.each([
    ['Ana Popescu', 'Ana P.'],
    ['Ana Maria Popescu', 'Ana P.'],
    ['Ana \u{1D4D0}popescu', 'Ana \u{1D4D0}.'],
    ['Ana', 'Ana'],
    ['', ''],
  ])('reads %j as %j', (name, short) => {
    expect(shortName(name)).toBe(short);
  });
});
