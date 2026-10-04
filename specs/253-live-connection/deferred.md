# Deferred — 253-live-connection

- [ ] LOW live integration specs leave a handle open in worker mode (Jest: "A worker process has failed to exit gracefully"); not reproduced under `--runInBand --detectOpenHandles`, likely the deaf Redis client retrying or the adversary's TCP relay — libs/domain/src/events/live.adversary.http.integration.spec.ts:624, live.api.integration.spec.ts:430 (spec-reviewer #3)
