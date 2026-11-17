import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { withSpotlightPage } from "./browser.ts";
import { scoreTargets } from "./jev.ts";
import { annotationSchema, annotationBatchSchema, highlightColor, pageUrl, pageSnapshotSchema } from "./protocol.ts";

export const highlightInput = z.object({
  url: pageUrl.describe("Page in Jev Chrome. May differ from Stagehand. For exact items or separate explanations, use capture_page then annotate_page."),
  task: z.string().trim().min(1).max(800).describe("Semantic matching criterion. For ordered selections such as the first 10 posts, use capture_page and annotate_page instead."),
  evidence: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe("Relevant findings from earlier research."),
  color: highlightColor.describe("Annotation color. Defaults to red."),
  annotation: annotationSchema
    .optional()
    .describe("One shared note repeated on every match. For explaining multiple items, you MUST use capture_page and annotate_page with one distinct explanation per item."),
});

export async function highlightPage({
  url,
  task,
  evidence,
  color,
  annotation,
}: z.infer<typeof highlightInput>) {
  return withSpotlightPage(url, async (page) => {
    let snapshot = await page.capture();
    const score = (targets: typeof snapshot.targets) =>
      targets.length ? scoreTargets(targets, task, evidence) : { models: [], matches: [] };
    let decision = await score(snapshot.targets);
    for (const wait of [350, 700]) {
      if (decision.matches.length) break;
      await delay(wait);
      const next = await page.capture();
      if (JSON.stringify(next.targets) !== JSON.stringify(snapshot.targets)) {
        decision = await score(next.targets);
      }
      snapshot = next;
    }
    const { snapshotId, targets, truncated } = snapshot;
    const { models, matches } = decision;
    const applied = await page.apply({
      snapshotId,
      ids: matches.map(({ id }) => id),
      color,
      annotation,
    });
    const targetsById = new Map(targets.map((target) => [target.id, target]));
    return {
      ...applied,
      models,
      truncated,
      candidateCount: targets.length,
      matches: matches.map(({ id, probability }) => {
        const { kind, text } = targetsById.get(id)!;
        return { kind, text, probability };
      }),
    };
  });
}

export const captureInput = z.object({
  url: pageUrl.describe("URL to inspect in Jev Chrome. This snapshot is the source of truth for target identity and order."),
  tabId: z.string().min(1).optional().describe("Optional existing Jev tab ID. Never a Stagehand page ID."),
});
export const annotateInput = z.object({
  url: pageUrl.describe("Exact URL returned by capture_page."),
  tabId: z.string().min(1).describe("Exact tabId returned by capture_page."),
  snapshotId: pageSnapshotSchema.shape.snapshotId.describe("Snapshot returned by capture_page. Do not recapture between research and annotation."),
  annotations: annotationBatchSchema.describe("Exactly one entry per requested item, with its captured ID, a specific 2–5 word label, and a distinct 1–2 sentence explanation of that item. Each explanation must name its concrete claim or mechanism and why it matters. Never use a combined summary or tell the reader to see another summary. Research captured hrefs with Stagehand first and disclose title-only evidence. Keep explanations around 15–35 words so they fit as handwritten notes. Use quote to mark a short exact phrase in a long paragraph; choose underline or circle with arrow. Send all items in one batch."),
});

export async function capturePage({ url, tabId }: z.infer<typeof captureInput>) {
  return withSpotlightPage(url, async (page) => ({
    url: page.url,
    tabId: page.tabId,
    ...await page.capture(),
  }), tabId);
}

export async function annotatePage({ url, tabId, snapshotId, annotations }: z.infer<typeof annotateInput>) {
  return withSpotlightPage(url, async (page) => ({
    url: page.url,
    tabId: page.tabId,
    snapshotId,
    ...await page.annotate({ snapshotId, annotations }),
  }), tabId);
}
