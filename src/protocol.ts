import { z } from "zod";

export const maxTargets = 120;
const targetId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const snapshotId = z.uuid();
export const markSchema = z.object({
  id: targetId,
  probability: z.number().min(0).max(1),
});

export const isolatedHandler = "__jevSpotlight";
export const pageUrl = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  },
  {
    error: "Enter a full HTTP or HTTPS page URL.",
  },
);
export const pageTarget = z.object({
  id: targetId,
  kind: z.string().max(80),
  text: z.string().min(1).max(500),
  href: pageUrl.optional(),
});
export const pageSnapshotSchema = z.object({
  snapshotId,
  targets: z.array(pageTarget).max(maxTargets),
  truncated: z.boolean(),
});
export const highlightColor = z.enum(["red", "green", "blue"]).default("red");
export const annotationShape = z.enum(["outline", "circle", "arrow", "underline"]);
export const annotationSchema = z.object({
  shapes: z
    .array(annotationShape)
    .min(1)
    .max(4)
    .optional()
    .describe("Shapes to draw together. A note defaults to an outline and an arrow."),
  noteStyle: z.enum(["text", "note", "bubble"]).optional()
    .describe("Callout appearance. Default text is an open handwritten margin note. Use note for a key idea or bubble for a short aside."),
  quote: z.string().trim().min(1).max(160).optional()
    .describe("Exact short phrase from this target to mark. Prefer a meaningful phrase over boxing an entire paragraph. Must occur in the captured text."),
  label: z.string().trim().min(1).max(80).optional().describe("A short, specific heading for this item only, ideally 2–5 words. Do not use a group heading such as Top 10 stories."),
  explanation: z
    .string()
    .trim()
    .min(1)
    .max(360)
    .optional()
    .describe("Explain only this target in 1–2 short sentences, ideally 15–35 words. State its specific claim and why it matters or how it works. Use concrete facts from the researched content. Never combine different targets, refer to an accompanying summary, or invent details; disclose title-only evidence."),
});
export type Annotation = z.infer<typeof annotationSchema>;
export type HighlightColor = z.infer<typeof highlightColor>;

export const targetAnnotationSchema = annotationSchema.extend({
  id: targetId,
  color: highlightColor,
});
export const annotationBatchSchema = z.array(targetAnnotationSchema).min(1).max(maxTargets)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length, {
    error: "Each target must have exactly one annotation in a batch.",
  });
export const annotationResultSchema = z.object({
  highlighted: z.number().int().nonnegative(),
  annotations: z.array(targetAnnotationSchema),
});
export function annotationShapes(annotation?: Annotation) {
  return [...new Set(annotation?.shapes ?? (
    annotation?.label || annotation?.explanation ? ["outline", "arrow"] : ["outline"]
  ))] as z.infer<typeof annotationShape>[];
}

const highlightSchema = z.object({
  snapshotId,
  ids: z.array(targetId).max(maxTargets),
  color: highlightColor,
  annotation: annotationSchema.optional(),
});
const pageRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("capture") }),
  z.object({ operation: z.literal("apply"), ...highlightSchema.shape }),
  z.object({
    operation: z.literal("annotate"),
    snapshotId,
    annotations: annotationBatchSchema,
  }),
]);
export const pageRequestEnvelope = z.object({
  id: z.uuid(),
  url: pageUrl,
  request: pageRequestSchema,
});
export type PageRequest = z.input<typeof pageRequestSchema>;
