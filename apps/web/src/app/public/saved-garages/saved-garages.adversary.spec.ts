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

const pending = () => {
  let answer: (value: unknown) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { answer, fail, promise };
};

// @traces 290-FR-012
describe('double taps and races', () => {
  it('sends one removal and no save for a tap on a garage whose removal is in flight', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    const gate = pending();
    api.savedGaragesControllerRemove.mockReturnValueOnce(gate.promise);

    const first = saved.tap('g1');
    await settle();
    await saved.tap('g1');
    gate.answer(row('g1'));
    await first;

    expect(api.savedGaragesControllerRemove).toHaveBeenCalledTimes(1);
    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(false);
  });

  it('keeps a garage saved while the ids read that started earlier answers without it', async () => {
    const saved = await store({ role: 'driver' });
    const read = pending();
    api.savedGaragesControllerIds.mockReturnValueOnce(read.promise);

    const loading = saved.load();
    await settle();
    const saving = saved.tap('g1');
    read.answer({ ids: [] });
    await loading;
    await saving;

    expect(saved.ids().has('g1')).toBe(true);
  });

  it('keeps garages independent when two are tapped at once', async () => {
    const saved = await store({ role: 'driver' });

    await Promise.all([saved.tap('g1'), saved.tap('g2')]);

    expect(api.savedGaragesControllerSave).toHaveBeenCalledTimes(2);
    expect([...saved.ids()].sort()).toEqual(['g1', 'g2']);
  });

  it('sends one save when the undo is tapped twice', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    await saved.tap('g1');
    const undo = undoOf();

    undo();
    undo();
    await settle();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledTimes(1);
    expect(saved.ids().has('g1')).toBe(true);
  });

  it('removes again after a save finished and a second tap came', async () => {
    const saved = await store({ role: 'driver' });
    await saved.tap('g1');

    await saved.tap('g1');

    expect(api.savedGaragesControllerRemove).toHaveBeenCalledTimes(1);
    expect(saved.ids().has('g1')).toBe(false);
  });
});

// @traces 290-FR-013
describe('undo after things went wrong', () => {
  it('sends no save when the old undo is tapped after the removal failed', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    const gate = pending();
    api.savedGaragesControllerRemove.mockReturnValueOnce(gate.promise);
    const removing = saved.tap('g1');
    await settle();
    const undo = undoOf();

    gate.fail(problem(500));
    await removing;
    undo();
    await settle();

    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(true);
  });

  it('sends no save when the undo waits on a removal that then fails', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    const gate = pending();
    api.savedGaragesControllerRemove.mockReturnValueOnce(gate.promise);
    const removing = saved.tap('g1');
    await settle();

    undoOf()();
    gate.fail(problem(0));
    await removing;
    await settle();

    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
    expect(saved.ids().has('g1')).toBe(true);
  });

  it('marks the garage unavailable when the undo save answers 404', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    await saved.tap('g1');
    api.savedGaragesControllerSave.mockRejectedValueOnce(problem(404));

    undoOf()();
    await settle();

    expect(saved.ids().has('g1')).toBe(false);
    expect(saved.unavailable().has('g1')).toBe(true);
  });

  it('puts the garage back with the error text when the removal answers 404', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    api.savedGaragesControllerRemove.mockRejectedValueOnce(problem(404));

    await saved.tap('g1');

    expect(saved.ids().has('g1')).toBe(true);
    expect(saved.unavailable().has('g1')).toBe(false);
    expect(toast).toHaveBeenLastCalledWith('Nu a mers. Încearcă din nou.');
  });

  it('lets the garage be tapped again after a failed removal', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    api.savedGaragesControllerRemove.mockRejectedValueOnce(problem(500));
    await saved.tap('g1');

    await saved.tap('g1');

    expect(api.savedGaragesControllerRemove).toHaveBeenCalledTimes(2);
    expect(saved.ids().has('g1')).toBe(false);
  });

  it('passes an unparsable removed time back to the undo unchanged', async () => {
    const saved = await store({ role: 'driver', saved: ['g1'] });
    await saved.load();
    api.savedGaragesControllerRemove.mockResolvedValueOnce(
      row('g1', 'not a date'),
    );
    await saved.tap('g1');

    undoOf()();
    await settle();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledWith({
      body: { savedAt: 'not a date' },
      garageId: 'g1',
    });
  });
});

// @traces 290-FR-012
describe('errors on a save', () => {
  it.each([401, 403, 422, 429, 502])(
    'goes back with the shared error text on a %s',
    async (status) => {
      const saved = await store({ role: 'driver' });
      api.savedGaragesControllerSave.mockRejectedValueOnce(problem(status));

      await saved.tap('g1');

      expect(saved.ids().has('g1')).toBe(false);
      expect(saved.unavailable().has('g1')).toBe(false);
      expect(toast).toHaveBeenCalledWith('Nu a mers. Încearcă din nou.');
    },
  );

  it('does not mark other garages unavailable on a 404', async () => {
    const saved = await store({ role: 'driver' });
    api.savedGaragesControllerSave.mockRejectedValueOnce(problem(404));

    await saved.tap('g1');

    expect([...saved.unavailable()]).toEqual(['g1']);
  });
});

// @traces 290-FR-006
describe('roles that are not a driver', () => {
  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'sends nothing and opens no dialog for a tap in the %s role',
    async (role) => {
      const saved = await store({ role });

      await saved.tap('g1');
      await saved.load();

      expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
      expect(api.savedGaragesControllerRemove).not.toHaveBeenCalled();
      expect(api.savedGaragesControllerIds).not.toHaveBeenCalled();
      expect(gate).not.toHaveBeenCalled();
      expect(saved.ids().size).toBe(0);
    },
  );

  it('drops what the visitor kept when the account that signed in is not a driver', async () => {
    const saved = await store({ role: null, signsIn: 'garage' });

    await saved.tap('g1');

    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
  });
});

// @traces 290-FR-014
describe('a visitor and the kept garage', () => {
  it('ignores a second tap on the same garage while the dialog is open', async () => {
    const saved = await store({ role: null, signsIn: 'driver' });

    await Promise.all([saved.tap('g1'), saved.tap('g1')]);

    expect(gate).toHaveBeenCalledTimes(1);
    expect(api.savedGaragesControllerSave).toHaveBeenCalledTimes(1);
  });

  it('saves nothing on load when the kept value is empty', async () => {
    const saved = await store({ role: 'driver' });
    sessionStorage.setItem('mf-pending-save', '');

    await saved.load();

    expect(api.savedGaragesControllerSave).not.toHaveBeenCalled();
  });

  it('saves a kept garage once, however often the page loads', async () => {
    const saved = await store({ role: 'driver' });
    sessionStorage.setItem('mf-pending-save', 'g9');

    await saved.load();
    await saved.load();

    expect(api.savedGaragesControllerSave).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('mf-pending-save')).toBeNull();
  });
});
