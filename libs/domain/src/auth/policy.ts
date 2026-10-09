import { NotFoundException } from '@nestjs/common';

import {
  type Capability,
  capabilitiesOf,
  type Permissions,
  type Role,
} from './capabilities';

export interface Actor {
  accountId: string;
  role: Role;
  roles: Role[];
  garageId: string | null;
  permissions: Permissions;
  // Set only when an AI assistant acts for the account.
  via?: 'assistant';
  assistantGrantId?: string;
  requestId?: string;
  scopes?: ('motorfix.read' | 'motorfix.act')[];
  language?: 'ro' | 'en';
}

const FALLBACK: Role[] = [
  'admin',
  'garage',
  'receptionist',
  'mechanic',
  'driver',
];

export function roleInUse(
  tokenRole: Role | null,
  lastRole: Role,
  roles: Role[],
): Role | null {
  if (tokenRole && roles.includes(tokenRole)) return tokenRole;
  if (roles.includes(lastRole)) return lastRole;
  return FALLBACK.find((r) => roles.includes(r)) ?? null;
}

export function landingFor(role: Role) {
  if (role === 'driver') return '/app/driver';
  if (role === 'admin') return '/app/admin';
  return '/app/garage';
}

// What an actor may not reach does not exist for them: 404, never 403.
const notFound = () => new NotFoundException();

export function requireCapability(actor: Actor, capability: Capability) {
  const allowed = capabilitiesOf(actor.role, actor.permissions).includes(
    capability,
  );
  if (!allowed || (capability.startsWith('garage.') && !actor.garageId)) {
    throw notFound();
  }
}

export function assertOwner(actor: Actor, ownerAccountId: string) {
  if (actor.accountId !== ownerAccountId) throw notFound();
}

export function assertGarage(actor: Actor, garageId: string) {
  if (!actor.garageId || actor.garageId !== garageId) throw notFound();
}

export interface Customer {
  firstName: string;
  car: string;
  phone: string;
  plate: string;
}

export function describeCustomer(
  actor: Actor,
  customer: Customer,
  { ownJob }: { ownJob: boolean },
): Partial<Customer> {
  if (actor.role !== 'mechanic') return { ...customer };
  const { car, firstName, plate } = customer;
  return ownJob ? { car, firstName, plate } : { car, firstName };
}
