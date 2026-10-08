import { fold } from '@motor-fix/contracts/fold';
import {
  JOBS_MAX,
  type PriceEnds,
  type PriceEntry,
  type PricesSection,
} from '@motor-fix/contracts/listing-sections';

import type { MarkedBrand } from '../brands-section';

// The step-3 job list as pure functions over the draft's section: a job row
// (no brand) followed by its brand ranges. Each returns the section it was
// given when nothing changes, so a caller can tell.

export const PRE_LISTED = ['diagnosis', 'oil-service', 'front-brakes'] as const;

interface CatalogueJob {
  id: string;
  key: string;
}

export interface Row {
  entry: PriceEntry;
  index: number;
  brands: { entry: PriceEntry; index: number }[];
}

const named = (name: string) => fold(name.trim());

const sameJob = (a: PriceEntry, b: PriceEntry) =>
  a.jobTypeId !== undefined
    ? a.jobTypeId === b.jobTypeId
    : b.name !== undefined && named(a.name ?? '') === named(b.name);

const jobOnly = ({ jobTypeId, name }: PriceEntry): PriceEntry =>
  jobTypeId !== undefined ? { jobTypeId } : { name };

const jobsOf = (section: PricesSection) => section.jobs ?? [];

const defaults = (section: PricesSection) =>
  jobsOf(section).filter((entry) => entry.brandId === undefined);

// The three common jobs, once, for a section that never had a job list.
export function preList(
  section: PricesSection | undefined,
  catalogue: readonly CatalogueJob[],
): PricesSection {
  if (section?.jobs !== undefined) return section;
  const jobs = PRE_LISTED.flatMap((key) => {
    const found = catalogue.find((job) => job.key === key);
    return found ? [{ jobTypeId: found.id }] : [];
  });
  return { ...section, jobs };
}

export const canAdd = (section: PricesSection) =>
  defaults(section).length < JOBS_MAX;

function append(section: PricesSection, entry: PriceEntry) {
  if (!canAdd(section) || defaults(section).some((e) => sameJob(entry, e)))
    return section;
  return { ...section, jobs: [...jobsOf(section), entry] };
}

export const addJob = (section: PricesSection, job: { id: string }) =>
  append(section, { jobTypeId: job.id });

export function addProposal(section: PricesSection, typed: string) {
  const name = typed.trim();
  return name ? append(section, { name }) : section;
}

export function addBrandRange(
  section: PricesSection,
  index: number,
  brandId: string,
): PricesSection {
  const jobs = jobsOf(section);
  const job = jobs[index];
  if (!job || jobs.some((e) => e.brandId === brandId && sameJob(job, e)))
    return section;
  let at = index + 1;
  while (at < jobs.length && jobs[at].brandId !== undefined) at++;
  const entry = { ...jobOnly(job), brandId };
  return { ...section, jobs: [...jobs.slice(0, at), entry, ...jobs.slice(at)] };
}

export function rows(section: PricesSection): Row[] {
  const out: Row[] = [];
  jobsOf(section).forEach((entry, index) => {
    if (entry.brandId === undefined) out.push({ brands: [], entry, index });
    else out.at(-1)?.brands.push({ entry, index });
  });
  return out;
}

export function setEnds(
  section: PricesSection,
  index: number,
  ends: PriceEnds,
): PricesSection {
  const jobs = jobsOf(section).map((entry, i) => {
    if (i !== index) return entry;
    const next: Record<string, unknown> = { ...entry, ...ends };
    for (const key of Object.keys(ends))
      if (next[key] === undefined) delete next[key];
    return next as PriceEntry;
  });
  return { ...section, jobs };
}

// A job row goes with its brand ranges; a brand range goes alone.
export function remove(section: PricesSection, index: number): PricesSection {
  const jobs = jobsOf(section);
  const gone = jobs[index];
  if (!gone) return section;
  const kept =
    gone.brandId !== undefined
      ? jobs.filter((_, i) => i !== index)
      : jobs.filter((e) => !sameJob(gone, e));
  return { ...section, jobs: kept };
}

export function brandOffer(
  section: PricesSection,
  index: number,
  brands: readonly MarkedBrand[],
): MarkedBrand[] {
  const job = jobsOf(section)[index];
  if (!job) return [];
  const used = new Set(
    jobsOf(section)
      .filter((e) => e.brandId !== undefined && sameJob(job, e))
      .map((e) => e.brandId),
  );
  return brands.filter((b) => b.stance === 'works_on' && !used.has(b.brandId));
}

export function dropUntaken(
  section: PricesSection,
  takenIds: readonly string[],
): PricesSection {
  const jobs = jobsOf(section);
  const kept = jobs.filter(
    (e) => e.brandId === undefined || takenIds.includes(e.brandId),
  );
  return kept.length === jobs.length ? section : { ...section, jobs: kept };
}
