import { inject, resource } from '@angular/core';
import { SupportService } from '@motor-fix/data-access/services/support.service';

import { publicRead } from '../../public-read';

// The support address the API is configured with, or null: unset, or not
// read. The page and the maintenance page show it only when it is a string.
export function supportAddress() {
  const api = inject(SupportService);
  const read = resource({
    loader: () =>
      api
        .supportContactControllerContact(undefined, publicRead())
        .then(({ email }) => (typeof email === 'string' ? email : null))
        .catch(() => null),
  });
  return () => read.value() ?? null;
}
