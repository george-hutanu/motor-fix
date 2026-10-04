// Replaced at build time by the `define` option (see .env.example); `typeof`
// keeps an unreplaced build, and the tests, from throwing on the bare name.
declare const PRIMEUI_LICENSE: string | undefined;

export const primeuiLicense =
  typeof PRIMEUI_LICENSE === 'string' ? PRIMEUI_LICENSE : undefined;
