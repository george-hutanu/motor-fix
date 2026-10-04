import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

import { Session } from '../dashboard/session';

// The session lives in the browser's memory, so the server renders the
// placeholder without asking for one.
export const signedInToDashboard: CanActivateFn = async () => {
  if (isPlatformServer(inject(PLATFORM_ID))) return true;
  const router = inject(Router);
  const me = await inject(Session).load();
  return me ? router.parseUrl(me.landing) : true;
};
