import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Mouse text selection inside the popup body.
 *
 * In fullscreen mode pi takes the mouse, and its own selection spans whole terminal rows,
 * so it would copy the popup frame and the chat behind the popup too.
 * The popup selects in its own body lines instead, and copies only the text.
 */

/** A cell in the body: `row` is the body line, `col` the column inside the frame. */
export interface SelectionPoint {
  row: number;
  col: number;
}

export interface Selection {
  /** Where the drag started. */
  anchor: SelectionPoint;
  /** Where the pointer is now. It can be before the anchor. */
  focus: SelectionPoint;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function ordered(selection: Selection): { start: SelectionPoint; end: SelectionPoint } {
  const { anchor, focus } = selection;
  const anchorFirst = anchor.row < focus.row || (anchor.row === focus.row && anchor.col <= focus.col);
  return anchorFirst ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

export function isEmptySelection(selection: Selection): boolean {
  return selection.anchor.row === selection.focus.row && selection.anchor.col === selection.focus.col;
}

/**
 * The columns of `row` that the selection covers, widened to whole characters,
 * so half of a wide CJK character is never cut. Undefined when the row is outside the selection.
 */
export function selectedColumns(line: string, row: number, selection: Selection): { start: number; end: number } | undefined {
  const { start, end } = ordered(selection);
  if (row < start.row || row > end.row) return undefined;
  const from = row === start.row ? start.col : 0;
  // The cell under the pointer counts as selected, like in a terminal.
  const to = row === end.row ? end.col + 1 : Number.POSITIVE_INFINITY;

  let cell = 0;
  let first: number | undefined;
  let last: number | undefined;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(stripTerminalSequences(line))) {
    const cellEnd = cell + Math.max(1, visibleWidth(segment));
    if (cellEnd > from && cell < to) {
      first ??= cell;
      last = cellEnd;
    }
    cell = cellEnd;
  }
  if (first === undefined || last === undefined) return undefined;
  return { start: first, end: last };
}

/** The plain text of the selection, one line per body row, without trailing spaces. */
export function selectionText(lines: readonly string[], selection: Selection): string {
  const { start, end } = ordered(selection);
  const parts: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const line = lines[row] ?? "";
    const columns = selectedColumns(line, row, selection);
    const text = columns ? sliceByColumn(stripTerminalSequences(line), columns.start, columns.end - columns.start, true) : "";
    parts.push(text.trimEnd());
  }
  return parts.join("\n");
}

/** Draw the selected part of a body line in inverse video, like pi draws its own selection. */
export function highlightSelection(line: string, row: number, selection: Selection): string {
  const columns = selectedColumns(line, row, selection);
  if (!columns) return line;
  const lineWidth = visibleWidth(line);
  const before = sliceByColumn(line, 0, columns.start, true);
  const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
  const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
  // A style code inside the selected part can switch inverse off, so inverse comes back after each one.
  const inverted = selected.replace(/(\x1b\[[0-9;:]*m)/g, "$1\x1b[7m");
  return `${before}\x1b[7m${inverted}\x1b[27m${after}`;
}
