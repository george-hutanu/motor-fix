// Whether the module at `moduleUrl` is the script Node was started with.
// Node resolves a module's URL to its real path but keeps process.argv[1] as
// typed, so a script started through a symlink would otherwise not see itself.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntryPoint(moduleUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
