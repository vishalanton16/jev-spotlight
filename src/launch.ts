import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { pageUrl } from "./protocol.ts";
import { claimSession, sessionFile } from "./session.ts";

function findChrome() {
  const fromPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map((name) =>
        join(directory, name),
      ),
    );
  const candidates = [...fromPath];
  if (process.platform === "darwin") {
    candidates.unshift(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  }
  return candidates.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const executable = process.env.JEV_SPOTLIGHT_CHROME || findChrome();
if (!executable) {
  throw new Error(
    "Install Google Chrome or Chromium, or set JEV_SPOTLIGHT_CHROME to its executable.",
  );
}
const extension = await realpath(
  fileURLToPath(new URL("../.output/chrome-mv3/", import.meta.url)),
).catch(() => {
  throw new Error("Build the extension with pnpm build first.");
});
await readFile(join(extension, "manifest.json")).catch(() => {
  throw new Error("Build the extension with pnpm build first.");
});

// The bundled runtime is unpacked, so Chromium derives its ID from its install path.
const stagehandRuntime = await realpath(
  fileURLToPath(new URL("./extension", import.meta.resolve("@browserbasehq/stagehand"))),
);
function unpackedExtensionId(path: string) {
  return createHash("sha256")
    .update(path)
    .digest("hex")
    .slice(0, 32)
    .replace(/./g, (digit) => "abcdefghijklmnop"[Number.parseInt(digit, 16)]!);
}
const runtimeId = unpackedExtensionId(stagehandRuntime);

const targetUrl = process.argv[2] ? pageUrl.parse(process.argv[2]) : "about:blank";
const browserEnv = { ...process.env };
delete browserEnv.TYPESAFE_API_KEY;
const profile = await mkdtemp(join(tmpdir(), "jev-spotlight-"));
let child: ReturnType<typeof spawn> | undefined;
let ownsSession = false;
try {
  await claimSession();
  ownsSession = true;

  child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--remote-debugging-pipe",
      `--remote-allow-origins=chrome-extension://${runtimeId}`,

      "--enable-unsafe-extension-debugging",
      "--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport",
      "--no-first-run",
      "--no-default-browser-check",
      targetUrl,
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], env: browserEnv },
  );
  const exited = once(child, "exit");
  // Race startup against exit so missing binaries and failed launches surface immediately.
  const [port, extensionId] = await Promise.race([
    exited.then(() => {
      throw new Error("Chrome exited before loading Jev Spotlight.");
    }),
    Promise.all([waitForPort(profile), installExtensions(child)]),
    setTimeout(12000, undefined, { ref: false }).then(() => {
      throw new Error("Chrome did not finish setting up Jev Spotlight.");
    }),
  ]);
  await writeFile(
    sessionFile,
    JSON.stringify({
      cdpUrl: `http://127.0.0.1:${port}`,
      extensionId,
      launcherPid: process.pid,
    }),
  );
  console.log(`Jev Spotlight is open at ${targetUrl}. Keep this terminal running.`);
  const stop = () => child?.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await exited;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
  if (ownsSession) await rm(sessionFile, { force: true });
  // Chromium helpers can hold the profile briefly after the main process exits.
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}

async function waitForPort(profile: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const data = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    const candidate = data?.split("\n")[0];
    if (candidate && /^\d+$/.test(candidate)) return candidate;
    await setTimeout(100);
  }
  throw new Error("Chrome did not expose a debugging port.");
}

async function installExtensions(child: ReturnType<typeof spawn>) {
  const stagehandId = await installUnpacked(child, 1, stagehandRuntime);
  if (stagehandId !== runtimeId)
    throw new Error("Chrome loaded an unexpected Stagehand runtime ID.");
  return installUnpacked(child, 2, extension);
}

async function installUnpacked(child: ReturnType<typeof spawn>, id: number, path: string) {
  const [, , , input, output] = child.stdio;
  if (!input || !output || !("write" in input) || !("setEncoding" in output)) {
    throw new Error("Chrome did not expose its local extension installer.");
  }
  output.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const receive = (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\0");
      if (end === -1) return;
      output.off("data", receive);
      try {
        const reply = JSON.parse(buffer.slice(0, end));
        if (reply.id !== id || !/^[a-p]{32}$/.test(reply.result?.id ?? "")) {
          throw new Error(reply.error?.message ?? "Chrome could not load Jev Spotlight.");
        }
        resolve(reply.result.id);
      } catch (error) {
        reject(error);
      }
    };
    output.on("data", receive);
    input.on("error", reject);
    output.on("error", reject);
    input.write(JSON.stringify({ id, method: "Extensions.loadUnpacked", params: { path } }) + "\0");
  });
}
