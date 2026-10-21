import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { thinkingLine } from "../src/popup.ts";

test("the thinking line is the newest non-empty line, cut to the width", () => {
  assert.equal(thinkingLine("", 40), "");
  assert.equal(thinkingLine("First thought.\n\nSecond thought.\n", 40), "Second thought.");
  const long = thinkingLine(`short\n${"x".repeat(100)}`, 20);
  assert.equal(visibleWidth(long), 20);
  assert.ok(long.includes("…"));
});
