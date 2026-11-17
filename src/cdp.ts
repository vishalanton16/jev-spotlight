import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const targetSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  webSocketDebuggerUrl: z.string().optional(),
});
const frameSchema = z.object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) });
const contextSchema = z.object({
  uniqueId: z.string(),
  origin: z.string(),
  auxData: z.object({
    frameId: z.string(),
    isDefault: z.literal(false),
    type: z.literal("isolated"),
  }),
});
const evaluationSchema = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z
    .object({
      text: z.string(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
});
const responseSchema = z.object({
  id: z.number(),
  result: z.unknown(),
  error: z.object({ message: z.string() }).optional(),
});

async function chromeJson(cdpUrl: string, path: string, method = "GET") {
  const response = await fetch(new URL(path, cdpUrl), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Chrome debugging request failed (HTTP ${response.status}).`);
  return response.json();
}

export async function resolveTab(cdpUrl: string, url: string, tabId?: string) {
  const targets = z.array(targetSchema).parse(await chromeJson(cdpUrl, "/json/list"));
  if (tabId) {
    const pinned = targets.find((target) => target.type === "page" && target.id === tabId);
    if (!pinned || pinned.url !== url) throw new Error("The captured tab closed or navigated. Capture the page again.");
    return pinned;
  }
  const existing = targets.find((target) => target.type === "page" && target.url === url);
  if (existing) return existing;
  return targetSchema.parse(
    await chromeJson(cdpUrl, `/json/new?${encodeURIComponent(url)}`, "PUT"),
  );
}

export async function withExtensionWorld<T>(
  cdpUrl: string,
  target: z.infer<typeof targetSchema>,
  extensionId: string,
  operation: (world: {
    evaluate: (expression: string) => Promise<unknown>;
    bringToFront: () => Promise<void>;
  }) => Promise<T>,
) {
  const { id: targetId, webSocketDebuggerUrl } = target;
  if (!webSocketDebuggerUrl) throw new Error("The target Chrome tab is no longer open.");
  const debuggerUrl = new URL(webSocketDebuggerUrl);
  if (
    debuggerUrl.protocol !== "ws:" ||
    debuggerUrl.host !== new URL(cdpUrl).host ||
    debuggerUrl.pathname !== `/devtools/page/${targetId}` ||
    debuggerUrl.username ||
    debuggerUrl.password ||
    debuggerUrl.search ||
    debuggerUrl.hash
  ) {
    throw new Error("Chrome returned an unexpected debugging endpoint.");
  }

  const socket = new WebSocket(debuggerUrl);
  const contexts = new Map<string, z.infer<typeof contextSchema>>();
  let requestId = 0;
  const pending = new Map<number, (message: z.infer<typeof responseSchema>) => void>();
  const disconnected = new AbortController();
  const stop = () => disconnected.abort(new Error("The Chrome debugging connection closed."));
  socket.addEventListener("close", stop);
  socket.addEventListener("error", stop);
  socket.addEventListener("message", ({ data }) => {
    if (typeof data !== "string") return;
    const message = JSON.parse(data);
    if (message.method === "Runtime.executionContextCreated") {
      const context = contextSchema.safeParse(message.params?.context);
      if (context.success) contexts.set(context.data.uniqueId, context.data);
    } else if (message.method === "Runtime.executionContextDestroyed") {
      contexts.delete(message.params?.executionContextUniqueId);
    } else if (message.method === "Runtime.executionContextsCleared") {
      contexts.clear();
    } else {
      const response = responseSchema.safeParse(message);
      if (response.success) pending.get(response.data.id)?.(response.data);
    }
  });

  function command(method: string, params?: object) {
    return new Promise<unknown>((resolve, reject) => {
      const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(5000)]);
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const id = ++requestId;
      const cancel = () => {
        pending.delete(id);
        reject(signal.reason);
      };
      pending.set(id, ({ result, error }) => {
        pending.delete(id);
        signal.removeEventListener("abort", cancel);
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
      signal.addEventListener("abort", cancel, { once: true });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        signal.removeEventListener("abort", cancel);
        reject(error);
      }
    });
  }

  try {
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(5000)]);
    await new Promise<void>((resolve, reject) => {
      const cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      socket.addEventListener(
        "open",
        () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        },
        { once: true },
      );
    });
    const { frameTree } = frameSchema.parse(await command("Page.getFrameTree"));
    await command("Runtime.enable");

    const origin = `chrome-extension://${extensionId}`;
    const findContext = () =>
      [...contexts.values()].find(
        (candidate) =>
          candidate.origin === origin && candidate.auxData.frameId === frameTree.frame.id,
      );
    let context = findContext();
    for (let attempt = 0; !context && attempt < 100; attempt++) {
      await delay(100, undefined, { signal: disconnected.signal });
      context = findContext();
    }
    if (!context)
      throw new Error(
        "Jev Spotlight is unavailable in this tab. Wait for Chrome to load the extension and try again.",
      );

    const uniqueContextId = context.uniqueId;
    const evaluate = async (expression: string) => {
      // A unique context ID prevents this command from reaching a replacement document.
      const reply = evaluationSchema.parse(
        await command("Runtime.evaluate", {
          expression,
          uniqueContextId,
          returnByValue: true,
        }),
      );
      if (reply.exceptionDetails) {
        const detail = reply.exceptionDetails.exception?.description?.split("\n", 1)[0];
        throw new Error(detail?.replace(/^Error: /, "") || reply.exceptionDetails.text);
      }
      return reply.result.value;
    };
    return await operation({
      evaluate,
      bringToFront: async () => {
        await command("Page.bringToFront");
      },
    });
  } finally {
    stop();
    socket.close();
  }
}
