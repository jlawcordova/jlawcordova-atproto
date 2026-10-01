import type { Env } from "./env.js";

/** The numeric GitHub ID is what's trusted; usernames can be renamed and reclaimed. */
export function isAllowedId(env: Pick<Env, "ALLOWED_GITHUB_USER_ID">, id: unknown): boolean {
  return typeof id === "number" && Number.isSafeInteger(id) && String(id) === env.ALLOWED_GITHUB_USER_ID;
}

/**
 * Both the ID and the login must match. The login check guards against a typo
 * in the configured ID.
 */
export function isOwner(
  env: Pick<Env, "ALLOWED_GITHUB_USER_ID" | "ALLOWED_GITHUB_LOGIN">,
  user: { id?: unknown; login?: unknown },
): boolean {
  return (
    isAllowedId(env, user.id) &&
    typeof user.login === "string" &&
    user.login.toLowerCase() === env.ALLOWED_GITHUB_LOGIN.toLowerCase()
  );
}
