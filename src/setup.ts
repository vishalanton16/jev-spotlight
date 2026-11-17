import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

async function readKey() {
  if (!process.stdin.isTTY) throw new Error("Run pnpm run setup in an interactive terminal.");

  const silent = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
    historySize: 0,
  });
  const cancel = new AbortController();
  input.once("SIGINT", () => cancel.abort());
  input.once("close", () => cancel.abort());
  process.stdout.write("Paste your TypeSafe API key (hidden), then press Return: ");
  try {
    const key = (await input.question("", { signal: cancel.signal })).trim();
    if (!key || /[\s'"\x00-\x1f\x7f]/.test(key)) {
      throw new Error("Enter a single TypeSafe API key.");
    }
    return key;
  } finally {
    input.close();
    process.stdout.write("\n");
  }
}

async function setup() {
  const key = await readKey();
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  const current = await readFile(envFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const lines = current
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=/.test(line));
  const remaining = lines.join("\n").trimEnd();
  const updated = `${remaining ? `${remaining}\n` : ""}TYPESAFE_API_KEY='${key}'\n`;
  const tempDir = await mkdtemp(fileURLToPath(new URL("../.setup-", import.meta.url)));
  try {
    const pending = join(tempDir, "env");
    await writeFile(pending, updated, { mode: 0o600 });
    await rename(pending, envFile);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  console.log("Saved the TypeSafe key locally. Run pnpm start to open Chrome.");
}

setup().catch((error) => {
  console.error(
    error instanceof Error && error.name === "AbortError" ? "Setup cancelled." : error.message,
  );
  process.exitCode = 1;
});
