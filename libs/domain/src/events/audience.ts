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
  | { type: 'car'; ownerAccountId: string }
  | { type: 'repair'; ownerAccountId: string; sharedGarageId: string | null }
  | {
      type: 'verification';
      garageId: string;
      // An approval: the garage's public page and the results of every brand.
      published?: true;
    }
  // The garages' staff only: an invite, a mechanic row.
  | { type: 'garage'; garageIds: readonly string[] }
  // A change to the brands a garage takes: its staff, its public page and the
  // search of each brand whose stance changed.
  | { type: 'garage_brands'; garageId: string; brandIds: readonly string[] }
  // A change a visitor sees on the garage's public page; `results` when it can
  // also move the garage in search results.
  | { type: 'public_garage'; garageId: string; results: boolean }
  // A rule only the admins act on stays off the system channel.
  | { type: 'platform'; adminOnly?: boolean };

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
    case 'review':
      return [
        garage(subject.garageId),
        account(subject.authorAccountId),
        `public:garage:${subject.garageId}`,
        ...when(subject.mechanicId, `public:mechanic:${subject.mechanicId}`),
      ];
    case 'car':
      return [account(subject.ownerAccountId)];
    case 'repair':
      return [
        account(subject.ownerAccountId),
        ...(subject.sharedGarageId ? [garage(subject.sharedGarageId)] : []),
      ];
    case 'garage':
      return subject.garageIds.map(garage);
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
      ];
    case 'public_garage':
      return [
        garage(subject.garageId),
        `public:garage:${subject.garageId}`,
        ...when(subject.results, 'public:search'),
      ];
    case 'platform':
      return subject.adminOnly ? ['admin'] : ['admin', 'system'];
  }
}
