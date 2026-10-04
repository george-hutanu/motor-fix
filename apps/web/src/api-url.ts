// Server side only: the API's private address. The local default lets
// `nx serve web` work next to `nx serve api` without an .env file.
export const apiInternalUrl = () =>
  process.env['API_INTERNAL_URL'] ?? 'http://localhost:3000';
