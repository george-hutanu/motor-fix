// @traces 102-FR-009
// @traces 102-FR-008
import { GarageFiguresService } from '../insights/garage-figures/garage-figures.service';
import { GarageScheduleService } from '../quotes/garage-schedule/garage-schedule.service';
import { garageActor } from '../quotes/quotes.testing';
import { quotesApp } from '../quotes/quotes-api.testing';
import { DaySheetService } from '../workshop/day-sheet/day-sheet.service';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;
const schedule = new GarageScheduleService(prisma);
const daySheet = new DaySheetService(prisma);
const figures = new GarageFiguresService(prisma);

// Friday 9 October 2026, 10:00 in Bucharest.
const NOW = new Date('2026-10-09T07:00:00Z');
const DAY = '2026-10-09';

type Found = { path: string; what: string };
interface Ids {
  own: Set<string>;
  others: Set<string>;
}

// Whether a record is her own booking or job, or something inside one.
const isOwn = (record: Record<string, unknown>, own: Set<string>) =>
  [record['id'], record['bookingId']].some(
    (id) => typeof id === 'string' && own.has(id),
  );

// What one key of a record gives away.
function leakOf(key: string, child: unknown, inside: boolean) {
  if (key === 'phone') return 'phone';
  if (key === 'plate' && child !== null && !inside) return 'plate';
  return null;
}

function walkRecord(
  record: Record<string, unknown>,
  ids: Ids,
  path: string,
  inside: boolean,
  found: Found[],
) {
  for (const [key, child] of Object.entries(record)) {
    const what = leakOf(key, child, inside);
    if (what) found.push({ path: `${path}.${key}`, what });
    walk(child, ids, `${path}.${key}`, inside, found);
  }
}

// Every place in an answer that carries a phone, a plate outside the
// mechanic's own booking or job, or an id of someone else's booking or job.
function walk(
  value: unknown,
  ids: Ids,
  path = '$',
  mine = false,
  found: Found[] = [],
): Found[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      walk(item, ids, `${path}[${i}]`, mine, found);
    });
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    walkRecord(record, ids, path, mine || isOwn(record, ids.own), found);
  } else if (typeof value === 'string' && ids.others.has(value)) {
    found.push({ path, what: "another mechanic's booking or job" });
  }
  return found;
}

// What a call answered, or the body of its refusal.
const answerOf = (call: Promise<unknown>) =>
  call.catch((error: { getResponse?: () => unknown }) =>
    error.getResponse ? error.getResponse() : { thrown: String(error) },
  );

async function garage() {
  const t = await team('Atelier Dinamo');
  const at = (hour: string) => `${DAY}T${hour}:00:00Z`;
  const hers = await world.booked(t.garage.id, at('06'), 'confirmed', {
    mechanicId: t.answeringMechanic.id,
  });
  const theirs = await world.booked(t.garage.id, at('08'), 'confirmed', {
    mechanicId: t.plainMechanic.id,
  });
  const nobodys = await world.booked(t.garage.id, at('10'), 'confirmed');
  const herJob = await world.job(hers.id);
  const theirJob = await world.job(theirs.id);
  const driver = await world.account('Andrei Ion Marin');
  // Every driver has a phone, so an answer that carries one is caught.
  const drivers = [driver, hers.driverId, theirs.driverId, nobodys.driverId];
  for (const [i, id] of drivers.entries()) {
    await prisma.account.update({
      data: { phone: `+4072200011${i}` },
      where: { id },
    });
  }
  const request = await world.request(driver);
  await world.recipient(request.id, t.garage.id);
  return { herJob, hers, nobodys, request, t, theirJob, theirs };
}

describe("what a mechanic's garage reads carry", () => {
  it.each([
    ['without', false],
    ['with', true],
  ])(
    'carries no phone, and plates and bookings only of her own, %s the right to answer quotes',
    async (_, answers) => {
      const g = await garage();
      await prisma.mechanic.update({
        data: { canAnswerQuotes: answers },
        where: { id: g.t.answeringMechanic.id },
      });
      const actor = garageActor(g.t.answering, g.t.garage.id, 'mechanic', {
        canAnswerQuotes: answers,
      });
      const auth = bearer(g.t.answering, 'mechanic');
      const http = async (path: string) => (await get(path, auth)).body;

      const answers_ = {
        daySheet: await answerOf(
          daySheet.get(actor, { day: DAY, mechanic: g.t.answeringMechanic.id }),
        ),
        figures: await answerOf(figures.get(actor, {}, NOW)),
        herJob: await http(`/garage/jobs/${g.herJob.id}`),
        jobs: await http('/garage/jobs'),
        request: await http(`/garage/requests/${g.request.id}`),
        requests: await http('/garage/requests'),
        schedule: await answerOf(
          schedule.list(actor, { from: DAY, to: DAY }, NOW),
        ),
        theirJob: await http(`/garage/jobs/${g.theirJob.id}`),
      };

      const own = new Set([g.hers.id, g.herJob.id]);
      // No read carries a phone, nor a plate outside her own work.
      expect(walk(answers_, { others: new Set(), own })).toEqual([]);
      // The reads of the workshop's work name none but hers; the request
      // reads are the garage's inbox, which her right to answer quotes opens.
      const {
        daySheet: sheet,
        herJob,
        jobs,
        schedule: board,
        theirJob,
      } = answers_;
      expect(
        walk(
          { board, herJob, jobs, sheet, theirJob },
          { others: new Set([g.theirs.id, g.theirJob.id, g.nobodys.id]), own },
        ),
      ).toEqual([]);
      expect(
        (answers_.schedule as { entries: { id: string }[] }).entries.map(
          (e) => e.id,
        ),
      ).toEqual([g.hers.id]);
    },
  );
});
