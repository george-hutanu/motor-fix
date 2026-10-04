# Contract: the `storage` module (libs/domain) and the upload helper (libs/media)

## StorageService (Nest provider, exported by the global `StorageModule.register(options)`)

```ts
createUpload(purpose: FilePurpose, ownerRef: string, contentType: string, size: number)
  : Promise<SignedUpload>                 // { key, url, fields, expiresAt }
confirmUpload(key: string, purpose: FilePurpose, ownerRef: string): Promise<string>   // final key
createDownloadUrl(key: string, fileName: string | undefined,
                  disposition: 'inline' | 'attachment', minutes: number): Promise<string>
putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void>
deleteObject(key: string): Promise<void>
ready(): Promise<void>                    // HEAD bucket; rejects when the store does not answer
```

Options: `{ endpoint, region, bucket, accessKeyId, secretAccessKey }` from `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.

Refusals (thrown as Nest `HttpException`, body `{ code, message }`):

| When | Status | code |
| --- | --- | --- |
| type not allowed for the purpose | 422 | `file_type_not_allowed` |
| declared or stored size above the limit | 422 | `file_too_large` |
| first bytes do not match the declared type | 422 | `file_type_mismatch` |
| no object at the key, or key not the caller's incoming key | 409 | `file_missing` |

A size that is not a positive integer, an unknown purpose or an owner id that is not a plain identifier throws `BadRequestException` (400, `validation_failed`): the owning endpoint's DTO should have caught it.

## SignedUpload

`{ key: string; url: string; fields: Record<string, string>; expiresAt: string (ISO) }` — a type exported from `libs/domain`. The first owning endpoint (EP-2) adds the matching DTO to `libs/contracts` for its OpenAPI.

## `/health/ready` (api and worker)

`checks` gains `storage: 'ok' | 'error'`; any `error` → 503.

## FileUploader (`@motor-fix/media`, Angular, `providedIn: 'root'`)

```ts
upload<T>(file: Blob,
          ask: () => Observable<{ key: string; url: string; fields: Record<string, string> }>,
          confirm: (key: string) => Observable<T>)
  : Observable<{ progress: number } | { done: T }>
```

Errors: the observable errors with the last `HttpErrorResponse` after 3 retries of a dropped connection, or after a second refusal from the store following one fresh address.
