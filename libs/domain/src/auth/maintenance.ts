// Whether the platform is in maintenance.
// TODO: bind the platform rule when the maintenance switch exists; until then
// it reads as off.
export const MAINTENANCE = Symbol('MAINTENANCE');

export interface Maintenance {
  on(): Promise<boolean>;
}

export const maintenanceOff: Maintenance = { on: async () => false };
