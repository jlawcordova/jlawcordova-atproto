import { execFile, spawn } from "node:child_process";

export const KEYCHAIN_SERVICE = "jlawcordova-accomplishments";
export const KEYCHAIN_ACCOUNT = "default";

interface Keychain {
  service?: string;
  account?: string;
}

/** The stored token, or undefined when there isn't one (or this isn't macOS). */
export function readKeychainToken({ service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT }: Keychain = {}): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], (error, stdout) => {
      const token = stdout.trim();
      resolve(error || token === "" ? undefined : token);
    });
  });
}

/** Runs a program with `input` on its stdin. Resolves with the exit code. */
export type RunWithStdin = (file: string, args: string[], input: string) => Promise<number>;

const runWithStdin: RunWithStdin = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.end(input);
  });

// OAuth tokens are letters, digits, and underscores. Anything else would need
// quoting in the command below, so it is refused instead.
const SAFE_TOKEN = /^[A-Za-z0-9_]+$/;

/**
 * Saves the token, replacing any existing one. The command goes to
 * `security -i` on stdin, so the token never appears in a process's arguments.
 * The result is read back, because interactive mode can fail without a
 * non-zero exit.
 */
export async function storeKeychainToken(
  token: string,
  { service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT }: Keychain = {},
  io: { run?: RunWithStdin; read?: (k: Keychain) => Promise<string | undefined> } = {},
): Promise<void> {
  if (!SAFE_TOKEN.test(token)) throw new Error("token has unexpected characters");
  const run = io.run ?? runWithStdin;
  const read = io.read ?? readKeychainToken;

  const code = await run("security", ["-i"], `add-generic-password -U -s ${service} -a ${account} -w ${token}\n`);
  if (code !== 0 || (await read({ service, account })) !== token) throw new Error("the keychain didn't keep the token");
}
