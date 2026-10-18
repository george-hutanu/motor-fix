// A listing as list-your-garage's specs fill it in.

// The three jobs a new listing starts with.
export const JOBS: [string, string, string][] = [
  ['Diagnoză și citire coduri de eroare', '100', '250'],
  ['Schimb de ulei și filtre', '150', '300'],
  ['Plăcuțe și discuri de frână față', '300', '600'],
];

// The store checks the first bytes only.
export const jpeg = (name: string) => ({
  buffer: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  mimeType: 'image/jpeg',
  name,
});

// A browser copy with steps 1, 5 and 6 filled in: what is left is the
// brands, the prices and a photo, which the test fixes from the summary.
export const KEPT = {
  data: {
    declaredAt: '2026-10-11T10:00:00.000Z',
    declaredByName: 'Ion Popescu',
    steps: {
      '1': {
        businessKind: 'company',
        knownFor: 'Frâne și distribuție',
        name: 'Service Popescu',
        phone: '0722 123 456',
      },
      '5': {
        payments: ['cash'],
        place: {
          address: 'Strada Ștefan cel Mare 12, Sector 2, București',
          lat: 44.4512,
          lng: 26.1207,
        },
      },
      '6': { cui: '18547290', rarNumber: 'BV-123' },
    },
  },
  dirty: false,
  language: 'ro',
  savedAt: '2026-10-11T10:00:00.000Z',
  step: 1,
};
