import { inject } from '@angular/core';
import { type CanMatchFn, Router } from '@angular/router';

import { Session } from './session';

export const areaGuard =
  (area: 'driver' | 'garage' | 'admin'): CanMatchFn =>
  async () => {
    const router = inject(Router);
    const me = await inject(Session).load();
    if (!me) return router.parseUrl('/');
    return me.landing === `/app/${area}` ? true : router.parseUrl(me.landing);
  };
