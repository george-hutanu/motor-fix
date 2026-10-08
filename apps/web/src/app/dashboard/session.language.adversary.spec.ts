import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: 'ro' | 'en', id = 'account-1'): MeDto {
  return {
    capabilities: [],
    city: null,
    email: 'andrei@example.ro',
    emailConfirmed: true,
    garageId: null,
    id,
    landing: '/app/driver',
    language,
    name: 'Andrei',
    role: 'driver',
    roles: ['driver'],
  } as MeDto;
}

interface Pending {
  language: string;
  resolve(me: MeDto): void;
  reject(error: Error): void;
}

function setup(signedIn: MeDto | null, update?: () => Promise<MeDto>) {
  const pending: Pending[] = [];
  const meControllerUpdate = jest.fn(
    ({ body }: { body: { language: string } }) =>
      update
        ? update()
        : new Promise<MeDto>((resolve, reject) =>
            pending.push({ language: body.language, reject, resolve }),
          ),
  );
  const meControllerMe = jest.fn(() =>
    signedIn ? Promise.resolve(signedIn) : Promise.reject(new Error('401')),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe, meControllerUpdate } },
      {
        provide: AuthService,
        useValue: {
          authControllerRefresh: () =>
            signedIn
              ? Promise.resolve({ accessToken: 'renewed' })
              : Promise.reject(new Error('401')),
          authControllerSignOut: () => Promise.resolve(),
        },
      },
    ],
  });
  return {
    choice: TestBed.inject(LanguageChoice),
    i18n: TestBed.inject(I18n),
    meControllerMe,
    meControllerUpdate,
    pending,
    session: TestBed.inject(Session),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

async function signedIn(language: 'ro' | 'en' = 'ro') {
  const parts = setup(account(language));
  await parts.session.load();
  await settle();
  return parts;
}

beforeEach(() => localStorage.clear());

describe('saving the language under hostile conditions', () => {
  it('does not send the queued choice once the person has signed out', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedIn('ro');

    await choice.pick('en');
    await choice.pick('ro');
    session.current.set(null);
    pending[0].resolve(account('en'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    expect(session.current()).toBeNull();
    expect(i18n.language()).toBe('ro');
  });

  it('does not send the queued choice to another account that signed in meanwhile', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedIn('ro');
    const other = account('ro', 'account-2');

    await choice.pick('en');
    await choice.pick('ro');
    await choice.pick('en');
    session.current.set(other);
    pending[0].resolve(account('en'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    expect(session.current()).toBe(other);
  });

  it('sends nothing when the last tap returns to the language the saved account now has', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedIn('ro');

    await choice.pick('en');
    await choice.pick('ro');
    await choice.pick('en');
    pending[0].resolve(account('en'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    expect(session.current()?.language).toBe('en');
  });

  it('shows no error and keeps the choice when the call throws instead of rejecting', async () => {
    const { choice, i18n, meControllerUpdate, session } = setup(
      account('ro'),
      () => {
        throw new Error('sync failure');
      },
    );
    await session.load();
    await settle();

    await expect(choice.pick('en')).resolves.toBeUndefined();
    await settle();

    expect(i18n.language()).toBe('en');
    expect(session.current()?.language).toBe('ro');
    await choice.pick('en');
    await settle();
    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
  });

  it('keeps sending after repeated failed saves', async () => {
    const { choice, pending, meControllerUpdate } = await signedIn('ro');

    await choice.pick('en');
    pending[0].reject(new Error('offline'));
    await settle();
    await choice.pick('en');
    pending[1].reject(new Error('offline'));
    await settle();
    await choice.pick('en');

    expect(meControllerUpdate).toHaveBeenCalledTimes(3);
  });

  it('does not save when loading the account changes the interface language', async () => {
    const { i18n, meControllerUpdate, session } = setup(account('en'));
    localStorage.setItem('mf.lang', 'ro');

    await session.load();
    await settle();

    expect(i18n.language()).toBe('en');
    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('does not save a tap made after signing out', async () => {
    const { choice, meControllerUpdate, session } = await signedIn('ro');
    session.current.set(null);

    await choice.pick('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('does not load the session when a signed-out visitor taps', async () => {
    const { choice, meControllerMe, session } = setup(account('ro'));

    await choice.pick('en');
    await settle();

    expect(meControllerMe).not.toHaveBeenCalled();
    expect(session.current()).toBeNull();
  });

  it('ignores a tap on a value that is not a language', async () => {
    const { choice, meControllerUpdate, i18n } = await signedIn('ro');

    await choice.pick('fr');
    await choice.pick('EN');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
    expect(i18n.language()).toBe('ro');
  });

  it('holds the account the server answered with', async () => {
    const { choice, pending, session } = await signedIn('ro');
    const answered = { ...account('en'), name: 'Andrei Popescu' };

    await choice.pick('en');
    pending[0].resolve(answered);
    await settle();

    expect(session.current()).toEqual(answered);
  });

  it('sends exactly one save for a hundred taps on the same new language', async () => {
    const { choice, meControllerUpdate, pending } = await signedIn('ro');

    for (let i = 0; i < 100; i++) await choice.pick('en');
    pending[0].resolve(account('en'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });
});
