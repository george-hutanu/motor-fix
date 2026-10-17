import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type MeDto, SavedGaragesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { SavedGarages } from './saved-garages';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: Object.assign(
    jest.fn(() => 'bar'),
    { dismiss: jest.fn() },
  ),
}));

type Role = MeDto['role'];

const problem = (status: number, code = 'x') =>
  new HttpErrorResponse({ error: { code, status }, status });
const row = (garageId: string, savedAt = '2026-10-01T08:00:00.000Z') => ({
  garageId,
  savedAt,
});

let api: {
  savedGaragesControllerIds: jest.Mock;
  savedGaragesControllerRemove: jest.Mock;
  savedGaragesControllerSave: jest.Mock;
};
let current: ReturnType<typeof signal<{ role: Role } | null>>;
let roleHint: ReturnType<typeof signal<Role | null>>;
let load: jest.Mock;
let gate: jest.Mock;

async function store(
  options: {
    role?: Role | null;
    hint?: Role | null;
    saved?: string[];
    // Who the sign-in gate signs in, or false when it is closed unsigned.
    signsIn?: Role | false;
  } = {},
) {
  current = signal(options.role ? { role: options.role } : null);
  roleHint = signal(options.hint ?? options.role ?? null);
  load = jest.fn(async () => current());
  gate = jest.fn(async () => {
    if (!options.signsIn) return false;
    current.set({ role: options.signsIn });
    return true;
  });
  api = {
    savedGaragesControllerIds: jest.fn(async () => ({
      ids: options.saved ?? [],
    })),
    savedGaragesControllerRemove: jest.fn(async ({ garageId }) =>
      row(garageId),
    ),
    savedGaragesControllerSave: jest.fn(async ({ garageId, body }) =>
      row(garageId, body?.savedAt ?? '2026-10-17T09:00:00.000Z'),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: SavedGaragesService, useValue: api },
      { provide: SignInDialog, useValue: { gate } },
      { provide: Session, useValue: { current, load, roleHint } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  return TestBed.inject(SavedGarages);
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r));
};
const undoOf = () => {
  const call = jest
    .mocked(toast)
    .mock.calls.find(([text]) => text === 'Scos din salvate');
  const onClick = call?.[1]?.action?.onClick;
  if (!onClick) throw new Error('no undo bar was shown');
  return () => onClick(new MouseEvent('click'));
};

beforeEach(() => {
  jest.mocked(toast).mockClear();
  jest.mocked(toast.dismiss).mockClear();
  sessionStorage.clear();
});
afterEach(() => TestBed.resetTestingModule());

// @traces 290-FR-011
describe('reading what a driver saved', () => {
  it('reads the ids once for a driver and marks them saved', async () => {
    const saved = await store({ role: 'driver', saved: ['g1', 'g2'] });

    await saved.load();

    expect(api.savedGaragesControllerIds).toHaveBeenCalledTimes(1);
    expect([...saved.ids()].sort()).toEqual(['g1', 'g2']);
  });

  // The page's address names its language (021-FR-002): reading the session
  // for the role keeps it.
  it("reads the session without taking the account's language", async () => {
    const saved = await store({ hint: 'driver' });

    await saved.load();

    expect(load).toHaveBeenCalledWith({ keepLanguage: true });
  });

  it('reads nothing for a visitor', async () => {
    const saved = await store({ role: null });

    await saved.load();

    expect(api.savedGaragesControllerIds).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(saved.ids().size).toBe(0);
  });

  it.each(['garage', 'mechanic'] as const)(
    'reads nothing for the %s role',
    async (role) => {
      const saved = await store({ role });

      await saved.load();

      expect(api.savedGaragesControllerIds).not.toHaveBeenCalled();
    },
  );

  it('leaves the controls unsaved and usable when the read fails', async () => {
    const saved = await store({ role: 'driver' });
    api.savedGaragesControllerIds.mockRejectedValueOnce(problem(500));

    await saved.load();

    expect(saved.ids().size).toBe(0);
    expect(toast).not.toHaveBeenCalled();
  });
});

// @traces 290-FR-012
describe('saving', () => {
  it('shows the garage saved at once, then the toast', async () => {
    const saved = await store({ role: 'driver' });

    const done = saved.tap('g1');
    expect(saved.ids().has('g1')).toBe(true);
    await done;

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: {},
      garageId: 'g1',
    });
    expect(toast).toHaveBeenCalledWith('Salvat în Service‑uri salvate');
  });

  it('puts the garage in unavailable on 404, with no toast', async () => {
    const saved = await store({ role: 'driver' });
    api.savedGaragesControllerSave.mockRejectedValueOnce(
      problem(404, 'not_found'),
    );

    await saved.tap('g1');

    expect(saved.ids().has('g1')).toBe(false);
    expect(saved.unavailable().has('g1')).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('goes back and says there is no connection when no answer came', async () => {
    const saved = await store({ role: 'driver' });
    api.savedGaragesControllerSave.mockRejectedValueOnce(problem(0));

    await saved.tap('g1');

    expect(saved.ids().has('g1')).toBe(false);
    expect(toast).toHaveBeenCalledWith('Fără conexiune');
  });

  it('goes back with the error text on another error', async () => {
    const saved = await store({ role: 'driver' });
    api.savedGaragesControllerSave.mockRejectedValueOnce(problem(500));

    await saved.tap('g1');

    expect(saved.ids().has('g1')).toBe(false);
    expect(toast).toHaveBeenCalledWith('Nu a mers. Încearcă din nou.');
  });

  it('does nothing on a second tap while the first is in flight', async () => {
    const saved = await store({ role: 'driver' });

    const first = saved.tap('g1');
    const second = saved.tap('g1');
    await Promise.all([first, second]);

    expect(api.savedGaragesControllerSave).toHaveBeenCalledTimes(1);
    expect(api.savedGaragesControllerRemove).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(true);
  });
});

