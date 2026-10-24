// @traces 140-FR-002
import 'reflect-metadata';

import { DATA_EXPORT_STATUSES, DataExportDto } from './data-export.dto';

interface Documented {
  enum?: unknown[];
  format?: string;
  nullable?: boolean;
  required?: boolean;
  type?: unknown;
}

const documented = (name: string) =>
  Reflect.getMetadata(
    'swagger/apiModelProperties',
    DataExportDto.prototype,
    name,
  ) as Documented | undefined;

const listed = () =>
  (
    (Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      DataExportDto.prototype,
    ) ?? []) as string[]
  ).map((name) => name.replace(/^:/, ''));

describe('the data export in the contract', () => {
  it('has the four states of an export, in their order', () => {
    expect(DATA_EXPORT_STATUSES).toEqual([
      'queued',
      'ready',
      'expired',
      'failed',
    ]);
  });

  it('says the state, the three times and when a new request is allowed, nothing more', () => {
    expect(listed().sort()).toEqual([
      'canRequestAt',
      'expiresAt',
      'readyAt',
      'requestedAt',
      'status',
    ]);
  });

  it('names the state as one of the four', () => {
    expect(documented('status')?.enum).toEqual([...DATA_EXPORT_STATUSES]);
    expect(documented('status')?.nullable).toBeFalsy();
  });

  it('gives the request time always, as a date-time', () => {
    expect(documented('requestedAt')).toEqual(
      expect.objectContaining({ format: 'date-time', type: String }),
    );
    expect(documented('requestedAt')?.nullable).toBeFalsy();
  });

  it.each(['readyAt', 'expiresAt', 'canRequestAt'])(
    'gives %s as a date-time or null',
    (name) => {
      expect(documented(name)).toEqual(
        expect.objectContaining({
          format: 'date-time',
          nullable: true,
          type: String,
        }),
      );
    },
  );
});
