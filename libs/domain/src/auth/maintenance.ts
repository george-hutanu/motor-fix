// Whether the platform is in maintenance. The platform rule and its switch
// arrive with the maintenance story; until then it reads as off.
export const MAINTENANCE = Symbol('MAINTENANCE');

export interface Maintenance {
  on(): Promise<boolean>;
}

export const maintenanceOff: Maintenance = { on: async () => false };
