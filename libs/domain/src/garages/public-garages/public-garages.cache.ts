import { recordProfileCache } from './public-garages.metrics';

// A garage's public profile in Redis: one hash per garage, a field per brand
// in context and `-` for none, found from the slug through its own key. A
// drop advances the garage's generation first, so a read that began before it
// never writes its older answer back; the generation expires with the
// profile it guards. A drop Redis refuses throws, so the relay leaves the
// event unrelayed and retries it. The `v4` in the keys is the answer's
// shape: a change to the DTO bumps it, so no older shape is read back.
export const PROFILE_SECONDS = 600;
export const NO_BRAND = '-';
export const profileKey = (garageId: string) => `garage-profile:v4:${garageId}`;
export const slugKey = (slug: string) => `garage-profile-slug:v4:${slug}`;
export const generationKey = (garageId: string) =>
  `garage-profile-gen:v4:${garageId}`;

export interface ProfileDropper {
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  incr(key: string): Promise<unknown>;
}

const PUBLIC_GARAGE = /^public:garage:(.+)$/;

// Drops the profile of every garage an event's audience reads publicly.
export async function dropProfiles(redis: ProfileDropper, audience: string[]) {
  for (const key of audience) {
    const garageId = PUBLIC_GARAGE.exec(key)?.[1];
    if (!garageId) continue;
    await redis.incr(generationKey(garageId));
    await redis.expire(generationKey(garageId), PROFILE_SECONDS);
    await redis.del(profileKey(garageId));
    recordProfileCache('drop');
  }
}
