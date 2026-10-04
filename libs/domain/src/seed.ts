// Run directly by Node (type stripping), so this file imports nothing from the
// workspace. Each module's seed rows are added here by the story that owns it.
if (process.env['APP_ENV'] === 'production') {
  console.error('seed refused: APP_ENV=production');
  process.exit(1);
}
