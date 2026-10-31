// What an event is about, with the people the relay resolved for it.
export type LiveSubject =
  | { type: 'account'; accountId: string }
  | { type: 'request'; driverAccountId: string; garageIds: readonly string[] }
  | { type: 'quote' | 'message'; driverAccountId: string; garageId: string }
  | {
      // A job also covers its media and live kinds.
      type: 'booking' | 'job';
      driverAccountId: string;
      garageId: string;
      mechanicId: string | null;
    }
  | {
      type: 'review';
      garageId: string;
      authorAccountId: string;
      mechanicId: string | null;
    }
  // A garage's or a mechanic's new rating: its staff, its public page, the
  // results, and the mechanic's page when a mechanic's moved.
  | { type: 'rating'; garageId: string; mechanicId: string | null }
  | { type: 'car'; ownerAccountId: string }
  // A car taken over: the seller and the buyer.
  | { type: 'car_transfer'; sellerAccountId: string; buyerAccountId: string }
  // A car with no owner (its account deleted) reaches the garage alone.
  | {
      type: 'repair';
      ownerAccountId: string | null;
      sharedGarageId: string | null;
    }
  | {
      type: 'verification';
      garageId: string;
      // A status change the public sees (an approval, a suspension): the
      // garage's public page and the results of every brand.
      published?: true;
      // The brands it takes then: their searches hear a published change.
      brandIds?: readonly string[];
    }
  // The garages' staff only: an invite, a mechanic row.
  | { type: 'garage'; garageIds: readonly string[] }
  // A mechanic card added, edited or removed: the garage's staff, and its
  // public page and the mechanic's page while the card is on the profile.
  | { type: 'mechanic'; garageId: string; mechanicId: string; public: boolean }
  // A change to the brands a garage takes: its staff, its public page and the
  // search of each brand whose stance changed.
  | { type: 'garage_brands'; garageId: string; brandIds: readonly string[] }
  // A change a visitor sees on the garage's public page; `results` when it can
  // also move the garage in search results.
  | { type: 'public_garage'; garageId: string; results: boolean }
  // A decision on a garage's reports: the admins and the drivers who sent
  // them, never the garage.
  | { type: 'garage_report'; reporterIds: readonly string[] }
  // A rule only the admins act on stays off the system channel.
  | { type: 'platform'; adminOnly?: boolean }
  // An admin's decision on a proposed job: the admins and the proposing
  // garage's staff (null when the garage is gone).
  | { type: 'catalogue_job'; garageId: string | null }
  // Time a garage blocked: its staff, the blocked mechanic, and its public
  // page, whose free slots move (never the block's note).
  | { type: 'time_block'; garageId: string; mechanicId: string | null };

const account = (id: string) => `account:${id}`;
const garage = (id: string) => `garage:${id}`;
const when = (condition: unknown, ...keys: string[]) => (condition ? keys : []);

// The channel keys of everyone who may read the subject through the API.
export function audienceOf(subject: LiveSubject): string[] {
  switch (subject.type) {
    case 'account':
      return [account(subject.accountId)];
    case 'request':
      return [
        account(subject.driverAccountId),
        ...subject.garageIds.map(garage),
      ];
    case 'quote':
    case 'message':
      return [account(subject.driverAccountId), garage(subject.garageId)];
    case 'booking':
    case 'job':
      return [
        account(subject.driverAccountId),
        garage(subject.garageId),
        ...(subject.mechanicId ? [`mechanic:${subject.mechanicId}`] : []),
      ];
    // The admins too: a report, a decision or a deletion moves their queue.
    case 'review':
      return [
        'admin',
        garage(subject.garageId),
        account(subject.authorAccountId),
        `public:garage:${subject.garageId}`,
        ...when(subject.mechanicId, `public:mechanic:${subject.mechanicId}`),
      ];
    case 'rating':
      return [
        garage(subject.garageId),
        `public:garage:${subject.garageId}`,
        'public:search',
        ...when(subject.mechanicId, `public:mechanic:${subject.mechanicId}`),
      ];
    case 'car':
      return [account(subject.ownerAccountId)];
    case 'car_transfer':
      return [
        account(subject.sellerAccountId),
        account(subject.buyerAccountId),
      ];
    case 'repair':
      return [
        ...when(subject.ownerAccountId, `account:${subject.ownerAccountId}`),
        ...when(subject.sharedGarageId, `garage:${subject.sharedGarageId}`),
      ];
    case 'garage':
      return subject.garageIds.map(garage);
    case 'mechanic':
      // The mechanic herself too: her own card decides what she may do.
      return [
        garage(subject.garageId),
        `mechanic:${subject.mechanicId}`,
        ...when(
          subject.public,
          `public:garage:${subject.garageId}`,
          `public:mechanic:${subject.mechanicId}`,
        ),
      ];
    case 'garage_brands':
      return [
        garage(subject.garageId),
        `public:garage:${subject.garageId}`,
        ...subject.brandIds.map((id) => `public:search:${id}`),
      ];
    case 'verification':
      return [
        'admin',
        garage(subject.garageId),
        ...when(
          subject.published,
          `public:garage:${subject.garageId}`,
          'public:search',
        ),
        ...(subject.published
          ? (subject.brandIds ?? []).map((id) => `public:search:${id}`)
          : []),
      ];
    case 'public_garage':
      return [
        garage(subject.garageId),
        `public:garage:${subject.garageId}`,
        ...when(subject.results, 'public:search'),
      ];
    case 'garage_report':
      return ['admin', ...new Set(subject.reporterIds.map(account))];
    case 'platform':
      return subject.adminOnly ? ['admin'] : ['admin', 'system'];
    case 'time_block':
      return [
        garage(subject.garageId),
        ...when(subject.mechanicId, `mechanic:${subject.mechanicId}`),
        `public:garage:${subject.garageId}`,
      ];
    case 'catalogue_job':
      return subject.garageId ? ['admin', garage(subject.garageId)] : ['admin'];
  }
}
