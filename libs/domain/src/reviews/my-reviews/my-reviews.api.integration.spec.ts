import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { myReviews, reviewReply } from '../reviews.testing';

const { bearer, get, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { handedOver, review, replyReport } = myReviews(world);
const reply = reviewReply(world);

const DAY = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const list = (auth?: string, query = '') => get(`/me/reviews${query}`, auth);

interface Row {
  jobId: string;
  state: string;
  reply: { status: string; reportedByMe: boolean } | null;
}
const jobIds = (body: { items: Row[] }) => body.items.map((r) => r.jobId);

// Andrei, a driver, and the garage he takes his car to.
async function andrei() {
  const driver = await world.account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  return { asDriver: bearer(driver, 'driver'), driver, garage };
}

// @traces 117-FR-001
// @traces 117-FR-002
describe('which of the driver’s repairs are rows', () => {
  it('lists a job handed over within 60 days with no review as waiting', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(59));

    const read = await list(asDriver);

    expect(read.status).toBe(200);
    expect(jobIds(read.body)).toEqual([job.id]);
    expect(read.body.items[0].state).toBe('waiting');
  });

  it('leaves out a job handed over more than 60 days ago with no review', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, daysAgo(61));

    const read = await list(asDriver);

    expect(read.body).toMatchObject({ items: [], total: 0, waiting: 0 });
  });

  it('counts a review deleted by its author as no review', async () => {
    const { asDriver, driver, garage } = await andrei();
    const recent = await handedOver(driver, garage.id, daysAgo(5));
    await review(recent, { status: 'deleted_by_author' });
    const old = await handedOver(driver, garage.id, daysAgo(90));
    await review(old, { status: 'deleted_by_author' });

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([recent.id]);
    expect(read.body.items[0].state).toBe('waiting');
  });

  it('lists a written review whatever its age', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(400));
    await review(job, { postedAt: daysAgo(399) });

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([job.id]);
    expect(read.body.items[0].state).toBe('published');
  });

  it.each(['reported', 'removed'] as const)(
    'lists a %s review as a written row',
    async (status) => {
      const { asDriver, driver, garage } = await andrei();
      const job = await handedOver(driver, garage.id, daysAgo(3));
      await review(job, { status });

      const read = await list(asDriver);

      expect(read.body.items[0].state).toBe(status);
      expect(read.body).toMatchObject({ waiting: 0, written: 1 });
    },
  );

  it('never lists a done job not handed over as waiting, and dates its review by posting', async () => {
    const { asDriver, driver, garage } = await andrei();
    const silent = await handedOver(driver, garage.id, null);
    const reviewed = await handedOver(driver, garage.id, null);
    const written = await review(reviewed, { postedAt: daysAgo(2) });

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([reviewed.id]);
    expect(jobIds(read.body)).not.toContain(silent.id);
    expect(read.body.items[0]).toMatchObject({
      date: written.postedAt.toISOString(),
      handedOverAt: null,
    });
  });

  it.each(['to_do', 'in_work', 'paused', 'cancelled'] as const)(
    'leaves out a job that is %s',
    async (status) => {
      const { asDriver, driver, garage } = await andrei();
      await handedOver(driver, garage.id, daysAgo(1), status);

      const read = await list(asDriver);

      expect(read.body.items).toEqual([]);
    },
  );

  it('never lists a repair the driver logged by hand', async () => {
    const { asDriver, driver } = await andrei();
    const car = await world.car(driver);
    await prisma.repair.create({
      data: {
        carId: car.id,
        doneOn: daysAgo(3),
        garageName: 'Vulcanizare Ion',
        source: 'logged',
        what: 'Schimb anvelope',
      },
    });

    const read = await list(asDriver);

    expect(read.body).toMatchObject({ items: [], total: 0 });
  });

  it('never lists a profile review', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(200));
    await review(job, { source: 'profile' });

    const read = await list(asDriver);

    expect(read.body.items).toEqual([]);
  });

  it('never carries the plate', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, daysAgo(1));

    const read = await list(asDriver);

    expect(JSON.stringify(read.body)).not.toContain('B123ABC');
  });
});

