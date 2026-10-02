#!/usr/bin/env node
import { run } from "./cli.ts";
import { readKeychainToken } from "./keychain.ts";

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
  readKeychainToken,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
