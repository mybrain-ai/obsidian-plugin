import { ROOT_SCOPE_SENTINEL } from "@/core/constants";

/** Whether a vault path is inside the folders the user chose. An empty scope
 * is the whole vault; the config folder is never in scope. */
export function isPathInScope(
  path: string,
  scope: readonly string[],
  configDir: string,
): boolean {
  if (path.startsWith(`${configDir}/`)) return false;

  if (scope.length === 0) return true;

  return scope.some((prefix) => {
    if (prefix === ROOT_SCOPE_SENTINEL) return !path.includes("/");

    return path === prefix || path.startsWith(`${prefix}/`);
  });
}
