// The jobs a garage prices when it lists itself. A job is matched by its
// `key` across loads, so a key never changes once shipped; the file wins on
// the names and on the kind of work. A job missing from this list stays as it
// is. `rarActivity` is the code in `rar_activity` a garage's RAR authorisation
// must hold for the job to show on its profile; null is work any garage may do.
// `needsLift` marks work done on a lift: the confirm dialog asks for one first.
export interface JobTypeRecord {
  key: string;
  nameRo: string;
  nameEn: string;
  needsLift: boolean;
  rarActivity: string | null;
}

export const JOB_TYPES: readonly JobTypeRecord[] = [
  {
    key: 'diagnosis',
    nameEn: 'Diagnosis and fault-code read',
    nameRo: 'Diagnoză și citire coduri de eroare',
    needsLift: false,
    rarActivity: null,
  },
  {
    key: 'oil-service',
    nameEn: 'Oil and filter service',
    nameRo: 'Schimb de ulei și filtre',
    needsLift: true,
    rarActivity: 'mechanics',
  },
  {
    key: 'front-brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    needsLift: true,
    rarActivity: 'brakes',
  },
  {
    key: 'timing-chain',
    nameEn: 'Timing chain kit',
    nameRo: 'Kit lanț de distribuție',
    needsLift: true,
    rarActivity: 'mechanics',
  },
  {
    key: 'ac-regas',
    nameEn: 'Air-con regas',
    nameRo: 'Încărcare freon climă',
    needsLift: false,
    rarActivity: 'air_con',
  },
  {
    key: 'suspension-alignment',
    nameEn: 'Suspension check and alignment',
    nameRo: 'Verificare suspensie și geometrie',
    needsLift: true,
    rarActivity: 'suspension',
  },
];

export class JobTypeFileError extends Error {}

export function validateJobTypes(records: readonly JobTypeRecord[]) {
  const seen = {
    key: new Map<string, string>(),
    nameEn: new Map<string, string>(),
    nameRo: new Map<string, string>(),
  };
  for (const record of records) {
    for (const field of ['key', 'nameRo', 'nameEn'] as const) {
      const value = record[field];
      if (value.trim() === '') {
        throw new JobTypeFileError(`job "${record.key}" has a blank ${field}`);
      }
      const holder = seen[field].get(value);
      if (holder !== undefined) {
        throw new JobTypeFileError(
          `duplicate ${field} "${value}": ${holder}, ${record.key}`,
        );
      }
      seen[field].set(value, record.key);
    }
  }
}
