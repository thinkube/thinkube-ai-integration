/**
 * Unit tests for cross-thinking space tag grouping (SP-tgvil2_SL-3). Pure, no vscode/fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { groupByTag, TaggedItem } from "./tags";

const fixture: TaggedItem[] = [
  { thinkingSpaceId: "A", handle: "SP-1", kind: "spec", tags: ["security", "auth"] },
  { thinkingSpaceId: "A", handle: "SP-1_SL-1", kind: "slice", tags: ["auth"] },
  { thinkingSpaceId: "B", handle: "TEP-x", kind: "tep", tags: ["security"] },
  { thinkingSpaceId: "B", handle: "SP-9", kind: "spec", tags: [] },
];

test("an item with N tags appears under all N", () => {
  const g = groupByTag(fixture);
  assert.deepEqual(
    g.get("security")?.map((i) => i.handle),
    ["SP-1", "TEP-x"],
  );
  assert.deepEqual(
    g.get("auth")?.map((i) => i.handle),
    ["SP-1", "SP-1_SL-1"],
  );
});

test("a tag clusters items across thinkingSpaces", () => {
  const g = groupByTag(fixture);
  const thinkingSpaces = new Set(g.get("security")?.map((i) => i.thinkingSpaceId));
  assert.ok(thinkingSpaces.has("A") && thinkingSpaces.has("B"));
});

test("an untagged item contributes to no bucket", () => {
  const g = groupByTag(fixture);
  for (const its of g.values()) {
    assert.ok(!its.some((i) => i.handle === "SP-9"));
  }
});

test("empty input → empty map", () => {
  assert.equal(groupByTag([]).size, 0);
});
