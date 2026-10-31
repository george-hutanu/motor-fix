import { signal } from '@angular/core';
import {
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
  type MeDto,
} from '@motor-fix/data-access';

import { ADMIN_KEYS } from '../admin-layout';
import { Session } from '../session';

export const layoutAnswer = (
  panels: DashboardPanelDto[] = ADMIN_KEYS.map((key) => ({
    key,
    visible: true,
  })),
) => ({ panels, role: 'admin', updatedAt: null }) as DashboardLayoutDto;

// A signed-in admin whose Panou layout answers the default unless told
// otherwise, for the specs that render Panou.
export function adminLayoutProviders(
  api: Partial<Record<keyof DashboardLayoutsService, unknown>> = {},
) {
  const me = signal({
    id: 'admin-1',
    role: 'admin',
    roles: ['admin'],
  } as unknown as MeDto);
  return [
    { provide: Session, useValue: { current: me, shown: me } },
    {
      provide: DashboardLayoutsService,
      useValue: {
        dashboardLayoutsControllerRead: async () => layoutAnswer(),
        dashboardLayoutsControllerReset: async () => layoutAnswer(),
        dashboardLayoutsControllerSave: async ({
          body,
        }: {
          body: { panels: DashboardPanelDto[] };
        }) => layoutAnswer(body.panels),
        ...api,
      },
    },
  ];
}
