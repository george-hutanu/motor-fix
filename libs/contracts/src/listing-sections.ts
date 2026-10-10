// Steps 1, 3 and 4 of the listing form as the draft holds them, and the
// draft's whole data envelope. The guards judge shape only, so a half-typed
// section is kept; the completeness functions say whether a step is ready to
// tick. Browser-safe: the web app and the API read the same rule.

import { type HoursSection, isHoursSection } from './garage-hours';
import {
  DECLARED_NAME_MAX,
  DOCUMENT_PAGES_MAX,
  type DraftDocuments,
  isCalendarDate,
  isDocumentKind,
} from './legal-documents/legal-documents';
import { isStep6Section, type Step6Section } from './listing-verification';
import { type BrandsSection, isBrandsSection } from './marked-brands';
import { normalisePhone } from './phone';
import { isPlaceSection, type PlaceSection } from './place-section';
import { checkPriceRange } from './price-range';

export const BUSINESS_KINDS = ['company', 'pfa', 'ii', 'mobile'] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];
export const MOBILE_LEGAL_FORMS = ['pfa', 'company'] as const;
export type MobileLegalForm = (typeof MOBILE_LEGAL_FORMS)[number];

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const KNOWN_FOR_MAX = 160;
// Room for a number typed with spaces, dashes or brackets.
export const PHONE_MAX = 30;
export const JOB_NAME_MIN = 2;
export const JOB_NAME_MAX = 80;
export const JOBS_MAX = 50;
export const ENTRIES_MAX = 500;
export const MECHANIC_NAME_MIN = 2;
export const MECHANIC_NAME_MAX = 60;
export const SPECIALITY_MAX = 80;
export const MECHANICS_MAX = 30;
// What a details field may hold while typed: the longest rule plus nothing.
const DETAILS_VALUE_MAX = 160;

export interface DetailsSection {
  name?: string;
  phone?: string;
  knownFor?: string;
  businessKind?: BusinessKind;
  mobileLegalForm?: MobileLegalForm;
}

export interface PriceEnds {
  fromBani?: number;
  toBani?: number;
}

export interface PriceEntry extends PriceEnds {
  jobTypeId?: string;
  name?: string;
  brandId?: string;
}

export interface PricesSection {
  labour?: PriceEnds;
  jobs?: PriceEntry[];
}

export interface MechanicCard {
  name: string;
  speciality?: string;
}

