import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { highlightSelection, selectedColumns, selectionText } from "../src/selection.ts";

const lines = ["first line", "", "\x1b[1msecond\x1b[22m line", "third line"];

test("a selection on one row takes the cells from the anchor to the pointer", () => {
  assert.equal(selectionText(lines, { anchor: { row: 0, col: 6 }, focus: { row: 0, col: 9 } }), "line");
  // A drag to the left gives the same text.
  assert.equal(selectionText(lines, { anchor: { row: 0, col: 9 }, focus: { row: 0, col: 6 } }), "line");
});

test("a selection over rows keeps the line breaks and drops the style codes", () => {
  assert.equal(
    selectionText(lines, { anchor: { row: 0, col: 6 }, focus: { row: 3, col: 4 } }),
    "line\n\nsecond line\nthird",
  );
});

test("a wide character is never cut in half", () => {
  // Each CJK character takes 2 cells, so cell 3 is the second half of the second character.
  assert.deepEqual(selectedColumns("目標確認", 0, { anchor: { row: 0, col: 3 }, focus: { row: 0, col: 4 } }), { start: 2, end: 6 });
  assert.equal(selectionText(["目標確認"], { anchor: { row: 0, col: 3 }, focus: { row: 0, col: 4 } }), "標確");
});

test("the highlight keeps the text and inverts only the selected part", () => {
  const selection = { anchor: { row: 2, col: 0 }, focus: { row: 2, col: 5 } };
  const highlighted = highlightSelection(lines[2] ?? "", 2, selection);
  assert.equal(stripTerminalSequences(highlighted), "second line");
  assert.ok(highlighted.startsWith("\x1b[7m"));
  // Inverse comes back after the bold code inside the selection.
  assert.ok(highlighted.includes("\x1b[1m\x1b[7m"));
  assert.equal(highlightSelection("other", 5, selection), "other");
});
