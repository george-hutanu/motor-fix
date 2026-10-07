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
  | { type: 'review'; garageId: string; authorAccountId: string }
  | { type: 'car'; ownerAccountId: string }
  | { type: 'repair'; ownerAccountId: string; sharedGarageId: string | null }
  | {
      type: 'verification';
      garageId: string;
      // An approval: the garage's public page and its brands' searches.
      published?: { brandIds: readonly string[] };
    }
  // The garages' staff only: an invite, a mechanic row.
  | { type: 'garage'; garageIds: readonly string[] }
  | { type: 'platform' };

const account = (id: string) => `account:${id}`;
const garage = (id: string) => `garage:${id}`;

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
        'public:garage',
        'public:mechanic',
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
    case 'verification':
      return [
        'admin',
        garage(subject.garageId),
        ...(subject.published
          ? [
              `public:garage:${subject.garageId}`,
              ...subject.published.brandIds.map((id) => `public:search:${id}`),
            ]
          : []),
      ];
    case 'platform':
      return ['admin', 'system'];
  }
}