export interface MechanicsSection {
  onProfile?: boolean;
  mechanics?: MechanicCard[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const optional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);

const stringUpTo = (max: number) => (value: unknown) =>
  typeof value === 'string' && value.length <= max;

const oneOf = (values: readonly string[]) => (value: unknown) =>
  typeof value === 'string' && values.includes(value);

const isId = (value: unknown) => typeof value === 'string' && UUID.test(value);

const trimmedWithin = (value: string | undefined, min: number, max: number) => {
  const length = value?.trim().length ?? 0;
  return length >= min && length <= max;
};

export const isRomanianPhone = (normalised: string): boolean =>
  /^\+40\d{9}$/.test(normalised);

export function isDetailsSection(value: unknown): value is DetailsSection {
  if (!isRecord(value)) return false;
  const text = stringUpTo(DETAILS_VALUE_MAX);
  const { businessKind, knownFor, mobileLegalForm, name, phone } = value;
  return (
    onlyKeys(value, [
      'name',
      'phone',
      'knownFor',
      'businessKind',
      'mobileLegalForm',
    ]) &&
    optional(name, text) &&
    optional(phone, text) &&
    optional(knownFor, text) &&
    optional(businessKind, oneOf(BUSINESS_KINDS)) &&
    optional(mobileLegalForm, oneOf(MOBILE_LEGAL_FORMS))
  );
}

export function detailsComplete(section: DetailsSection): boolean {
  const phone = section.phone ? normalisePhone(section.phone) : null;
  const mobile = section.businessKind === 'mobile';
  return (
    trimmedWithin(section.name, NAME_MIN, NAME_MAX) &&
    phone !== null &&
    isRomanianPhone(phone) &&
    trimmedWithin(section.knownFor, 1, KNOWN_FOR_MAX) &&
    section.businessKind !== undefined &&
    (section.mobileLegalForm !== undefined) === mobile
  );
}

function isEnds(value: unknown, extra: readonly string[] = []) {
  if (!isRecord(value)) return false;
  const { fromBani, toBani } = value;
  return (
    onlyKeys(value, ['fromBani', 'toBani', ...extra]) &&
    optional(fromBani, Number.isInteger) &&
    optional(toBani, Number.isInteger)
  );
}

function isPriceEntry(value: unknown): value is PriceEntry {
  if (!isEnds(value, ['jobTypeId', 'name', 'brandId'])) return false;
  const { brandId, jobTypeId, name } = value as Record<string, unknown>;
  return (
    (jobTypeId === undefined) !== (name === undefined) &&
    optional(jobTypeId, isId) &&
    optional(name, stringUpTo(JOB_NAME_MAX)) &&
    optional(brandId, isId)
  );
}

export function isPricesSection(value: unknown): value is PricesSection {
  if (!isRecord(value) || !onlyKeys(value, ['labour', 'jobs'])) return false;
  const { jobs, labour } = value;
  if (!optional(labour, (ends) => isEnds(ends))) return false;
  if (jobs === undefined) return true;
  return (
    Array.isArray(jobs) &&
    jobs.length <= ENTRIES_MAX &&
    jobs.every(isPriceEntry) &&
    jobs.filter((entry) => entry.brandId === undefined).length <= JOBS_MAX
  );
}

const rangeComplete = (ends: PriceEnds | undefined) =>
  ends?.fromBani !== undefined &&
  ends.toBani !== undefined &&
  checkPriceRange({ fromBani: ends.fromBani, toBani: ends.toBani }).errors
    .length === 0;

export function pricesComplete(section: PricesSection): boolean {
  const jobs = section.jobs ?? [];
  return (
    rangeComplete(section.labour) &&
    jobs.some((entry) => entry.brandId === undefined) &&
    jobs.every(
      (entry) =>
        rangeComplete(entry) &&
        (entry.name === undefined ||
          trimmedWithin(entry.name, JOB_NAME_MIN, JOB_NAME_MAX)),
    )
  );
}

function isMechanicCard(value: unknown): value is MechanicCard {
  if (!isRecord(value)) return false;
  const { name, speciality } = value;
  return (
    onlyKeys(value, ['name', 'speciality']) &&
    stringUpTo(MECHANIC_NAME_MAX)(name) &&
    optional(speciality, stringUpTo(SPECIALITY_MAX))
  );
}

export function isMechanicsSection(value: unknown): value is MechanicsSection {
  if (!isRecord(value) || !onlyKeys(value, ['onProfile', 'mechanics']))
    return false;
  const { mechanics, onProfile } = value;
  return (
    optional(onProfile, (on) => typeof on === 'boolean') &&
    optional(
      mechanics,
      (rows) =>
        Array.isArray(rows) &&
        rows.length <= MECHANICS_MAX &&
        rows.every(isMechanicCard),
    )
  );
}

export const mechanicsComplete = (section: MechanicsSection): boolean =>
  (section.mechanics ?? []).every((card) =>
    trimmedWithin(card.name, MECHANIC_NAME_MIN, MECHANIC_NAME_MAX),
  );

// The form's own data: one section per step, the survey, and the storage keys
// of the files the draft holds. Each step's story checks its own section.
export interface ListingDraftData {
  steps?: Partial<{
    '1': DetailsSection;
    '2': BrandsSection;
    '3': PricesSection;
    '4': MechanicsSection;
    '5': Record<string, unknown> & HoursSection & { place?: PlaceSection };
    '6': Step6Section;
  }>;
  survey?: Record<string, unknown>;
  files?: string[];
  documents?: DraftDocuments;
  // Stamped by the server; a value the browser sends only says "ticked".
  declaredAt?: string;
  declaredByName?: string;
}

const SECTION_GUARDS: Record<string, (section: unknown) => boolean> = {
  '1': isDetailsSection,
  '2': isBrandsSection,
  '3': isPricesSection,
  '4': isMechanicsSection,
  '5': (section) =>
    isHoursSection(section) &&
    (section['place'] === undefined || isPlaceSection(section['place'])),
  '6': isStep6Section,
};
const FILE_KEY = /^[a-z_-]+\/[0-9a-f-]{36}\/[\w-]{1,64}$/;

const isFileKey = (key: unknown) =>
  typeof key === 'string' && FILE_KEY.test(key);

function isDraftDocument(kind: string, value: unknown): boolean {
  if (!isRecord(value) || !onlyKeys(value, ['pages', 'issuedOn'])) return false;
  const { issuedOn, pages } = value;
  return (
    Array.isArray(pages) &&
    pages.length >= 1 &&
    pages.length <= DOCUMENT_PAGES_MAX &&
    pages.every(isFileKey) &&
    new Set(pages).size === pages.length &&
    optional(
      issuedOn,
      (date) => kind === 'onrc_certificate' && isCalendarDate(date),
    )
  );
}

const isDraftDocuments = (value: unknown) =>
  isRecord(value) &&
  Object.entries(value).every(
    ([kind, document]) =>
      isDocumentKind(kind) && isDraftDocument(kind, document),
  );

const isSteps = (steps: unknown) =>
  isRecord(steps) &&
  Object.entries(steps).every(
    ([key, section]) =>
      Object.hasOwn(SECTION_GUARDS, key) && SECTION_GUARDS[key](section),
  );

const ENVELOPE: Record<string, (value: unknown) => boolean> = {
  declaredAt: stringUpTo(40),
  declaredByName: stringUpTo(DECLARED_NAME_MAX),
  documents: isDraftDocuments,
  files: (files) => Array.isArray(files) && files.every(isFileKey),
  steps: isSteps,
  survey: isRecord,
};

// The envelope only: an object holding nothing but those keys.
export function isListingDraftData(value: unknown): value is ListingDraftData {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) =>
        Object.hasOwn(ENVELOPE, key) && optional(entry, ENVELOPE[key]),
    )
  );
}
