import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { myReviews, reviewReply } from '../reviews.testing';

const { bearer, get, world } = quotesApp([ReviewsModule]);
const { handedOver, review, replyReport } = myReviews(world);
const reply = reviewReply(world);

const DAY = 24 * 60 * 60_000;
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);

const list = (auth?: string, query = '') => get(`/me/reviews${query}`, auth);
const jobIds = (body: { items: { jobId: string }[] }) =>
  body.items.map((r) => r.jobId);

async function andrei() {
  const driver = await world.account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  return { asDriver: bearer(driver, 'driver'), driver, garage };
}

// @traces 117-FR-001
describe('the page parameter', () => {
  it.each([
    ['?page='],
    ['?page=%20'],
    ['?page=1e1'],
    ['?page=0x2'],
    ['?page=NaN'],
    ['?page=Infinity'],
    ['?page=-0'],
    ['?page=%EF%BC%91'],
    ['?page=1&page=2'],
    ['?page[]=1'],
    ['?page=1;DROP'],
  ])('refuses %s with 400', async (query) => {
    const { asDriver } = await andrei();

    const read = await list(asDriver, query);

    expect(read.status).toBe(400);
  });

  it('answers page 1 when none is given and when it is written 1', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, ago(DAY));

    const bare = await list(asDriver);
    const one = await list(asDriver, '?page=1');

    expect(bare.body).toEqual(one.body);
    expect(one.body.page).toBe(1);
  });

  it('answers an empty page for a page far past the last, with the same totals', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, ago(DAY));

    const read = await list(asDriver, '?page=2000000');

    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      items: [],
      page: 2000000,
      total: 1,
      waiting: 1,
      written: 0,
    });
  });

  it.each([['99999999999999999999999'], ['9007199254740993'], ['2147483648']])(
    'answers 200 with no items and the real totals for page %s',
    async (page) => {
      const { asDriver, driver, garage } = await andrei();
      await handedOver(driver, garage.id, ago(DAY));

      const read = await list(asDriver, `?page=${page}`);

      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ items: [], total: 1, waiting: 1 });
    },
  );

  it('refuses a parameter that names another account', async () => {
    const { asDriver } = await andrei();
    const elena = await world.account('Elena Pop', ['driver']);

    const byAccount = await list(asDriver, `?accountId=${elena}`);
    const byOwner = await list(asDriver, `?driverId=${elena}`);

    expect([byAccount.status, byOwner.status]).toEqual([400, 400]);
  });
});

// @traces 117-FR-001
// @traces 117-FR-003
describe('the page boundary', () => {
  it('fills exactly one page with 20 rows and leaves page 2 empty', async () => {
    const { asDriver, driver, garage } = await andrei();
    for (let i = 0; i < 20; i += 1) {
      await handedOver(driver, garage.id, ago((i + 1) * DAY));
    }

    const one = await list(asDriver);
    const two = await list(asDriver, '?page=2');

    expect(one.body.items).toHaveLength(20);
    expect(two.body).toMatchObject({ items: [], total: 20, waiting: 20 });
  });

  it('puts the 21st row alone on page 2', async () => {
    const { asDriver, driver, garage } = await andrei();
    for (let i = 0; i < 21; i += 1) {
      await handedOver(driver, garage.id, ago((i + 1) * DAY));
    }

    const one = await list(asDriver);
    const two = await list(asDriver, '?page=2');

    expect(two.body.items).toHaveLength(1);
    expect(jobIds(one.body)).not.toContain(jobIds(two.body)[0]);
  });

  it('never repeats or skips a row across pages when 25 rows share one handover instant', async () => {
    const { asDriver, driver, garage } = await andrei();
    const at = ago(3 * DAY);
    const ids: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      ids.push((await handedOver(driver, garage.id, at)).id);
    }

    const one = await list(asDriver);
    const two = await list(asDriver, '?page=2');

    expect([...jobIds(one.body), ...jobIds(two.body)]).toEqual([...ids].sort());
  });

  it('keeps the waiting rows ahead of written ones across the page boundary', async () => {
    const { asDriver, driver, garage } = await andrei();
    for (let i = 0; i < 19; i += 1) {
      await review(await handedOver(driver, garage.id, ago(100 * DAY + i)));
    }
    const waiting: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      waiting.push(
        (await handedOver(driver, garage.id, ago(i * DAY + MIN))).id,
      );
    }

    const one = await list(asDriver);
    const two = await list(asDriver, '?page=2');

    expect(jobIds(one.body).slice(0, 2)).toEqual(waiting);
    expect(two.body.items.map((r: { state: string }) => r.state)).toEqual([
      'published',
    ]);
  });
});

