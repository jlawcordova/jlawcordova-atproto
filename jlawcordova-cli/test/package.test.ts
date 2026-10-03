import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "accomplishments-build-"));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("package", () => {
  it("P1: the build writes JavaScript with .js imports and keeps main.js's shebang", () => {
    execFileSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", outDir], { cwd: PACKAGE_DIR });
    const files = readdirSync(outDir).sort();
    expect(files).toEqual(["api.js", "cli.js", "keychain.js", "login.js", "main.js"]);
    for (const file of files) {
      const source = readFileSync(join(outDir, file), "utf8");
      expect(source, file).not.toMatch(/from "\.[^"]*\.ts"/);
    }
    expect(readFileSync(join(outDir, "main.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  }, 60_000);

  it("P2: the tarball holds only package.json and dist/", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PACKAGE_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    ) as { files: { path: string }[] }[];
    const paths = packed!.files.map((f) => f.path).sort();
    expect(paths).toContain("dist/main.js");
    expect(paths.filter((p) => p !== "package.json" && !p.startsWith("dist/"))).toEqual([]);
  }, 60_000);
});
