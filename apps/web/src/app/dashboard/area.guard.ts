import { inject } from '@angular/core';
import { type CanMatchFn, RedirectCommand, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { Session } from './session';

export const areaGuard =
  (area: 'driver' | 'garage' | 'admin'): CanMatchFn =>
  async () => {
    const router = inject(Router);
    const i18n = inject(I18n);
    const session = inject(Session);
    const me = await session.load();
    // Nobody signed in: Home, with the sign-in dialog open over it, keeping
    // the address asked for to open once they sign in.
    if (!me) {
      const asked = router.currentNavigation()?.extractedUrl;
      if (asked) session.keepReturnTo(router.serializeUrl(asked));
      return new RedirectCommand(router.parseUrl(`/${i18n.language()}`), {
        state: { signIn: true },
      });
    }
    return me.landing === `/app/${area}` ? true : router.parseUrl(me.landing);
  };
