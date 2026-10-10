import { test } from '@playwright/test';

// The free numbers: +40700001000 to +40700009998, under the allow-listed
// +4070000 prefix, past the seeded ones (+40700000101, +40700000102) and
// short of the number the WhatsApp stub refuses (+40700009999).
const FIRST = 1000;
const COUNT = 8999;

/** How many numbers one worker process may hand out in a run. */
export const FRESH_PER_WORKER = 100;

/**
 * The nth number of a worker in a run that starts at `base`. Each worker
 * process (a restarted one gets a new index) owns its own block of numbers,
 * so no two flows of one run meet the same account; `base` moves the blocks
 * from run to run, so a local database kept between runs is met rarely.
 */
export function phoneAt(base: number, worker: number, nth: number): string {
  if (nth >= FRESH_PER_WORKER) {
    throw new Error(
      `fresh-phone: worker ${worker} asked for more than its share of ${FRESH_PER_WORKER} numbers`,
    );
  }
  const slot = worker * FRESH_PER_WORKER + nth;
  if (slot >= COUNT) {
    throw new Error(`fresh-phone: worker ${worker} is past the free numbers`);
  }
  return `+4070000${FIRST + ((base + slot) % COUNT)}`;
}

// Set once per run by the global setup and passed to every worker.
export const PHONE_BASE_VARIABLE = 'E2E_PHONE_BASE';

export function phoneBase(): number {
  return Number(process.env[PHONE_BASE_VARIABLE] ?? 0) || 0;
}

export function newPhoneBase(): string {
  return String(Math.floor(Math.random() * COUNT));
}

let handedOut = 0;

/** A number no other flow of this run gets, for the running test's worker. */
export function freshPhone(): string {
  return phoneAt(phoneBase(), test.info().workerIndex, handedOut++);
}