// @traces 117-FR-002
describe('the 60 day window', () => {
  it('lists a job handed over 60 days less a minute ago', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(60 * DAY - MIN));

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([job.id]);
  });

  it('leaves out a job handed over 60 days and a minute ago', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, ago(60 * DAY + MIN));

    const read = await list(asDriver);

    expect(read.body).toMatchObject({ items: [], total: 0 });
  });

  it('lists a job whose handover is dated ahead of now', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(-DAY));

    const read = await list(asDriver);

    expect(jobIds(read.body)).toEqual([job.id]);
  });

  it('leaves out a cancelled job even when it carries a review', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(DAY), 'cancelled');
    await review(job);

    const read = await list(asDriver);

    expect(read.body.items).toEqual([]);
  });

  it('lists a job once when it holds a deleted review and a newer live one', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(2 * DAY));
    await review(job, { postedAt: ago(DAY), status: 'deleted_by_author' });
    await review(job, { postedAt: ago(DAY) });

    const read = await list(asDriver);

    expect(read.body).toMatchObject({ total: 1, waiting: 0, written: 1 });
  });

  it('shows a deleted review’s job as waiting with no reply carried', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(2 * DAY));
    const gone = await review(job, { status: 'deleted_by_author' });
    await reply(gone.id);

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      canReportReply: false,
      canWrite: true,
      reply: null,
      reviewId: null,
      state: 'waiting',
    });
  });
});

