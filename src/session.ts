import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { existingSession, localCdpUrl } from "./existing-browser.ts";

export const sessionFile = new URL("../.session.json", import.meta.url);
const launcher = fileURLToPath(new URL("./launch.ts", import.meta.url));
const sessionSchema = z.object({
  cdpUrl: localCdpUrl,
  extensionId: z.string().regex(/^[a-p]{32}$/),
});

async function readState() {
  const raw = await readFile(sessionFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  let value: unknown;
  try {
    if (raw) value = JSON.parse(raw);
  } catch {
    // A launcher may be updating the local record.
  }
  const record = z.object({ launcherPid: z.number().int().positive().optional() }).safeParse(value);
  const session = sessionSchema.safeParse(value);
  return { raw, launcherPid: record.data?.launcherPid, session: session.data };
}

function isAlive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function reachable(cdpUrl?: string) {
  if (!cdpUrl) return false;
  try {
    const response = await fetch(new URL("/json/version", cdpUrl), {
      redirect: "error",
      signal: AbortSignal.timeout(750),
    });
    const version = z.object({ Browser: z.string(), webSocketDebuggerUrl: z.url() });
    return response.ok && version.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

export async function claimSession() {
  const pending = JSON.stringify({ launcherPid: process.pid });
  try {
    await writeFile(sessionFile, pending, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const state = await readState();
    if (isAlive(state.launcherPid) || (await reachable(state.session?.cdpUrl))) {
      throw new Error("Jev Spotlight Chrome is already running or starting.");
    }
    if (state.raw === "") throw new Error("Jev Spotlight Chrome is starting.");
    const latest = await readState();
    if (state.raw !== undefined && latest.raw === state.raw) {
      await unlink(sessionFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await writeFile(sessionFile, pending, { flag: "wx", mode: 0o600 });
  }
}

let starting: Promise<z.infer<typeof sessionSchema>> | undefined;

export async function readSession(url: string, tabId?: string) {
  const state = await readState();
  const existing = await existingSession(url, tabId, state.session);
  if (existing) return existing;
  if (!starting)
    starting = startSession().finally(() => {
      starting = undefined;
    });
  return starting;
}

async function startSession() {
  const state = await readState();
  if (!isAlive(state.launcherPid) && state.raw !== "") {
    const child = spawn(process.execPath, [launcher], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // The bounded wait below reports a startup failure to the caller.
    });
    child.unref();
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const { session } = await readState();
    if (session && (await reachable(session.cdpUrl))) return session;
    await delay(150);
  }
  throw new Error(
    "Could not start Google Chrome. Run pnpm start in the Jev Spotlight folder to see the startup error.",
  );
}
