import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const localCdpUrl = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    ctx.addIssue({ code: "custom", message: "Use a local Chrome debugging URL such as http://127.0.0.1:9222." });
    return z.NEVER;
  }
  return url.origin;
});
const tabSchema = z.object({ id: z.string(), type: z.string(), url: z.string() });
const versionSchema = z.object({ Browser: z.string(), webSocketDebuggerUrl: z.url() });
const extensionSchema = z.object({
  extensions: z.array(z.object({ id: z.string(), path: z.string(), enabled: z.boolean() })),
});
type Browser = {
  cdpUrl: string;
  stagehand: boolean;
  tabs: z.infer<typeof tabSchema>[];
  websocket: string;
};

export function debuggingBrowsers(commands: string) {
  const browsers = new Map<string, { cdpUrl: string; stagehand: boolean }>();
  for (const command of commands.split("\n")) {
    if (!/^(?:.*[/\\])?(?:Google Chrome(?: Canary)?|google-chrome(?:-stable)?|chromium(?:-browser)?|chrome|msedge)(?:\.exe)?"?\s+--/i.test(command.trim())
      || /--type=/.test(command)) continue;
    const port = command.match(/(?:^|\s)--remote-debugging-port=(\d+)(?:\s|$)/)?.[1];
    if (!port || +port < 1 || +port > 65535) continue;
    const cdpUrl = `http://127.0.0.1:${port}`;
    browsers.set(cdpUrl, { cdpUrl, stagehand: /stagehand-/i.test(command) });
  }
  return [...browsers.values()];
}

