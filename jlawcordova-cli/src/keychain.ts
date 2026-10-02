import { execFile } from "node:child_process";

export const KEYCHAIN_SERVICE = "jlawcordova-accomplishments";
export const KEYCHAIN_ACCOUNT = "default";

/** The stored token, or undefined when there isn't one (or this isn't macOS). */
export function readKeychainToken(): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      (error, stdout) => {
        const token = stdout.trim();
        resolve(error || token === "" ? undefined : token);
      },
    );
  });
}
