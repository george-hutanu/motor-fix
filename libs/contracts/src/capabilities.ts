export const ROLES = [
  'driver',
  'garage',
  'receptionist',
  'mechanic',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'driver.requests',
  'driver.cars',
  'driver.reviews',
  'driver.saved_garages',
  'driver.settings',
  'garage.requests',
  'garage.schedule',
  'garage.move_bookings',
  'garage.final_price',
  'garage.own_jobs',
  'garage.reviews',
  'garage.team',
  'garage.prices',
  'garage.profile',
  'garage.feature_switches',
  'garage.audit_history',
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface Permissions {
  canMoveBookings: boolean;
  canAnswerQuotes: boolean;
  canRecordFinalPrice: boolean;
}

// The Security page's "Capabilities by role", for the rows this product has
// so far. Anything not listed is a "may not".
const TABLE: Record<Role, readonly Capability[]> = {
  admin: [
    'admin.garages',
    'admin.users',
    'admin.reviews',
    'admin.catalogue',
    'admin.settings',
    'admin.audit_history',
  ],
  driver: [
    'driver.requests',
    'driver.cars',
    'driver.reviews',
    'driver.saved_garages',
    'driver.settings',
  ],
  garage: [
    'garage.requests',
    'garage.schedule',
    'garage.move_bookings',
    'garage.final_price',
    'garage.own_jobs',
    'garage.reviews',
    'garage.team',
    'garage.prices',
    'garage.profile',
    'garage.feature_switches',
    'garage.audit_history',
  ],
  mechanic: ['garage.own_jobs', 'garage.schedule', 'garage.audit_history'],
  receptionist: [
    'garage.requests',
    'garage.schedule',
    'garage.move_bookings',
    'garage.final_price',
    'garage.own_jobs',
    'garage.reviews',
    'garage.profile',
    'garage.audit_history',
  ],
};

const MECHANIC_PERMISSIONS: [keyof Permissions, Capability][] = [
  ['canAnswerQuotes', 'garage.requests'],
  ['canMoveBookings', 'garage.move_bookings'],
  ['canRecordFinalPrice', 'garage.final_price'],
];

export function capabilitiesOf(
  role: Role,
  permissions: Permissions,
): Capability[] {
  // A role outside the table (the system's own actor) holds nothing.
  if (role !== 'mechanic')
    return Object.hasOwn(TABLE, role) ? [...TABLE[role]] : [];
  return [
    ...TABLE.mechanic,
    ...MECHANIC_PERMISSIONS.filter(([p]) => permissions?.[p] === true).map(
      ([, c]) => c,
    ),
  ];
}
