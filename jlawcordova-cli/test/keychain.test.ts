import { describe, expect, it } from "bun:test";
import { storeKeychainToken, type RunWithStdin } from "../src/keychain.ts";

const TOKEN = "gho_fakeKeychainWrite0123456789abcd";

function harness(opts: { exit?: number; readBack?: string | undefined } = {}) {
  const runs: { file: string; args: string[]; input: string }[] = [];
  const run: RunWithStdin = async (file, args, input) => {
    runs.push({ file, args, input });
    return opts.exit ?? 0;
  };
  const read = async () => ("readBack" in opts ? opts.readBack : TOKEN);
  return { runs, io: { run, read } };
}

describe("storeKeychainToken", () => {
  it("C10: the token goes on stdin to `security -i`, never in the arguments", async () => {
    const { runs, io } = harness();
    await storeKeychainToken(TOKEN, {}, io);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.file).toBe("security");
    expect(runs[0]!.args).toEqual(["-i"]);
    expect(runs[0]!.args.join(" ")).not.toContain(TOKEN);
    expect(runs[0]!.input).toBe(`add-generic-password -U -s jlawcordova-accomplishments -a default -w ${TOKEN}\n`);
  });

  it("replaces an existing item (-U) under the service and account the CLI reads", async () => {
    const { runs, io } = harness();
    await storeKeychainToken(TOKEN, { service: "other-service", account: "me" }, io);
    expect(runs[0]!.input).toContain("-U -s other-service -a me ");
  });

  it("fails without echoing the token when security exits non-zero", async () => {
    const { io } = harness({ exit: 1 });
    const error = await storeKeychainToken(TOKEN, {}, io).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("fails when the token can't be read back, even if security exited 0", async () => {
    for (const readBack of [undefined, "gho_someOtherValue"]) {
      const { io } = harness({ readBack });
      await expect(storeKeychainToken(TOKEN, {}, io)).rejects.toThrow();
    }
  });

  it("refuses a token with characters that would need quoting, without running anything", async () => {
    for (const bad of ["gho_a b", "gho_a;b", 'gho_"x"', "gho_$(id)", "", "gho_a\nb"]) {
      const { runs, io } = harness();
      await expect(storeKeychainToken(bad, {}, io), JSON.stringify(bad)).rejects.toThrow();
      expect(runs).toEqual([]);
    }
  });
});
