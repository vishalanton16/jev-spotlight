import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { resolveTab, withExtensionWorld } from "./cdp.ts";
import {
  annotationShape,
  annotationResultSchema,
  isolatedHandler,
  pageSnapshotSchema,
  pageUrl,
  type PageRequest,
} from "./protocol.ts";
import { readSession } from "./session.ts";

type ApplyInput = Omit<Extract<PageRequest, { operation: "apply" }>, "operation">;
const applyResult = z.object({
  highlighted: z.number().int().nonnegative(),
  color: z.string(),
  shapes: z.array(annotationShape),
});

export async function withSpotlightPage<T>(
  url: string,
  operation: (page: {
    tabId: string;
    url: string;
    annotate: (input: Omit<Extract<PageRequest, { operation: "annotate" }>, "operation">) => Promise<z.infer<typeof annotationResultSchema>>;
    capture: () => Promise<z.infer<typeof pageSnapshotSchema>>;
    apply: (input: ApplyInput) => Promise<z.infer<typeof applyResult>>;
  }) => Promise<T>,
  tabId?: string,
) {
  const requested = new URL(url);
  const { cdpUrl, extensionId } = await readSession(requested.href, tabId);
  const target = await resolveTab(cdpUrl, requested.href, tabId);
  return withExtensionWorld(cdpUrl, target, extensionId, async ({ evaluate, bringToFront }) => {
    for (let attempt = 0; ; attempt++) {
      if (await evaluate('document.readyState !== "loading" && !!document.body')) break;
      if (attempt === 99) throw new Error("The page is still loading. Wait for it to finish and capture again.");
      await delay(100);
    }
    const current = new URL(pageUrl.parse(await evaluate("location.href")));
    const upgraded =
      requested.protocol === "http:" &&
      current.protocol === "https:" &&
      requested.hostname === current.hostname &&
      requested.port === current.port;
    if (current.origin !== requested.origin && !upgraded) {
      throw new Error(
        `The page redirected to ${current.origin}. Request that destination explicitly to highlight it.`,
      );
    }

    const callExtension = (request: PageRequest) => {
      const payload = JSON.stringify({ id: randomUUID(), url: current.href, request });
      return evaluate(`globalThis[${JSON.stringify(isolatedHandler)}](${payload})`);
    };
    return operation({
      tabId: target.id,
      url: current.href,
      annotate: async (input) => {
        const result = annotationResultSchema.parse(await callExtension({ operation: "annotate", ...input }));
        if (result.highlighted) await bringToFront();
        return result;
      },
      capture: async () => pageSnapshotSchema.parse(await callExtension({ operation: "capture" })),
      apply: async (input) => {
        const result = applyResult.parse(await callExtension({ operation: "apply", ...input }));
        if (result.highlighted) await bringToFront();
        return result;
      },
    });
  });
}