// @traces 290-FR-013
describe('removing and the undo', () => {
  it('removes at once and shows the undo bar for 8 seconds', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();

    const done = saved.tap('g1');
    expect(saved.ids().has('g1')).toBe(false);
    await done;

    expect(api.savedGaragesControllerRemove).toHaveBeenCalledWith({
      garageId: 'g1',
    });
    expect(toast).toHaveBeenCalledWith('Scos din salvate', {
      action: { label: 'Anulează', onClick: expect.any(Function) },
      duration: 8000,
    });
  });

  it('saves again with the removed time when Anulează is tapped', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    await saved.tap('g1');

    undoOf()();
    await settle();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: { savedAt: '2026-10-01T08:00:00.000Z' },
      garageId: 'g1',
    });
    expect(saved.ids().has('g1')).toBe(true);
  });

  it('goes back to unsaved with the error toast when the undo fails', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    await saved.tap('g1');
    api.savedGaragesControllerSave.mockRejectedValueOnce(
      problem(422, 'saved_at_in_future'),
    );

    undoOf()();
    await settle();

    expect(saved.ids().has('g1')).toBe(false);
    expect(toast).toHaveBeenLastCalledWith('Nu a mers. Încearcă din nou.');
  });

  it('puts the garage back and drops the bar when the removal fails', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    api.savedGaragesControllerRemove.mockRejectedValueOnce(problem(500));

    await saved.tap('g1');

    expect(saved.ids().has('g1')).toBe(true);
    expect(toast.dismiss).toHaveBeenCalledWith('bar');
    expect(toast).toHaveBeenLastCalledWith('Nu a mers. Încearcă din nou.');
  });

  it('waits for the removal when Anulează is tapped before it answered', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    let answer: (value: unknown) => void = () => undefined;
    api.savedGaragesControllerRemove.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const removing = saved.tap('g1');
    await settle();
    undoOf()();
    await settle();
    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();

    answer(row('g1'));
    await removing;
    await settle();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: { savedAt: '2026-10-01T08:00:00.000Z' },
      garageId: 'g1',
    });
  });

  it('sends the save with no time when the removal found nothing', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    api.savedGaragesControllerRemove.mockResolvedValueOnce(null);
    await saved.tap('g1');

    undoOf()();
    await settle();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: {},
      garageId: 'g1',
    });
  });

  it('dismisses the previous bar when another garage is removed', async () => {
    const saved = await store({ role: 'driver', saved: ['g1', 'g2'] });
    await saved.load();

    await saved.tap('g1');
    await saved.tap('g2');

    expect(toast.dismiss).toHaveBeenCalledWith('bar');
  });
});

// @traces 290-FR-014
describe('a visitor who taps save', () => {
  it('opens the sign-in dialog and sends nothing before it', async () => {
    const saved = await store({ role: null, signsIn: false });

    await saved.tap('g1');

    expect(load).toHaveBeenCalledWith({ keepLanguage: true });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(false);
  });

  it('keeps the tapped garage for the tab while the dialog is open', async () => {
    const saved = await store({ role: null });
    let seen: string | null = null;
    gate.mockImplementationOnce(async () => {
      seen = sessionStorage.getItem('mf-pending-save');
      return false;
    });

    await saved.tap('g1');

    expect(seen).toBe('g1');
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });

  it('saves the tapped garage once a driver signed in, staying on the page', async () => {
    const saved = await store({ role: null, signsIn: 'driver' });

    await saved.tap('g1');

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: {},
      garageId: 'g1',
    });
    expect(saved.ids().has('g1')).toBe(true);
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });

  it('does not remove a garage the driver who signed in had already saved', async () => {
    const saved = await store({
      role: null,
      saved: ['g1'],
      signsIn: 'driver',
    });

    await saved.tap('g1');

    expect(api.savedGaragesControllerRemove).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(true);
  });

  it('sends nothing for an account without the driver role', async () => {
    const saved = await store({ role: null, signsIn: 'garage' });

    await saved.tap('g1');

    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });

  it('saves the kept garage on the page a provider sign-in returned to', async () => {
    const saved = await store({ role: 'driver' });
    sessionStorage.setItem('mf-pending-save', 'g1');

    await saved.load();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: {},
      garageId: 'g1',
    });
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });

  it('does not save the kept garage when it was saved already', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    sessionStorage.setItem('mf-pending-save', 'g1');

    await saved.load();

    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });
});
