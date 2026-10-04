import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, LanguageChoice } from '@motor-fix/i18n';

import { Session } from './session';

function account(language: 'ro' | 'en'): MeDto {
  return {
    capabilities: [],
    email: 'andrei@example.ro',
    garageId: null,
    id: 'account-1',
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

// Each save waits until the test answers it, so its order can be checked.
function setup(signedIn: MeDto | null) {
  const pending: Pending[] = [];
  const meControllerUpdate = jest.fn(
    ({ body }: { body: { language: string } }) =>
      new Promise<MeDto>((resolve, reject) =>
        pending.push({ language: body.language, reject, resolve }),
      ),
  );
  const meControllerMe = jest.fn(() =>
    signedIn ? Promise.resolve(signedIn) : Promise.reject(new Error('401')),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe, meControllerUpdate } },
    ],
  });
  return {
    choice: TestBed.inject(LanguageChoice),
    i18n: TestBed.inject(I18n),
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

describe('saving the language on the account', () => {
  it('sends a tap made while signed in, and holds the saved account', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedIn('ro');

    await choice.pick('en');

    expect(i18n.language()).toBe('en');
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    expect(meControllerUpdate).toHaveBeenCalledWith({
      body: { language: 'en' },
    });
    pending[0].resolve(account('en'));
    await settle();
    expect(session.current()?.language).toBe('en');
  });

  it("sends nothing for a tap on the account's own language", async () => {
    const { choice, meControllerUpdate } = await signedIn('en');

    await choice.pick('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing when nobody is signed in, and keeps the choice on the device', async () => {
    const { choice, i18n, meControllerUpdate, session } = setup(null);
    await session.load();

    await choice.pick('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('sends nothing for the language the account brings at sign-in', async () => {
    localStorage.setItem('mf.lang', 'en');
    const { i18n, meControllerUpdate } = await signedIn('ro');

    expect(i18n.language()).toBe('ro');
    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing for a language chosen without the switch', async () => {
    const { choice, meControllerUpdate } = await signedIn('ro');

    await choice.choose('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('keeps the interface switched after a failed save, and sends again at the next tap', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedIn('ro');

    await choice.pick('en');
    pending[0].reject(new Error('offline'));
    await settle();

    expect(i18n.language()).toBe('en');
    expect(session.current()?.language).toBe('ro');

    await choice.pick('en');

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(pending[1].language).toBe('en');
  });

  it('sends one save at a time and ends on the last language tapped', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedIn('ro');

    await choice.pick('en');
    await choice.pick('ro');
    await choice.pick('en');
    await choice.pick('ro');

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    pending[0].resolve(account('en'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(pending[1].language).toBe('ro');
    pending[1].resolve(account('ro'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(session.current()?.language).toBe('ro');
    expect(i18n.language()).toBe('ro');
  });

  it('sends a tap once even when the answer still says the old language', async () => {
    const { choice, meControllerUpdate, pending } = await signedIn('ro');

    await choice.pick('en');
    pending[0].resolve(account('ro'));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that arrives after signing out', async () => {
    const { choice, pending, session } = await signedIn('ro');

    await choice.pick('en');
    session.current.set(null);
    pending[0].resolve(account('en'));
    await settle();

    expect(session.current()).toBeNull();
  });

  it('drops an answer that arrives after another account signed in', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedIn('ro');
    const other = { ...account('ro'), id: 'account-2', name: 'Elena' };

    await choice.pick('en');
    session.current.set(other);
    pending[0].resolve(account('en'));
    await settle();

    expect(session.current()).toBe(other);
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });
});