// @traces 117-FR-004
describe('the row fields', () => {
  it('allows an edit on a published review posted 13 days ago and refuses one 15 days ago', async () => {
    const { asDriver, driver, garage } = await andrei();
    const fresh = await handedOver(driver, garage.id, ago(14 * DAY));
    await review(fresh, { postedAt: ago(13 * DAY) });
    const stale = await handedOver(driver, garage.id, ago(16 * DAY));
    await review(stale, { postedAt: ago(15 * DAY) });

    const read = await list(asDriver);

    const byJob = new Map(
      read.body.items.map((r: { jobId: string; canEdit: boolean }) => [
        r.jobId,
        r.canEdit,
      ]),
    );
    expect(byJob.get(fresh.id)).toBe(true);
    expect(byJob.get(stale.id)).toBe(false);
  });

  it('flags an appeal on a removed review only', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(DAY));
    await review(job, { status: 'removed' });

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      canAppeal: true,
      canEdit: false,
      canWrite: false,
      state: 'removed',
    });
  });

  it('answers a null first line without text and only the first line of a multi-line text', async () => {
    const { asDriver, driver, garage } = await andrei();
    const none = await handedOver(driver, garage.id, ago(DAY));
    await review(none, { text: null });
    const multi = await handedOver(driver, garage.id, ago(2 * DAY));
    await review(multi, { text: 'Prima linie\r\nA doua linie secretă' });

    const read = await list(asDriver);

    const lines = new Map(
      read.body.items.map((r: { jobId: string; firstLine: string | null }) => [
        r.jobId,
        r.firstLine,
      ]),
    );
    expect(lines.get(none.id)).toBeNull();
    expect(lines.get(multi.id)).toBe('Prima linie');
    expect(JSON.stringify(read.body)).not.toContain('secretă');
  });

  it('names the accepted work in both languages and the garage', async () => {
    const { asDriver, driver, garage } = await andrei();
    await handedOver(driver, garage.id, ago(DAY));

    const read = await list(asDriver);

    expect(read.body.items[0].jobs).toEqual([
      expect.objectContaining({
        nameEn: 'Timing chain kit',
        nameRo: 'Kit lanț distribuție',
      }),
    ]);
    expect(read.body.items[0].garage).toMatchObject({
      id: garage.id,
      name: 'Atelier Dinamo',
    });
  });

  it('carries exactly the contract’s fields on a row, its garage and its reply', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(DAY));
    const written = await review(job);
    await reply(written.id);

    const row = (await list(asDriver)).body.items[0];

    expect(Object.keys(row).sort()).toEqual(
      [
        'canAppeal',
        'canEdit',
        'canReportReply',
        'canWrite',
        'car',
        'date',
        'editedAt',
        'firstLine',
        'garage',
        'handedOverAt',
        'jobId',
        'jobs',
        'postedAt',
        'rating',
        'reply',
        'reviewId',
        'state',
      ].sort(),
    );
    expect(Object.keys(row.reply).sort()).toEqual([
      'editedAt',
      'postedAt',
      'reportedByMe',
      'status',
      'text',
    ]);
    expect(Object.keys(row.garage).sort()).toEqual(['id', 'name', 'slug']);
    expect(Object.keys(row.car).sort()).toEqual([
      'brand',
      'engine',
      'fuel',
      'model',
      'year',
    ]);
  });

  it('carries a reply on a reported review, marked reported', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(DAY));
    const written = await review(job, { status: 'reported' });
    await reply(written.id, { status: 'reported' });

    const read = await list(asDriver);

    expect(read.body.items[0]).toMatchObject({
      reply: { status: 'reported' },
      state: 'reported',
    });
  });

  it('does not show a caller another driver’s review, nor mark its reply reported by the caller', async () => {
    const { asDriver, driver, garage } = await andrei();
    const elena = await world.account('Elena Pop', ['driver']);
    const hers = await handedOver(elena, garage.id, ago(DAY));
    const herReview = await review(hers);
    await reply(herReview.id, { status: 'reported' });
    await replyReport(herReview.id, driver);

    const read = await list(asDriver);
    const theirs = await list(bearer(elena, 'driver'));

    expect(read.body.items).toEqual([]);
    expect(theirs.body.items[0].reply.reportedByMe).toBe(false);
  });

  it('answers the reply text whole, with markup and unicode untouched', async () => {
    const { asDriver, driver, garage } = await andrei();
    const job = await handedOver(driver, garage.id, ago(DAY));
    const written = await review(job);
    const text = '<b>Mulțumim</b> 🚗\nșăî '.repeat(50);
    await reply(written.id, { text });

    const read = await list(asDriver);

    expect(read.body.items[0].reply.text).toBe(text);
  });
});

// @traces 117-FR-001
describe('the caller and the session', () => {
  it('answers 401 for a garbage bearer token', async () => {
    const read = await list('Bearer not-a-token');

    expect(read.status).toBe(401);
  });

  it('answers the same list twice', async () => {
    const { asDriver, driver, garage } = await andrei();
    await review(await handedOver(driver, garage.id, ago(DAY)));
    await handedOver(driver, garage.id, ago(2 * DAY));

    const first = await list(asDriver);
    const second = await list(asDriver);

    expect(second.body).toEqual(first.body);
  });

  it('lists a driver’s own jobs for an account holding the driver and garage roles', async () => {
    const both = await world.account('Mihai Dual', ['driver', 'garage']);
    const garage = await world.garage('Atelier Dinamo');
    const job = await handedOver(both, garage.id, ago(DAY));

    const read = await list(bearer(both, 'driver'));

    expect(jobIds(read.body)).toEqual([job.id]);
  });

  it('answers a garage account an empty list, not its garage’s jobs', async () => {
    const { driver, garage } = await andrei();
    await handedOver(driver, garage.id, ago(DAY));
    const staff = await world.account('Ana Ionescu', ['garage']);

    const read = await list(bearer(staff, 'garage'));

    expect(read.body.total).toBe(0);
  });
});
