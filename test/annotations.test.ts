import assert from "node:assert/strict";
import { test } from "node:test";
import { annotateInput } from "../src/tools.ts";
import { annotationBatchSchema } from "../src/protocol.ts";

test("accepts ten distinct explanations and rejects duplicate target IDs", () => {
  const annotations = Array.from({ length: 10 }, (_, i) => ({
    id: `target-${i + 1}`, label: `Post ${i + 1}`, explanation: `Explanation ${i + 1}`,
  }));
  const parsed = annotationBatchSchema.parse(annotations);
  assert.equal(parsed.length, 10);
  assert.equal(parsed[9]!.explanation, "Explanation 10");
  assert.throws(() => annotationBatchSchema.parse([...annotations, annotations[0]]), /exactly one/);
});

test("exact annotations require captured browser and snapshot identity", () => {
  const annotation = { id: "target-1", explanation: "This post explains row storage." };
  assert.equal(annotateInput.safeParse({ url: "https://news.ycombinator.com/", annotations: [annotation] }).success, false);
});