async function discoverBrowsers() {
  const run = promisify(execFile);
  try {
    const { stdout } = process.platform === "win32"
      ? await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe' OR Name = 'chromium.exe' OR Name = 'msedge.exe'\" | Select-Object -ExpandProperty CommandLine"],
      { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
      : await run("ps", ["-u", String(process.getuid!()), "-o", "args="],
        { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
    return debuggingBrowsers(stdout);
  } catch {
    throw new Error("Could not discover local Chrome. Set JEV_SPOTLIGHT_CDP_URL to Stagehand's local debugging URL.");
  }
}

async function inspectBrowser(candidate: { cdpUrl: string; stagehand: boolean }): Promise<Browser> {
  const get = async (path: string) => {
    const response = await fetch(new URL(path, candidate.cdpUrl), {
      redirect: "error", signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) throw new Error(`Chrome debugging request failed (HTTP ${response.status}).`);
    return response.json();
  };
  const [version, tabs] = await Promise.all([get("/json/version"), get("/json/list")]);
  const websocket = versionSchema.parse(version).webSocketDebuggerUrl;
  const endpoint = new URL(websocket);
  if (endpoint.protocol !== "ws:" || endpoint.host !== new URL(candidate.cdpUrl).host
    || !/^\/devtools\/browser\/[^/?#]+$/.test(endpoint.pathname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Chrome returned an unexpected browser debugging endpoint.");
  }
  return { ...candidate, websocket, tabs: z.array(tabSchema).parse(tabs) };
}

export async function browserCommand(websocket: string, method: string, params: object = {}) {
  const socket = new WebSocket(websocket);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out.`)), 5000);
      const finish = (error?: Error, result?: unknown) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      socket.addEventListener("error", () => finish(new Error("Chrome debugging connection failed.")));
      socket.addEventListener("close", () => finish(new Error("Chrome debugging connection closed.")));
      socket.addEventListener("message", ({ data }) => {
        try {
          const reply = JSON.parse(String(data));
          if (reply.id === 1) finish(reply.error ? new Error(reply.error.message) : undefined, reply.result);
        } catch {
          finish(new Error("Chrome returned an invalid debugging response."));
        }
      });
      socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })), { once: true });
    });
  } finally {
    socket.close();
  }
}

export function selectBrowser(browsers: Browser[], url: string, tabId?: string, savedUrl?: string) {
  if (tabId) {
    const pinned = browsers.find(({ tabs }) => tabs.some((tab) => tab.type === "page" && tab.id === tabId && tab.url === url));
    if (!pinned) throw new Error("The captured tab closed or navigated. Capture the page again.");
    return pinned;
  }
  const matches = browsers.filter(({ tabs }) => tabs.some((tab) => tab.type === "page" && tab.url === url));
  const externalMatches = matches.filter(({ cdpUrl }) => cdpUrl !== savedUrl);
  const saved = browsers.find(({ cdpUrl }) => cdpUrl === savedUrl);
  const external = browsers.filter(({ cdpUrl }) => cdpUrl !== savedUrl);
  const stagehand = external.filter((browser) => browser.stagehand);
  let choices = external;
  if (externalMatches.length) choices = externalMatches;
  else if (matches.length) choices = matches;
  else if (stagehand.length) choices = stagehand;
  else if (saved) choices = [saved];
  if (choices.length > 1) {
    throw new Error("Several Chrome sessions match. Set JEV_SPOTLIGHT_CDP_URL to Stagehand's debugging URL to select one; no new browser was opened.");
  }
  return choices[0];
}

export async function existingSession(url: string, tabId?: string, saved?: { cdpUrl: string; extensionId: string }) {
  const explicit = process.env.JEV_SPOTLIGHT_CDP_URL;
  let selected: Browser | undefined;
  if (explicit) {
    const cdpUrl = localCdpUrl.parse(explicit);
    selected = await inspectBrowser({ cdpUrl, stagehand: false }).catch(() => {
      throw new Error("Cannot connect to JEV_SPOTLIGHT_CDP_URL. Check that Stagehand's Chrome is running; no new browser was opened.");
    });
    if (tabId) selectBrowser([selected], url, tabId);
  } else {
    const discovered = await discoverBrowsers();
    const runningCount = discovered.length;
    if (saved && !discovered.some(({ cdpUrl }) => cdpUrl === saved.cdpUrl)) {
      discovered.push({ cdpUrl: saved.cdpUrl, stagehand: false });
    }
    const results = await Promise.allSettled(discovered.map(inspectBrowser));
    const browsers = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!browsers.length && runningCount) {
      throw new Error("Found an existing Chrome process but could not reach its debugging endpoint. Check Stagehand's connection or set JEV_SPOTLIGHT_CDP_URL; no new browser was opened.");
    }
    selected = selectBrowser(browsers, url, tabId, saved?.cdpUrl);
  }
  if (!selected) return undefined;
  let pending = installations.get(selected.websocket);
  if (!pending) {
    const websocket = selected.websocket;
    pending = installExtension(selected).finally(() => installations.delete(websocket));
    installations.set(websocket, pending);
  }
  return pending;
}

const installations = new Map<string, Promise<{ cdpUrl: string; extensionId: string }>>();

async function installExtension(selected: Browser) {
  const extension = await realpath(fileURLToPath(new URL("../.output/chrome-mv3/", import.meta.url)))
    .catch(() => { throw new Error("Build the extension with pnpm build first."); });
  try {
    const installed = extensionSchema.parse(await browserCommand(selected.websocket, "Extensions.getExtensions"));
    const current = installed.extensions.find(({ path }) => path === extension);
    if (current) {
      if (!current.enabled) throw new Error("Jev Spotlight is disabled. Enable it in chrome://extensions.");
      return { cdpUrl: selected.cdpUrl, extensionId: current.id };
    }
    const loaded = z.object({ id: z.string().regex(/^[a-p]{32}$/) }).parse(
      await browserCommand(selected.websocket, "Extensions.loadUnpacked", { path: extension }),
    );
    return { cdpUrl: selected.cdpUrl, extensionId: loaded.id };
  } catch (error) {
    throw new Error(`Could not load Jev into the existing Chrome. Use local Stagehand Chrome with --enable-unsafe-extension-debugging, or enable Jev manually. No new browser was opened. ${error instanceof Error ? error.message : ""}`, { cause: error });
  }
}