// @traces 117-FR-001
// @traces 117-FR-003
describe('the order and the pages', () => {
  it('puts waiting rows first, newest handover first, then written rows newest first, ties by job id', async () => {
    const { asDriver, driver, garage } = await andrei();
    const waitingOld = await handedOver(driver, garage.id, daysAgo(30));
    const waitingNew = await handedOver(driver, garage.id, daysAgo(2));
    const writtenOld = await handedOver(driver, garage.id, daysAgo(100));
    await review(writtenOld, { postedAt: daysAgo(99) });
    const writtenNew = await handedOver(driver, garage.id, daysAgo(10));
    await review(writtenNew, { postedAt: daysAgo(9) });
    // Not handed over: dated by its review, posted 50 days ago.
    const writtenMid = await handedOver(driver, garage.id, null);
    await review(writtenMid, { postedAt: daysAgo(50) });
    const at = daysAgo(20);
    const tieA = await handedOver(driver, garage.id, at);
    await review(tieA);
    const tieB = await handedOver(driver, garage.id, at);
    await review(tieB);
    const [first, second] = [tieA.id, tieB.id].sort();

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([
      waitingNew.id,
      waitingOld.id,
      writtenNew.id,
      first,
      second,
      writtenMid.id,
      writtenOld.id,
    ]);
  });

  it('answers 20 rows, then the rest, with the counts on every page', async () => {
    const { asDriver, driver, garage } = await andrei();
    for (let i = 0; i < 22; i += 1) {
      const job = await handedOver(driver, garage.id, daysAgo(10 + i));
      await review(job);
    }
    for (let i = 0; i < 3; i += 1) {
      await handedOver(driver, garage.id, daysAgo(1 + i));
    }

    const one = await list(asDriver);
    const two = await list(asDriver, '?page=2');
    const three = await list(asDriver, '?page=3');

    const counts = { pageSize: 20, total: 25, waiting: 3, written: 22 };
    expect(one.body).toMatchObject({ ...counts, page: 1 });
    expect(two.body).toMatchObject({ ...counts, page: 2 });
    expect(three.body).toMatchObject({ ...counts, items: [], page: 3 });
    expect(one.body.items).toHaveLength(20);
    expect(two.body.items).toHaveLength(5);
    const all = [...jobIds(one.body), ...jobIds(two.body)];
    expect(new Set(all).size).toBe(25);
  });

  // The code, validation_failed, is the API's ProblemFilter's, which this
  // module's app leaves out: see apps/api/src/public-routes.integration.spec.ts.
  it.each([['?page=0'], ['?page=-1'], ['?page=x'], ['?page=1.5']])(
    'refuses %s with 400',
    async (query) => {
      const { asDriver } = await andrei();

      const read = await list(asDriver, query);

      expect(read.status).toBe(400);
    },
  );
});

// @traces 117-FR-004
describe('the garage’s reply on a row', () => {
  it('carries a published reply, open to the caller’s report', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(3));
    const written = await review(job);
    await reply(written.id, { text: 'Mulțumim!' });

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      canReportReply: true,
      reply: {
        editedAt: null,
        reportedByMe: false,
        status: 'published',
        text: 'Mulțumim!',
      },
    });
  });

  it('marks a reply the caller reported, while the report is pending', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(3));
    const written = await review(job);
    await reply(written.id, { status: 'reported' });
    await replyReport(written.id, driver);

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      canReportReply: false,
      reply: { reportedByMe: true, status: 'reported' },
    });
  });

  it('does not mark a reply another account reported, nor one whose report was decided', async () => {
    const { asDriver, driver, garage } = await andrei();
    const other = await world.account('Ion Popa', ['garage']);
    const first = await handedOver(driver, garage.id, daysAgo(3));
    const byOther = await review(first);
    await reply(byOther.id, { status: 'reported' });
    await replyReport(byOther.id, other);
    const second = await handedOver(driver, garage.id, daysAgo(4));
    const decided = await review(second);
    await reply(decided.id);
    await replyReport(decided.id, driver, 'decided');
    const onReview = await handedOver(driver, garage.id, daysAgo(5));
    const reportedReview = await review(onReview);
    await reply(reportedReview.id);
    await replyReport(reportedReview.id, driver, 'pending', 'review');

    const read = await list(asDriver);

    const byJob = new Map(
      (read.body.items as (Row & { canReportReply: boolean })[]).map((r) => [
        r.jobId,
        r,
      ]),
    );
    expect(byJob.get(first.id)?.reply?.reportedByMe).toBe(false);
    expect(byJob.get(first.id)?.canReportReply).toBe(false);
    expect(byJob.get(second.id)?.reply?.reportedByMe).toBe(false);
    expect(byJob.get(second.id)?.canReportReply).toBe(true);
    expect(byJob.get(onReview.id)?.reply?.reportedByMe).toBe(false);
    expect(byJob.get(onReview.id)?.canReportReply).toBe(true);
  });

  it('carries no removed reply', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, daysAgo(3));
    const written = await review(job);
    await reply(written.id, { status: 'removed' });

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      canReportReply: false,
      reply: null,
    });
  });
});

// @traces 117-FR-001
// @traces 117-FR-004
describe('only the caller’s rows', () => {
  it('never shows a driver another driver’s rows', async () => {
    const { asDriver, driver, garage } = await andrei();
    const mine = await handedOver(driver, garage.id, daysAgo(1));
    const elena = await world.account('Elena Pop', ['driver']);
    const hers = await handedOver(elena, garage.id, daysAgo(1));
    await review(await handedOver(elena, garage.id, daysAgo(2)));

    const read = await list(asDriver);
    const theirs = await list(bearer(elena, 'driver'));

    expect(jobIds(read.body)).toEqual([mine.id]);
    expect(read.body.total).toBe(1);
    expect(jobIds(theirs.body)).toContain(hers.id);
    expect(jobIds(theirs.body)).not.toContain(mine.id);
  });

  it('refuses a parameter naming another account', async () => {
    const { asDriver, garage } = await andrei();
    const elena = await world.account('Elena Pop', ['driver']);
    await handedOver(elena, garage.id, daysAgo(1));

    const read = await list(asDriver, `?page=1&driverId=${elena}`);

    expect(read.status).toBe(400);
  });

  it.each([
    ['garage', ['garage']],
    ['mechanic', ['mechanic']],
    ['admin', ['admin']],
  ] as const)(
    'answers a %s with no repairs of its own an empty page',
    async (role, roles) => {
      const { driver, garage } = await andrei();
      await handedOver(driver, garage.id, daysAgo(1));
      const someone = await world.account('Ana Ionescu', [...roles]);

      const read = await list(bearer(someone, role));

      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        waiting: 0,
        written: 0,
      });
    },
  );

  it('answers 401 with no session', async () => {
    const read = await list();

    expect(read.status).toBe(401);
  });
});
