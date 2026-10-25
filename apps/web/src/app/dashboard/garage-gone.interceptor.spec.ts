import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';
import { firstValueFrom } from 'rxjs';

import { garageGoneInterceptor } from './garage-gone.interceptor';
import { account, settle, setup } from './signed-in.testing';

const OWN = '0f9c2a54-6a1e-4f43-9d2b-2f5a3c1d7e10';
const OTHER = '7b1d3e2f-4c5a-4e6b-8f7a-9c0d1e2f3a4b';

const held = (garageId: string) =>
  ({
    features: {},
    garageId,
    name: 'Atelier Test',
    permissions: {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    },
    role: 'mechanic',
    status: 'approved',
  }) as MeDto['garageAccess'][number];

const MECHANIC = account({
  capabilities: ['garage.own_jobs', 'garage.schedule'],
  garageAccess: [held(OWN)],
  garageId: OWN,
  landing: '/app/garage',
  role: 'mechanic',
  roles: ['mechanic'],
});
const REMOVED = account({
  ...MECHANIC,
  capabilities: [],
  garageAccess: [],
  garageId: null,
});

let server: HttpTestingController;

async function signedIn(first: MeDto = MECHANIC) {
  const parts = setup({
    me: { meControllerMe: jest.fn(async () => first) },
    providers: [
      provideHttpClient(withInterceptors([garageGoneInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  await parts.session.load();
  await settle();
  parts.me.meControllerMe.mockClear();
  server = TestBed.inject(HttpTestingController);
  const http = TestBed.inject(HttpClient);
  // A call the server answers with `status`; its refusal reaches the caller.
  const call = async (url: string, status = 404) => {
    const answer = firstValueFrom(http.get(url)).catch((e: unknown) => e);
    server
      .expectOne(url)
      .flush({ code: 'not_found' }, { status, statusText: 'x' });
    const outcome = await answer;
    await settle();
    return outcome;
  };
  return { ...parts, call };
}

afterEach(() => server?.verify());

// @traces 102-FR-016
describe('a 404 under the garage’s own path', () => {
  it('reads the account again once, and says the garage is gone when it is no longer held', async () => {
    const { call, me, session } = await signedIn();
    me.meControllerMe.mockResolvedValue(REMOVED);

    const outcome = await call(`/api/v1/garages/${OWN}/jobs`);

    expect(me.meControllerMe).toHaveBeenCalledTimes(1);
    expect(session.garageGone()).toBe(true);
    // The caller still gets its refusal.
    expect(outcome).toMatchObject({ status: 404 });
  });

  it('changes nothing when the garage is still held: a feature off, a resource gone', async () => {
    const { call, me, session } = await signedIn();
    me.meControllerMe.mockResolvedValue(MECHANIC);

    await call(`/api/v1/garages/${OWN}/requests/abc`);

    expect(me.meControllerMe).toHaveBeenCalledTimes(1);
    expect(session.garageGone()).toBe(false);
    expect(session.current()?.garageId).toBe(OWN);
  });

  it('reads once for 404s that arrive while a re-read is in flight', async () => {
    const { me, session } = await signedIn();
    let answer: (me: MeDto) => void = () => undefined;
    me.meControllerMe.mockImplementation(
      () => new Promise<MeDto>((resolve) => (answer = resolve)),
    );
    const http = TestBed.inject(HttpClient);
    const urls = [
      `/api/v1/garages/${OWN}/jobs`,
      `/api/v1/garages/${OWN}/schedule`,
      `/api/v1/garages/${OWN}/mechanics`,
    ];
    const calls = urls.map((url) =>
      firstValueFrom(http.get(url)).catch(() => undefined),
    );
    for (const url of urls)
      server.expectOne(url).flush(null, { status: 404, statusText: 'x' });
    await Promise.all(calls);
    await settle();

    expect(me.meControllerMe).toHaveBeenCalledTimes(1);
    answer(REMOVED);
    await settle();
    expect(session.garageGone()).toBe(true);
  });

  it('joins a re-read already in flight rather than sending a second', async () => {
    const { call, me, session } = await signedIn();
    let answer: (me: MeDto) => void = () => undefined;
    me.meControllerMe.mockImplementation(
      () => new Promise<MeDto>((resolve) => (answer = resolve)),
    );
    const live = session.reload();

    await call(`/api/v1/garages/${OWN}/jobs`);
    answer(REMOVED);
    await live;
    await settle();

    expect(me.meControllerMe).toHaveBeenCalledTimes(1);
    expect(session.garageGone()).toBe(true);
  });

  it.each([
    ['another garage', `/api/v1/garages/${OTHER}/jobs`, 404],
    ['the public garage read', `/api/v1/garages/${OWN}`, 404],
    ['a path outside the garages', `/api/v1/jobs/${OWN}/`, 404],
    ['a refusal', `/api/v1/garages/${OWN}/jobs`, 403],
    ['a server error', `/api/v1/garages/${OWN}/jobs`, 500],
  ])('does nothing on %s', async (_, url, status) => {
    const { call, me, session } = await signedIn();
    me.meControllerMe.mockResolvedValue(REMOVED);

    await call(url, status);

    expect(me.meControllerMe).not.toHaveBeenCalled();
    expect(session.garageGone()).toBe(false);
  });

  it('leaves a garage account that never had a garage untouched', async () => {
    const { call, me, session } = await signedIn(
      account({ garageId: null, landing: '/app/garage', role: 'garage' }),
    );

    await call(`/api/v1/garages/${OWN}/jobs`);

    expect(me.meControllerMe).not.toHaveBeenCalled();
    expect(session.garageGone()).toBe(false);
  });

  it('forgets the lost garage once the account holds it again or another role is on', async () => {
    const { call, me, session } = await signedIn();
    me.meControllerMe.mockResolvedValue(REMOVED);
    await call(`/api/v1/garages/${OWN}/jobs`);
    expect(session.garageGone()).toBe(true);

    me.meControllerMe.mockResolvedValue(MECHANIC);
    await session.reload();
    expect(session.garageGone()).toBe(false);

    session.current.set({ ...REMOVED, role: 'driver' });
    expect(session.garageGone()).toBe(false);
  });
});
