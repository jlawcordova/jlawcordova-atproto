import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "bun:test";
import pkg from "../package.json" with { type: "json" };

const PACKAGE_DIR = join(import.meta.dirname, "..");
const binary = join(PACKAGE_DIR, "dist", "accomplishments-darwin-arm64");

// Only what a clean Mac has: no Bun, no Node.
const BARE_PATH = "/usr/bin:/bin";

function runBinary(args: string[], env: Record<string, string> = {}) {
  return spawnSync(binary, args, { env: { PATH: BARE_PATH, ...env }, encoding: "utf8", timeout: 30_000 });
}

// The binary is built for Apple Silicon Macs only, so it can only run there.
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("binary", () => {
  let build: ReturnType<typeof spawnSync>;
  beforeAll(() => {
    build = spawnSync("bun", ["run", "build"], { cwd: PACKAGE_DIR, encoding: "utf8" });
  }, 120_000);

  it("B1: bun run build writes an arm64 Mach-O executable whose signature verifies, and leaves no .bun-build files", () => {
    expect(build.status, String(build.stderr)).toBe(0);
    expect(spawnSync("file", [binary], { encoding: "utf8" }).stdout).toContain("Mach-O 64-bit executable arm64");
    const verify = spawnSync("codesign", ["--verify", "--strict", binary], { encoding: "utf8" });
    expect(verify.status, verify.stderr).toBe(0);
    expect(readdirSync(PACKAGE_DIR).filter((f) => f.endsWith(".bun-build"))).toEqual([]);
  });

  it("B2: with no Bun or Node on the PATH, --help exits 2, --version prints the version, and an unreachable URL exits 4", () => {
    const help = runBinary(["--help"]);
    expect(help.status).toBe(2);
    expect(help.stderr).toContain("Usage:");

    const version = runBinary(["--version"]);
    expect(version.status).toBe(0);
    expect(JSON.parse(version.stdout)).toEqual({ version: pkg.version });

    const list = runBinary(["list"], { ACCOMPLISHMENTS_TOKEN: "gho_fakePackageTestToken0123456789", ACCOMPLISHMENTS_URL: "http://127.0.0.1:9" });
    expect(list.status).toBe(4);
    expect(JSON.parse(list.stderr).error).toBe("network");
  });
});
