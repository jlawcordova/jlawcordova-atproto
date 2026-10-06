#!/usr/bin/env bun
import { run } from "./cli.ts";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readKeychainToken, storeKeychainToken } from "./keychain.ts";

async function readStdin(): Promise<string> {
  // Nothing piped in: report empty input instead of waiting on the terminal.
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  fetch,
  readStdin,
  readKeychainToken: () => readKeychainToken(),
  storeToken: (token) => storeKeychainToken(token),
  platform: process.platform,
  sleep: (ms) => sleep(ms),
  openUrl: (url) =>
    new Promise((resolve) => {
      execFile("open", [url], () => resolve());
    }),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
