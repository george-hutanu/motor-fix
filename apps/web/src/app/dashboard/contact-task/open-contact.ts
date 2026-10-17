import type { Overlays } from '@motor-fix/overlays';

// Opens "Ajutor și contact" over the view on screen, the form loaded only
// then; the drawer returns the focus to the entry that opened it.
export const openContact = (overlays: Overlays) =>
  overlays.open<true>(
    () => import('./contact-task').then((m) => m.ContactTask),
    { shape: 'drawer', title: 'shell.contact.title' },
  );
