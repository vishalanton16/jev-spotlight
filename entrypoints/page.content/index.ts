import { z } from "zod";
import {
  maxTargets,
  annotationShapes,
  isolatedHandler,
  pageSnapshotSchema,
  pageRequestEnvelope,
  pageUrl,
} from "../../src/protocol.ts";
import { mountAnnotations } from "./annotations.ts";
import { anchorText, paragraphRanges, quoteRange, type PageAnchor } from "./text-ranges.ts";

const targetSelector = [
  "[data-jev-spotlight-target]",
  "article",
  '[role="listitem"]',
  "li",
  "tbody tr",
  "section",
  "h1",
  "h2",
  "h3",
  "p",
  "font",
  "a[href]",
  "button",
  "img[alt]",
].join(",");
const groupSelector = 'article,section,[role="listitem"],li,tbody tr,[data-jev-spotlight-target]';

function isTargetGroup(element: HTMLElement) {
  if (element.hasAttribute("data-jev-spotlight-target")) return true;
  // Layout tables wrap other tables. Capture their inner rows so ranks stay with titles.
  if (element.matches("tbody tr")) return !element.querySelector("tr") && element.innerText.trim().length <= 500;
  // A short article can be a card. A long article is a container for smaller targets.
  return (
    (element.innerText?.trim().length ?? 0) <= 500 &&
    !element.querySelector(groupSelector) &&
    element.querySelectorAll("h1,h2,h3,h4,h5,h6").length <= 1
  );
}

function targetHref(element: HTMLElement) {
  const link = element.matches("a[href]") ? element as HTMLAnchorElement
    : element.querySelector<HTMLAnchorElement>(".titleline > a, h1 a[href], h2 a[href], h3 a[href]")
      ?? [...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find((link) => link.textContent?.trim());
  return link ? pageUrl.safeParse(link.href).data : undefined;
}

function canInspect(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === "visible" &&
    !element.closest(
      '[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])',
    )
  );
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  world: "ISOLATED",
  main(ctx) {
    let snapshot: z.infer<typeof pageSnapshotSchema> | undefined;
    let captured = new Map<string, PageAnchor>();
    const highlighted = new Set<HTMLElement>();
    let highlightedCount = 0;
    let removeAnnotations: (() => void) | undefined;
    const clear = () => {
      removeAnnotations?.();
      removeAnnotations = undefined;
      for (const element of highlighted) element.removeAttribute("data-jev-spotlight-outline");
      highlighted.clear();
      highlightedCount = 0;
    };

    const handle = (payload: unknown) => {
      const { id, url, request } = pageRequestEnvelope.parse(payload);
      if (location.href !== url) throw new Error("The target tab has navigated away.");

      if (request.operation === "capture") {
        const next = new Map<string, PageAnchor>();
        const targets: z.infer<typeof pageSnapshotSchema>["targets"] = [];
        const root = document.body;
        const elements = root.querySelectorAll<HTMLElement>(`${targetSelector}, div`);
        const groups = new Set<HTMLElement>();
        const textRoots = new Set<HTMLElement>();
        const addTarget = (anchor: PageAnchor) => {
          const text = anchorText(anchor);
          if (!text) return;
          const targetId = `target-${targets.length + 1}`;
          targets.push({ id: targetId, kind: anchor.range ? "text" : anchor.element.tagName.toLowerCase(), text,
            href: anchor.range ? undefined : targetHref(anchor.element) });
          next.set(targetId, anchor);
        };
        for (const element of elements) {
          if (!(element instanceof HTMLElement) || !canInspect(element)) continue;
          if ([...textRoots].some((root) => root.contains(element))) continue;
          let ancestor = element.parentElement?.closest<HTMLElement>(groupSelector);
          while (ancestor && !groups.has(ancestor)) {
            ancestor = ancestor.parentElement?.closest<HTMLElement>(groupSelector);
          }
          if (ancestor) continue;
          if (element.matches("font")) {
            if (element.querySelector("p,table,section,article")) continue;
            const ranges = paragraphRanges(element);
            if (ranges.length < 2) continue;
            textRoots.add(element);
            for (const range of ranges) {
              addTarget({ element, range });
              if (targets.length > maxTargets) break;
            }
            if (targets.length > maxTargets) break;
            continue;
          }
          if (element.matches(groupSelector)) {
            if (!isTargetGroup(element)) continue;
          } else if (element.matches("div") && element.children.length > 0) {
            continue;
          }
          const text = anchorText({ element });
          if (!text) continue;
          if (element.matches(groupSelector)) groups.add(element);

          addTarget({ element });
          if (targets.length > maxTargets) break;
        }

        const truncated = targets.length > maxTargets;
        if (truncated) next.delete(targets.pop()!.id);
        snapshot = pageSnapshotSchema.parse({
          snapshotId: id,
          targets,
          truncated,
        });
        captured = next;
        return snapshot;
      }

      if (!snapshot || snapshot.snapshotId !== request.snapshotId) {
        throw new Error("The page snapshot is stale. Capture the page again.");
      }
      const annotations = request.operation === "annotate" ? request.annotations
        : request.ids.map((id) => ({ ...request.annotation, id, color: request.color }));
      const ids = annotations.map(({ id }) => id);
      const targets = ids.map((id) => snapshot!.targets.find((target) => target.id === id));

      if (new Set(ids).size !== ids.length) {
        throw new Error("Highlight IDs must be unique.");
      }
      for (const target of targets) {
        const anchor = target && captured.get(target.id);
        const element = anchor?.element;
        if (
          !target ||
          !element?.isConnected ||
          !canInspect(element) ||
          anchorText(anchor!) !== target.text ||
          (!anchor?.range && targetHref(element) !== target.href)
        ) {
          throw new Error("A captured element changed. Capture the page again.");
        }
      }

      const items = annotations.map((annotation) => {
        const anchor = captured.get(annotation.id)!;
        if (annotation.quote && !anchorText(anchor).includes(annotation.quote.replace(/\s+/g, " ").trim())) {
          throw new Error("The quoted phrase is missing from its captured target.");
        }
        return { ...anchor, contextRange: anchor.range, range: annotation.quote ? quoteRange(anchor, annotation.quote) : anchor.range,
          color: annotation.color, annotation };
      });
      clear();
      for (const { element, annotation } of items) {
        if (annotationShapes(annotation).includes("outline")) {
          element.setAttribute("data-jev-spotlight-outline", annotation.color);
        }
        highlighted.add(element);
      }
      highlightedCount = items.length;
      const first = items[0];
      if (first) {
        const bounds = (first.range ?? first.element).getBoundingClientRect();
        if (bounds.bottom < 0 || bounds.top > innerHeight) window.scrollBy(0, bounds.top - innerHeight / 3);
      }
      if (items.length) removeAnnotations = mountAnnotations(items, clear);
      if (request.operation === "annotate") {
        return { highlighted: highlightedCount, annotations };
      }
      return { highlighted: highlightedCount, color: request.color, shapes: annotationShapes(request.annotation) };
    };
    const scope = globalThis as typeof globalThis & { [isolatedHandler]?: typeof handle };
    scope[isolatedHandler] = handle;
    ctx.addEventListener(window, "keydown", (event) => {
      if (event.key === "Escape" && highlightedCount) clear();
    });
    ctx.onInvalidated(() => {
      delete scope[isolatedHandler];
      clear();
    });
  },
});
