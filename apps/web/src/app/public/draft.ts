import { isListingDraftData } from '@motor-fix/contracts/listing-sections';
import type { ListingDraftDto } from '@motor-fix/data-access';

export const STORAGE_KEY = 'mf.listing-draft';
// The browser keeps what was typed a second after the typing stops; the
// server at most every five seconds of it.
export const BROWSER_SAVE_MS = 1_000;
export const SERVER_SAVE_MS = 5_000;

export interface BrowserDraft {
  data: ListingDraftDto['data'];
  step: number;
  language: 'ro' | 'en';
  email?: string;
  // Once a server copy exists, and this browser's key to it.
  draftId?: string;
  token?: string;
  // Changes the server has not confirmed yet.
  dirty: boolean;
  savedAt: string;
}

export type LoadPlan =
  | { kind: 'empty' }
  | { kind: 'local'; draft: BrowserDraft }
  | { kind: 'push'; draft: BrowserDraft }
  | { kind: 'fetch'; token: string; keep: BrowserDraft | null };

const optionalText = (value: unknown) =>
  value === undefined || typeof value === 'string';

const isEntry = (value: unknown): value is BrowserDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<BrowserDraft>;
  return (
    isListingDraftData(entry.data) &&
    optionalText(entry.token) &&
    optionalText(entry.draftId) &&
    optionalText(entry.email) &&
    Number.isInteger(entry.step) &&
    (entry.step ?? 0) >= 1 &&
    (entry.step ?? 0) <= 6 &&
    (entry.language === 'ro' || entry.language === 'en') &&
    typeof entry.dirty === 'boolean'
  );
};

// A browser that refuses storage (private mode, a blocked site) reports it
// here and nowhere throws: the form goes on in memory.
export function readDraft(storage: Storage | null): {
  draft: BrowserDraft | null;
  blocked: boolean;
} {
  if (!storage) return { blocked: true, draft: null };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { blocked: true, draft: null };
  }
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return { blocked: false, draft: isEntry(parsed) ? parsed : null };
  } catch {
    return { blocked: false, draft: null };
  }
}

export function writeDraft(
  storage: Storage | null,
  draft: BrowserDraft,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export const changed = (
  draft: BrowserDraft,
  patch: Partial<Pick<BrowserDraft, 'data' | 'email' | 'language' | 'step'>>,
  now: Date,
): BrowserDraft => ({
  ...draft,
  ...patch,
  dirty: draft.draftId !== undefined,
  savedAt: now.toISOString(),
});

export const confirmed = (
  draft: BrowserDraft,
  saved: { id: string; token?: string },
): BrowserDraft => ({
  ...draft,
  dirty: false,
  draftId: saved.id,
  token: saved.token ?? draft.token,
});

export const failed = (draft: BrowserDraft): BrowserDraft => ({
  ...draft,
  dirty: true,
});

export const fromServer = (
  server: ListingDraftDto,
  token: string,
  now: Date,
): BrowserDraft => ({
  data: server.data,
  dirty: false,
  draftId: server.id,
  email: server.email,
  language: server.language,
  savedAt: now.toISOString(),
  step: server.step,
  token,
});

// An empty form in the same language, no longer tied to the server copy
// the link lost.
export const startAgain = (
  draft: BrowserDraft,
  now = new Date(),
): BrowserDraft => ({
  data: {},
  dirty: false,
  language: draft.language,
  savedAt: now.toISOString(),
  step: 1,
});

// A link always takes the server copy. Without one, unconfirmed changes win
// and are sent; a clean entry with a key reads the server's, which another
// device may have moved on.
export function loadPlan(
  draft: BrowserDraft | null,
  linkToken?: string,
): LoadPlan {
  if (linkToken) return { keep: draft, kind: 'fetch', token: linkToken };
  if (!draft) return { kind: 'empty' };
  if (draft.dirty && draft.token) return { draft, kind: 'push' };
  if (draft.token) return { keep: draft, kind: 'fetch', token: draft.token };
  return { draft, kind: 'local' };
}
